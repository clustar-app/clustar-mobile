import {
  View,
  Text,
  Pressable,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { safetyApi, BlockedRow, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Icon } from "@/components/Icon";
import { colors, radius, spacing } from "@/lib/theme";

// Blocked accounts management. Users get here via Settings → Blocked.
// Each row shows the blocked account and an Unblock button. Unblocking
// is instant (no confirmation) since the reverse action is trivial —
// they can re-block from the profile if it was a mistake.

export default function BlockedScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { accessToken } = useAuth();

  const q = useQuery({
    queryKey: ["blocks"],
    queryFn: () => safetyApi.listBlocks(accessToken!),
    enabled: !!accessToken,
  });

  const unblockMut = useMutation({
    mutationFn: (handle: string) => safetyApi.unblock(accessToken!, handle),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["blocks"] });
      // Also invalidate feed/threads so blocked-user content reappears.
      queryClient.invalidateQueries({ queryKey: ["feed"] });
      queryClient.invalidateQueries({ queryKey: ["thread"] });
      queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
    onError: err => {
      Alert.alert("Couldn't unblock", err instanceof ApiError ? err.message : "Try again");
    },
  });

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.topBtn}>
          <Icon name="back" size={18} color={colors.t2} />
        </Pressable>
        <Text style={styles.topTitle}>Blocked accounts</Text>
        <View style={{ width: 36 }} />
      </View>

      {q.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={q.data ?? []}
          keyExtractor={r => r.id}
          refreshControl={
            <RefreshControl
              refreshing={q.isFetching}
              onRefresh={() => q.refetch()}
              tintColor={colors.accent}
            />
          }
          renderItem={({ item }) => (
            <Row
              row={item}
              busy={unblockMut.isPending}
              onUnblock={() => unblockMut.mutate(item.handle)}
            />
          )}
          ListEmptyComponent={
            <View style={styles.emptyBlock}>
              <Text style={styles.emptyTitle}>No blocked accounts</Text>
              <Text style={styles.emptySub}>
                Accounts you block appear here so you can unblock later. Blocks
                are silent — the other side isn't notified.
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

function Row({ row, busy, onUnblock }: { row: BlockedRow; busy: boolean; onUnblock: () => void }) {
  return (
    <View style={styles.row}>
      {row.avatar_url ? (
        <Image source={{ uri: row.avatar_url }} style={styles.avatar} contentFit="cover" />
      ) : (
        <View style={[styles.avatar, styles.avatarPlaceholder]}>
          <Text style={styles.avatarText}>{row.handle.slice(0, 2).toUpperCase()}</Text>
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.handle}>{row.display_name ?? `@${row.handle}`}</Text>
        <Text style={styles.subMeta}>@{row.handle}</Text>
      </View>
      <Pressable
        onPress={onUnblock}
        disabled={busy}
        style={[styles.unblockBtn, busy && { opacity: 0.4 }]}
      >
        <Text style={styles.unblockText}>Unblock</Text>
      </Pressable>
    </View>
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
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.s2 },
  avatarPlaceholder: {
    backgroundColor: colors.accentBg,
    alignItems: "center", justifyContent: "center",
  },
  avatarText: { color: colors.accent, fontSize: 14, fontWeight: "600" },
  handle: { color: colors.t1, fontSize: 14, fontWeight: "600" },
  subMeta: { color: colors.t3, fontSize: 12, marginTop: 2 },
  unblockBtn: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16,
    borderWidth: 1, borderColor: colors.borderS, backgroundColor: colors.s2,
  },
  unblockText: { color: colors.t1, fontWeight: "600", fontSize: 12 },
  emptyBlock: { padding: spacing.xxl, alignItems: "center" },
  emptyTitle: { color: colors.t1, fontSize: 15, fontWeight: "600", marginBottom: 6 },
  emptySub: { color: colors.t2, fontSize: 13, textAlign: "center", lineHeight: 19 },
});
