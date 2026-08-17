import { useCallback, useEffect, useState, useMemo } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { dmsApi, DmThreadSummary } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { getSocket } from "@/lib/realtime";
import { Icon } from "@/components/Icon";
import { TierBadge } from "@/components/TierBadge";
import { PresenceDot } from "@/components/PresenceDot";
import { TabBar } from "@/components/TabBar";
import { colors, radius, spacing } from "@/lib/theme";

// Messages inbox with two identity tabs: Main / Anonymous.
//
// Threads are partitioned by MY_identity.type — whichever identity
// slot I occupy in the thread determines which tab it appears in.
// This prevents the "wait, did I DM her from my main or my burner?"
// mistake by keeping the two contexts visually separate.
//
// Request banner mirrors the split — main-addressed requests only
// show when the Main tab is active, anon-addressed only in Anonymous.

type Tab = "main" | "anon";

export default function MessagesScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { accessToken, user } = useAuth();
  const [tab, setTab] = useState<Tab>("main");

  const threadsQ = useQuery({
    queryKey: ["dm-threads", user?.id],
    queryFn: () => dmsApi.listThreads(accessToken!),
    enabled: !!accessToken && !!user?.id,
  });

  const requestsQ = useQuery({
    queryKey: ["dm-requests", user?.id],
    queryFn: () => dmsApi.listRequests(accessToken!),
    enabled: !!accessToken && !!user?.id,
  });

  // Sent requests — pending threads I initiated. Surfaced in the same
  // banner so the sender can always reach their outbox, even if there
  // are no incoming requests yet.
  const sentRequestsQ = useQuery({
    queryKey: ["dm-sent-requests", user?.id],
    queryFn: () => dmsApi.listSentRequests(accessToken!),
    enabled: !!accessToken && !!user?.id,
  });

  // Realtime — refresh both inboxes on any DM event.
  useEffect(() => {
    if (!accessToken) return;
    const socket = getSocket();
    if (!socket) return;
    const refetchInboxes = () => {
      queryClient.invalidateQueries({ queryKey: ["dm-threads"] });
      queryClient.invalidateQueries({ queryKey: ["dm-requests"] });
      queryClient.invalidateQueries({ queryKey: ["dm-sent-requests"] });
    };
    socket.on("dm:request:new", refetchInboxes);
    socket.on("dm:thread:accepted", refetchInboxes);
    socket.on("dm:merged", refetchInboxes);
    // dm:inbox:bump: patch the specific row in-place instead of
    // invalidating. Prior version invalidated → refetched → often
    // raced markRead and rehydrated unread_count > 0 briefly on
    // return-to-inbox (TC-046). Patching preserves any unread=0 the
    // thread screen wrote while the user was actively viewing.
    const bumpPatch = (payload: { thread_id: string; message: any }) => {
      queryClient.setQueryData<any[]>(["dm-threads", user?.id], (prev) =>
        prev
          ? prev.map((t) =>
              t.id === payload.thread_id
                ? {
                    ...t,
                    last_message: {
                      body: payload.message.body,
                      media_url: payload.message.media_url,
                      created_at: payload.message.created_at,
                      sender_id: payload.message.sender_id,
                      deleted_at: payload.message.deleted_at ?? null,
                    },
                    // Preserve existing unread_count — thread screen
                    // has already zeroed it if user was viewing. Don't
                    // reset here or we lose that signal.
                  }
                : t
            )
          : prev
      );
    };
    socket.on("dm:inbox:bump", bumpPatch);
    return () => {
      socket.off("dm:request:new", refetchInboxes);
      socket.off("dm:thread:accepted", refetchInboxes);
      socket.off("dm:merged", refetchInboxes);
      socket.off("dm:inbox:bump", bumpPatch);
    };
  }, [accessToken, queryClient]);

  // Manual refreshing state — tied to user pull-down only. Background
  // refetches (via socket invalidation) used to flip isFetching and
  // trigger the RefreshControl spinner, causing the visible "hang"
  // when returning from a thread (issue #1 in test report).
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setManualRefreshing(true);
    try {
      await Promise.all([
        threadsQ.refetch(),
        requestsQ.refetch(),
        sentRequestsQ.refetch(),
      ]);
    } finally {
      setManualRefreshing(false);
    }
  }, [threadsQ, requestsQ, sentRequestsQ]);

  // Partition by my_identity.type. Threads where I'm participating
  // AS my main go to Main; threads where I'm participating AS a burner
  // go to Anonymous. It's possible to have BOTH tabs contain threads
  // with the same other person (once via main, once via burner) — that's
  // the whole point.
  const partition = useMemo(() => {
    const all = threadsQ.data ?? [];
    const requests = requestsQ.data ?? [];
    const sent = sentRequestsQ.data ?? [];
    return {
      main: {
        threads: all.filter(t => t.my_identity.type === "user"),
        requests: requests.filter(t => t.my_identity.type === "user"),
        sent: sent.filter(t => t.my_identity.type === "user"),
      },
      anon: {
        threads: all.filter(t => t.my_identity.type === "burner"),
        requests: requests.filter(t => t.my_identity.type === "burner"),
        sent: sent.filter(t => t.my_identity.type === "burner"),
      },
    };
  }, [threadsQ.data, requestsQ.data, sentRequestsQ.data]);

  const activeThreads = partition[tab].threads;
  const activeReceivedCount = partition[tab].requests.length;
  const activeSentCount = partition[tab].sent.length;
  // Show the banner if EITHER received or sent has items. Copy differs.
  const showBanner = activeReceivedCount > 0 || activeSentCount > 0;
  const otherTabHasAny =
    tab === "main"
      ? partition.anon.requests.length + partition.anon.sent.length > 0
      : partition.main.requests.length + partition.main.sent.length > 0;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Messages</Text>
        {/* Compose button — opens the empty compose screen so users can
            type any handle (including a burner) as the recipient. Prior
            to this the only way in was the "Message" button on a profile,
            which always pre-filled the recipient and hid the fact that
            the field is editable. */}
        <Pressable
          onPress={() => router.push("/dm-compose")}
          style={styles.composeBtn}
          hitSlop={8}
        >
          <Icon name="plus" size={20} color={colors.bg} />
        </Pressable>
      </View>

      {/* Identity tabs */}
      <View style={styles.tabRow}>
        <TabPill
          label="Main"
          sub={`@${user?.handle}`}
          active={tab === "main"}
          badge={partition.main.threads.filter(t => (t.unread_count ?? 0) > 0).length}
          onPress={() => setTab("main")}
        />
        <TabPill
          label="Anonymous"
          sub={partition.anon.threads.length > 0 ? "burner threads" : "no burner threads"}
          active={tab === "anon"}
          badge={partition.anon.threads.filter(t => (t.unread_count ?? 0) > 0).length}
          onPress={() => setTab("anon")}
        />
      </View>

      {threadsQ.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={activeThreads}
          keyExtractor={t => t.id}
          contentContainerStyle={{ paddingBottom: 100 }}
          refreshControl={
            <RefreshControl
              refreshing={manualRefreshing}
              onRefresh={onRefresh}
              tintColor={colors.accent}
            />
          }
          ListHeaderComponent={
            <>
              {showBanner && (
                <Pressable
                  onPress={() => router.push(`/dm-requests?identity=${tab}`)}
                  style={styles.requestBanner}
                >
                  {activeReceivedCount > 0 ? (
                    <View style={styles.requestBadge}>
                      <Text style={styles.requestBadgeText}>{activeReceivedCount}</Text>
                    </View>
                  ) : (
                    // Sent-only case: use a neutral clock badge instead
                    // of the accent unread-style pill.
                    <View style={[styles.requestBadge, { backgroundColor: colors.s3 }]}>
                      <Icon name="clock" size={12} color={colors.t1} />
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.requestBannerTitle}>
                      {activeReceivedCount > 0
                        ? (tab === "main"
                            ? `Message request${activeReceivedCount === 1 ? "" : "s"}`
                            : `Anonymous request${activeReceivedCount === 1 ? "" : "s"}`)
                        : `${activeSentCount} sent request${activeSentCount === 1 ? "" : "s"} pending`}
                    </Text>
                    <Text style={styles.requestBannerSub}>
                      {activeReceivedCount > 0 && activeSentCount > 0
                        ? `${activeSentCount} sent · waiting to be accepted`
                        : activeReceivedCount > 0
                          ? (tab === "main"
                              ? "People you've shared a clustar with want to talk"
                              : "Someone messaged one of your burners")
                          : "Waiting for the other side to accept"}
                    </Text>
                  </View>
                  <Icon name="chevron-down" size={16} color={colors.t3} />
                </Pressable>
              )}
              {!showBanner && otherTabHasAny && (
                <Pressable
                  onPress={() => setTab(tab === "main" ? "anon" : "main")}
                  style={styles.crossHint}
                >
                  <Text style={styles.crossHintText}>
                    You have requests in your{" "}
                    <Text style={{ color: colors.accent }}>
                      {tab === "main" ? "Anonymous" : "Main"}
                    </Text>{" "}
                    inbox
                  </Text>
                </Pressable>
              )}
            </>
          }
          renderItem={({ item }) => (
            <ThreadRow item={item} onPress={() => router.push(`/dm/${item.id}`)} />
          )}
          ListEmptyComponent={
            !threadsQ.isLoading ? (
              <EmptyState tab={tab} />
            ) : null
          }
        />
      )}

      <TabBar activeKey="messages" />
    </SafeAreaView>
  );
}

