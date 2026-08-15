import { View, Text, Pressable, StyleSheet, FlatList, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { userApi, FollowUser } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { UserListRow } from "@/components/UserListRow";
import { Icon } from "@/components/Icon";
import { colors, spacing } from "@/lib/theme";

// Followers list — accounts that follow @handle.
// The header title shows the count + handle so the user always knows whose
// followers they're looking at (matters when they came from a deep link).

export default function FollowersScreen() {
  const { handle: raw } = useLocalSearchParams<{ handle: string }>();
  const handle = (raw ?? "").replace(/^@/, "");
  const router = useRouter();
  const queryClient = useQueryClient();
  const { accessToken } = useAuth();

  const q = useQuery({
    queryKey: ["followers", handle],
    queryFn: () => userApi.getFollowers(accessToken!, handle),
    enabled: !!accessToken && !!handle,
  });

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.topBtn}>
          <Icon name="back" size={18} color={colors.t2} />
        </Pressable>
        <Text style={styles.topTitle}>
          {q.data ? `${q.data.length} follower${q.data.length === 1 ? "" : "s"}` : "Followers"}
        </Text>
        <View style={{ width: 36 }} />
      </View>

      {q.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={q.data ?? []}
          keyExtractor={u => u.id}
          renderItem={({ item }) => (
            <UserListRow
              user={item}
              onFollowChange={(isFollowing) => {
                // Keep the row's follow state in sync in the cached list.
                queryClient.setQueryData<FollowUser[]>(["followers", handle], prev =>
                  prev ? prev.map(u => u.id === item.id ? { ...u, is_following: isFollowing } : u) : prev
                );
              }}
            />
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>No followers yet.</Text>
          }
        />
      )}
    </SafeAreaView>
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
  empty: { color: colors.t3, textAlign: "center", padding: spacing.xxl, fontSize: 13 },
});
