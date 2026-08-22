import { useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { Alert } from "@/lib/alert";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { dmsApi, DmThreadSummary, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Icon } from "@/components/Icon";
import { TierBadge } from "@/components/TierBadge";
import { colors, radius, spacing } from "@/lib/theme";

// Two sections: Received (someone's asking to talk to you) and Sent
// (you've asked to talk to someone; waiting on their acceptance).
// Sent items open the pending thread so users can see what they wrote
// and add more messages — the thread itself shows the "waiting" banner.

type Section = "received" | "sent";

export default function DmRequestsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { accessToken } = useAuth();
  const { identity } = useLocalSearchParams<{ identity?: "main" | "anon" }>();
  const [section, setSection] = useState<Section>("received");

  const receivedQ = useQuery({
    queryKey: ["dm-requests"],
    queryFn: () => dmsApi.listRequests(accessToken!),
    enabled: !!accessToken,
  });

  const sentQ = useQuery({
    queryKey: ["dm-sent-requests"],
    queryFn: () => dmsApi.listSentRequests(accessToken!),
    enabled: !!accessToken,
  });

  const filter = (list: DmThreadSummary[] | undefined) => {
    const all = list ?? [];
    if (identity === "main") return all.filter(t => t.my_identity.type === "user");
    if (identity === "anon") return all.filter(t => t.my_identity.type === "burner");
    return all;
  };

  const received = useMemo(() => filter(receivedQ.data), [receivedQ.data, identity]);
  const sent = useMemo(() => filter(sentQ.data), [sentQ.data, identity]);

  const acceptMut = useMutation({
    mutationFn: (threadId: string) => dmsApi.accept(accessToken!, threadId),
    onSuccess: (_res, threadId) => {
      queryClient.invalidateQueries({ queryKey: ["dm-requests"] });
      queryClient.invalidateQueries({ queryKey: ["dm-threads"] });
      router.replace(`/dm/${threadId}`);
    },
    onError: err => {
      const msg = err instanceof ApiError ? err.message : "Couldn't accept";
      Alert.alert("Couldn't accept", msg);
    },
  });

  const declineMut = useMutation({
    mutationFn: (threadId: string) => dmsApi.decline(accessToken!, threadId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dm-requests"] }),
    onError: err => {
      const msg = err instanceof ApiError ? err.message : "Couldn't decline";
      Alert.alert("Couldn't decline", msg);
    },
  });

  const active = section === "received" ? received : sent;
  const activeQ = section === "received" ? receivedQ : sentQ;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.topBtn}>
          <Icon name="back" size={18} color={colors.t2} />
        </Pressable>
        <Text style={styles.topTitle}>
          {identity === "anon" ? "Anonymous requests" : "Message requests"}
        </Text>
        <View style={{ width: 36 }} />
      </View>

      {/* Received / Sent sub-tabs */}
      <View style={styles.subTabRow}>
        <SubTab
          label="Received"
          count={received.length}
          active={section === "received"}
          onPress={() => setSection("received")}
        />
        <SubTab
          label="Sent"
          count={sent.length}
          active={section === "sent"}
          onPress={() => setSection("sent")}
        />
      </View>

      {activeQ.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={active}
          keyExtractor={t => t.id}
          refreshControl={
            <RefreshControl
              refreshing={activeQ.isFetching}
              onRefresh={() => {
                receivedQ.refetch();
                sentQ.refetch();
              }}
              tintColor={colors.accent}
            />
          }
          renderItem={({ item }) =>
            section === "received" ? (
              <ReceivedCard
                item={item}
                onOpen={() => router.push(`/dm/${item.id}`)}
                onAccept={() => acceptMut.mutate(item.id)}
                onDecline={() => declineMut.mutate(item.id)}
                busy={acceptMut.isPending || declineMut.isPending}
              />
            ) : (
              <SentCard item={item} onPress={() => router.push(`/dm/${item.id}`)} />
            )
          }
          ListEmptyComponent={
            <View style={styles.emptyBlock}>
              <Text style={styles.emptyTitle}>
                {section === "received" ? "No requests" : "No sent requests"}
              </Text>
              <Text style={styles.emptySub}>
                {section === "received"
                  ? "Messages from people you've shared a clustar with will appear here first."
                  : "Requests you send that haven't been accepted yet will show up here."}
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

function SubTab({
  label, count, active, onPress,
}: {
  label: string; count: number; active: boolean; onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.subTab, active && styles.subTabActive]}>
      <Text style={[styles.subTabText, active && { color: colors.accent }]}>
        {label}
        {count > 0 && <Text style={styles.subTabCount}>  {count}</Text>}
      </Text>
    </Pressable>
  );
}

function ReceivedCard({
  item, onOpen, onAccept, onDecline, busy,
}: {
  item: DmThreadSummary;
  onOpen: () => void;
  onAccept: () => void;
  onDecline: () => void;
  busy: boolean;
}) {
  const otherIsBurner = item.other.type === "burner";
  const displayName = item.other.display_name ?? `@${item.other.handle}`;
  // The whole card is tappable — opens the thread in preview mode
  // (read all messages, then Accept/Decline from inside). Inline
  // buttons still work as a shortcut for quick triage on the preview
  // shown here.
  return (
    <Pressable onPress={onOpen} style={styles.reqCard}>
      <View style={styles.reqHead}>
        {item.other.avatar_url ? (
          <Image source={{ uri: item.other.avatar_url }} style={styles.avatar} contentFit="cover" />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder]}>
            <Text style={styles.avatarText}>{item.other.handle.slice(0, 2).toUpperCase()}</Text>
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text style={styles.handle} numberOfLines={1}>
              {displayName}
              {otherIsBurner && <Text style={styles.anonTag}>  anon</Text>}
            </Text>
            {!otherIsBurner && <TierBadge tier={item.other.tier} size={12} />}
          </View>
          <Text style={styles.subMeta}>
            @{item.other.handle} · shared a clustar with you
          </Text>
        </View>
      </View>
      {item.last_message && (
        <Text style={styles.preview} numberOfLines={3}>
          {item.last_message.body || (item.last_message.media_url ? "📷 Photo" : "")}
        </Text>
      )}
      <Text style={styles.tapHint}>Tap to read all messages</Text>
      <View style={styles.actionRow}>
        <Pressable
          onPress={(e) => {
            e.stopPropagation?.();
            Alert.alert(
              "Decline?",
              "They won't be notified. They can't request again for 30 days.",
              [
                { text: "Cancel", style: "cancel" },
                { text: "Decline", style: "destructive", onPress: onDecline },
              ]
            );
          }}
          disabled={busy}
          style={[styles.declineBtn, busy && { opacity: 0.4 }]}
        >
          <Text style={styles.declineBtnText}>Decline</Text>
        </Pressable>
        <Pressable
          onPress={(e) => {
            e.stopPropagation?.();
            onAccept();
          }}
          disabled={busy}
          style={[styles.acceptBtn, busy && { opacity: 0.4 }]}
        >
          <Text style={styles.acceptBtnText}>Accept</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

function SentCard({ item, onPress }: { item: DmThreadSummary; onPress: () => void }) {
  const otherIsBurner = item.other.type === "burner";
  const displayName = item.other.display_name ?? `@${item.other.handle}`;
  return (
    <Pressable onPress={onPress} style={styles.sentCard}>
      <View style={styles.reqHead}>
        {item.other.avatar_url ? (
          <Image source={{ uri: item.other.avatar_url }} style={styles.avatar} contentFit="cover" />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder]}>
            <Text style={styles.avatarText}>{item.other.handle.slice(0, 2).toUpperCase()}</Text>
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text style={styles.handle} numberOfLines={1}>
              {displayName}
              {otherIsBurner && <Text style={styles.anonTag}>  anon</Text>}
            </Text>
            {!otherIsBurner && <TierBadge tier={item.other.tier} size={12} />}
          </View>
          <View style={styles.pendingRow}>
            <Icon name="clock" size={11} color={colors.t3} />
            <Text style={styles.pendingText}>Waiting for accept</Text>
          </View>
        </View>
        <Icon name="chevron-down" size={16} color={colors.t3} style={{ transform: [{ rotate: "-90deg" }] }} />
      </View>
      {item.last_message && (
        <Text style={styles.preview} numberOfLines={2}>
          {item.last_message.body || (item.last_message.media_url ? "📷 Photo" : "")}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  topBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.s2, borderWidth: 1, borderColor: colors.border,
    alignItems: "center", justifyContent: "center",
  },
  topTitle: { color: colors.t1, fontSize: 15, fontWeight: "600" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  subTabRow: {
    flexDirection: "row",
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    gap: 24,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  subTab: {
    paddingBottom: 10,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  subTabActive: {
    borderBottomColor: colors.accent,
  },
  subTabText: { color: colors.t2, fontSize: 13, fontWeight: "600" },
  subTabCount: { color: colors.t3, fontWeight: "500" },

  reqCard: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.s1,
  },
  sentCard: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.s1,
  },
  reqHead: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: spacing.md },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.s2 },
  avatarPlaceholder: {
    backgroundColor: colors.accentBg,
    alignItems: "center", justifyContent: "center",
  },
  avatarText: { color: colors.accent, fontSize: 14, fontWeight: "600" },
  handle: { color: colors.t1, fontSize: 14, fontWeight: "600" },
  anonTag: { color: colors.t3, fontSize: 10, fontWeight: "500" },
  subMeta: { color: colors.t3, fontSize: 11, marginTop: 2 },

  pendingRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 },
  pendingText: { color: colors.t3, fontSize: 11 },

  preview: { color: colors.t1, fontSize: 14, lineHeight: 20, marginBottom: 4 },
  tapHint: { color: colors.t3, fontSize: 11, fontStyle: "italic", marginBottom: spacing.md },
  actionRow: { flexDirection: "row", gap: 8 },
  declineBtn: {
    flex: 1, paddingVertical: 10, borderRadius: radius.md,
    backgroundColor: colors.s3, alignItems: "center",
  },
  declineBtnText: { color: colors.t1, fontWeight: "600", fontSize: 13 },
  acceptBtn: {
    flex: 1, paddingVertical: 10, borderRadius: radius.md,
    backgroundColor: colors.accent, alignItems: "center",
  },
  acceptBtnText: { color: colors.bg, fontWeight: "600", fontSize: 13 },
  emptyBlock: { padding: spacing.xxl, alignItems: "center" },
  emptyTitle: { color: colors.t1, fontSize: 15, fontWeight: "600", marginBottom: 6 },
  emptySub: { color: colors.t2, fontSize: 13, textAlign: "center", lineHeight: 19 },
});