function TabPill({
  label,
  sub,
  active,
  badge,
  onPress,
}: {
  label: string;
  sub: string;
  active: boolean;
  badge: number;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.tabPill, active && styles.tabPillActive]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Text style={[styles.tabPillLabel, active && { color: colors.t1 }]}>{label}</Text>
        {badge > 0 && (
          <View style={styles.tabDot}>
            <Text style={styles.tabDotText}>{badge > 9 ? "9+" : badge}</Text>
          </View>
        )}
      </View>
      <Text style={styles.tabPillSub} numberOfLines={1}>{sub}</Text>
    </Pressable>
  );
}

function EmptyState({ tab }: { tab: Tab }) {
  return (
    <View style={styles.emptyBlock}>
      <Text style={styles.emptyTitle}>
        {tab === "main" ? "No conversations yet" : "No anonymous conversations"}
      </Text>
      <Text style={styles.emptySub}>
        {tab === "main"
          ? "Message someone whose clustar you've participated in — they'll see it as a request first."
          : "Send a DM from one of your burners, or message a burner handle, to start an anonymous thread."}
      </Text>
    </View>
  );
}

function ThreadRow({ item, onPress }: { item: DmThreadSummary; onPress: () => void }) {
  const unread = item.unread_count > 0;
  const otherIsBurner = item.other.type === "burner";
  const revealedHandle = item.other.revealed_main?.handle;
  const displayName = revealedHandle
    ? `@${revealedHandle}`
    : item.other.display_name ?? `@${item.other.handle}`;

  let preview = "No messages yet";
  if (item.last_message) {
    if (item.last_message.deleted_at) preview = "Message deleted";
    else if (item.last_message.body) preview = item.last_message.body;
    else if (item.last_message.media_url) preview = "📷 Photo";
  }

  return (
    <Pressable onPress={onPress} style={styles.row}>
      <View style={styles.avatarWrap}>
        {item.other.avatar_url ? (
          <Image source={{ uri: item.other.avatar_url }} style={styles.avatar} contentFit="cover" />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder]}>
            <Text style={styles.avatarText}>{item.other.handle.slice(0, 2).toUpperCase()}</Text>
          </View>
        )}
        {/* Presence hidden for burner counterparts — showing "online"
            beside a burner would leak underlying-account activity. */}
        {!otherIsBurner && (
          <View style={styles.presenceAnchor}>
            <PresenceDot lastActiveAt={item.other.last_active_at} size={13} />
          </View>
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.rowHead}>
          <View style={{ flexDirection: "row", alignItems: "center", flex: 1, minWidth: 0 }}>
            <Text style={styles.handle} numberOfLines={1}>
              {displayName}
              {otherIsBurner && !revealedHandle && (
                <Text style={styles.burnerTag}>  anon</Text>
              )}
            </Text>
            {!otherIsBurner && <TierBadge tier={item.other.tier} size={11} />}
          </View>
          {item.last_message && (
            <Text style={styles.time}>{shortTime(item.last_message.created_at)}</Text>
          )}
        </View>
        <Text
          style={[styles.preview, unread && { color: colors.t1, fontWeight: "600" }]}
          numberOfLines={1}
        >
          {preview}
        </Text>
      </View>
      {unread && <View style={styles.unreadDot} />}
    </Pressable>
  );
}

function shortTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return `${Math.floor(d / 7)}w`;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  title: { color: colors.t1, fontSize: 24, fontWeight: "700", letterSpacing: -0.5 },
  composeBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.accent,
    alignItems: "center", justifyContent: "center",
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 4,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  tabRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
  },
  tabPill: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    backgroundColor: colors.s1,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabPillActive: {
    backgroundColor: colors.s2,
    borderColor: colors.borderS,
  },
  tabPillLabel: { color: colors.t2, fontSize: 13, fontWeight: "600" },
  tabPillSub: { color: colors.t3, fontSize: 10, marginTop: 2 },
  tabDot: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  tabDotText: { color: colors.bg, fontSize: 10, fontWeight: "700" },

  requestBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: spacing.xl,
    marginBottom: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.accentBg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  requestBadge: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: colors.accent,
    alignItems: "center", justifyContent: "center",
  },
  requestBadgeText: { color: colors.bg, fontSize: 12, fontWeight: "700" },
  requestBannerTitle: { color: colors.t1, fontSize: 13, fontWeight: "600" },
  requestBannerSub: { color: colors.t3, fontSize: 11, marginTop: 2 },

  crossHint: {
    marginHorizontal: spacing.xl,
    marginBottom: spacing.md,
    paddingVertical: 10,
    alignItems: "center",
  },
  crossHintText: { color: colors.t3, fontSize: 12 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  // Explicit wrap dims so the presence dot's absolute positioning has
  // a predictable box to anchor to (was floating below because parent
  // wasn't sized to the avatar).
  avatarWrap: { width: 46, height: 46, position: "relative" },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.s2 },
  avatarPlaceholder: {
    backgroundColor: colors.accentBg,
    alignItems: "center", justifyContent: "center",
  },
  avatarText: { color: colors.accent, fontSize: 14, fontWeight: "600" },
  // Overlay the presence dot on the ~4:30 clock face of the circular
  // avatar. marginLeft:0 kills PresenceDot's default inline margin so
  // absolute positioning is exact.
  presenceAnchor: {
    position: "absolute",
    bottom: 1,
    right: 1,
    marginLeft: 0,
  },
  rowHead: { flexDirection: "row", justifyContent: "space-between", marginBottom: 2 },
  // No `flex: 1` here — that made the Text stretch to fill its row,
  // pushing the sibling TierBadge to the far right (away from the
  // handle). The wrapping View now owns the flex, and this Text just
  // shrinks with an ellipsis when needed.
  handle: { color: colors.t1, fontSize: 14, fontWeight: "600", flexShrink: 1, minWidth: 0 },
  burnerTag: { color: colors.t3, fontSize: 10, fontWeight: "500" },
  time: { color: colors.t3, fontSize: 11, marginLeft: 8 },
  preview: { color: colors.t2, fontSize: 13 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },

  emptyBlock: { padding: spacing.xxl, alignItems: "center" },
  emptyTitle: { color: colors.t1, fontSize: 15, fontWeight: "600", marginBottom: 6 },
  emptySub: { color: colors.t2, fontSize: 13, textAlign: "center", lineHeight: 19 },
});
