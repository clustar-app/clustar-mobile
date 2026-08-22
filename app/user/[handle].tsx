import { useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
} from "react-native";
import { Alert } from "@/lib/alert";

// Fixed cell size = window / 3. Prevents FlatList from letting a lone item
// stretch to full width when there's only 1-2 posts. Cells are flush (no
// gap) for the Instagram/TikTok look.
const CELL_SIZE = Math.floor(Dimensions.get("window").width / 3);
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { userApi, FeedItem, Profile, ApiError, safetyApi } from "@/lib/api";
import { TierBadge } from "@/components/TierBadge";
import { PresenceDot } from "@/components/PresenceDot";
import { formatLastSeen } from "@/lib/presence";
import { useAuth } from "@/lib/auth";
import { Icon } from "@/components/Icon";
import { TabBar } from "@/components/TabBar";
import { colors, radius, spacing } from "@/lib/theme";

// Public profile view. Reachable by tapping any @handle across the app.
// Shows: avatar + handle + display_name + bio, follow toggle, four stat
// counters, and a chronological list of the user's non-vanished clustars.
// Burner activity is NEVER shown here (PRD 4.4).

export default function ProfileScreen() {
  const { handle: rawHandle } = useLocalSearchParams<{ handle: string }>();
  const handle = (rawHandle ?? "").replace(/^@/, "");
  const router = useRouter();
  const queryClient = useQueryClient();
  const { accessToken } = useAuth();

  const profileQ = useQuery({
    queryKey: ["profile", handle],
    queryFn: () => userApi.getProfile(accessToken!, handle),
    enabled: !!accessToken && !!handle,
  });

  const clustarsQ = useQuery({
    queryKey: ["profile-clustars", handle],
    queryFn: () => userApi.getUserClustars(accessToken!, handle),
    enabled: !!accessToken && !!handle,
  });

  const followMut = useMutation({
    mutationFn: (currentlyFollowing: boolean) =>
      currentlyFollowing
        ? userApi.unfollow(accessToken!, handle)
        : userApi.follow(accessToken!, handle),
    onMutate: async (currentlyFollowing) => {
      await queryClient.cancelQueries({ queryKey: ["profile", handle] });
      const prev = queryClient.getQueryData<Profile>(["profile", handle]);
      if (prev) {
        queryClient.setQueryData<Profile>(["profile", handle], {
          ...prev,
          is_following: !currentlyFollowing,
          stats: {
            ...prev.stats,
            followers: Math.max(
              0,
              prev.stats.followers + (currentlyFollowing ? -1 : 1)
            ),
          },
        });
      }
      return { prev };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(["profile", handle], ctx.prev);
      const msg = err instanceof ApiError ? err.message : "Follow failed";
      Alert.alert("Couldn't update follow", msg);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["profile", handle] });
    },
  });

  const onRefresh = useCallback(() => {
    profileQ.refetch();
    clustarsQ.refetch();
  }, [profileQ, clustarsQ]);

  const p = profileQ.data;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.topBtn}>
          <Icon name="back" size={18} color={colors.t2} />
        </Pressable>
        <Text style={styles.topTitle}>@{handle}</Text>
        {p?.is_me ? (
          <Pressable
            onPress={() => router.push("/settings")}
            hitSlop={12}
            style={styles.topBtn}
          >
            <Icon name="more" size={18} color={colors.t2} />
          </Pressable>
        ) : p ? (
          // Other-user kebab menu. Toggles Block <-> Unblock depending on
          // whether I've blocked them already (server exposes is_blocked_by_me).
          <Pressable
            onPress={() =>
              Alert.alert("Options", `@${p.handle}`, [
                p.is_blocked_by_me
                  ? {
                      text: "Unblock",
                      onPress: async () => {
                        try {
                          await safetyApi.unblock(accessToken!, p.handle);
                          queryClient.invalidateQueries();
                        } catch (err) {
                          Alert.alert("Couldn't unblock", err instanceof ApiError ? err.message : "Try again");
                        }
                      },
                    }
                  : {
                  text: "Block",
                  style: "destructive",
                  onPress: () =>
                    Alert.alert(
                      `Block @${p.handle}?`,
                      "You won't see each other's content anywhere. This is silent — they aren't notified.",
                      [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Block",
                          style: "destructive",
                          onPress: async () => {
                            try {
                              await safetyApi.block(accessToken!, p.handle);
                              queryClient.invalidateQueries();
                              router.back();
                            } catch (err) {
                              Alert.alert("Couldn't block", err instanceof ApiError ? err.message : "Try again");
                            }
                          },
                        },
                      ]
                    ),
                },
                {
                  text: "Report",
                  onPress: () => {
                    const submit = async (reason: string) => {
                      const r = reason?.trim();
                      if (!r) return;
                      try {
                        await safetyApi.report(accessToken!, {
                          target_type: "user", target_id: p.id, reason: r,
                        });
                        Alert.alert("Report submitted", "A moderator will review it.");
                      } catch (err) {
                        Alert.alert("Couldn't report", err instanceof ApiError ? err.message : "Try again");
                      }
                    };
                    if ((Alert as any).prompt) {
                      (Alert as any).prompt("Report user", "What's the issue?", [
                        { text: "Cancel", style: "cancel" },
                        { text: "Submit", onPress: submit },
                      ], "plain-text");
                    } else {
                      Alert.alert("Report user", "Choose a reason:", [
                        { text: "Cancel", style: "cancel" },
                        { text: "Spam", onPress: () => submit("spam") },
                        { text: "Harassment", onPress: () => submit("harassment") },
                        { text: "Impersonation", onPress: () => submit("impersonation") },
                        { text: "Other", onPress: () => submit("other") },
                      ]);
                    }
                  },
                },
                { text: "Cancel", style: "cancel" },
              ])
            }
            hitSlop={12}
            style={styles.topBtn}
          >
            <Icon name="more" size={18} color={colors.t2} />
          </Pressable>
        ) : (
          <View style={{ width: 36 }} />
        )}
      </View>

      {profileQ.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : profileQ.error || !p ? (
        <View style={styles.center}>
          <Text style={{ color: colors.t2 }}>Profile not found</Text>
        </View>
      ) : (
        <FlatList
          data={clustarsQ.data ?? []}
          keyExtractor={item => item.id}
          numColumns={3}
          contentContainerStyle={{ paddingBottom: 100 }}
          refreshControl={
            <RefreshControl
              refreshing={profileQ.isFetching || clustarsQ.isFetching}
              onRefresh={onRefresh}
              tintColor={colors.accent}
            />
          }
          ListHeaderComponent={
            <View style={styles.headerBlock}>
              <View style={styles.avatarWrap}>
                {p.avatar_url ? (
                  <Image source={{ uri: p.avatar_url }} style={styles.avatar} contentFit="cover" />
                ) : (
                  <View style={[styles.avatar, styles.avatarPlaceholder]}>
                    <Text style={styles.avatarText}>{p.handle.slice(0, 2).toUpperCase()}</Text>
                  </View>
                )}
                {/* Large presence dot pinned to bottom-right of avatar */}
                {!p.is_me && (
                  <View style={styles.profilePresenceAnchor}>
                    <PresenceDot lastActiveAt={p.last_active_at} size={18} />
                  </View>
                )}
              </View>

              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text style={styles.displayName}>{p.display_name ?? `@${p.handle}`}</Text>
                <TierBadge tier={p.tier} size={16} />
              </View>
              {p.display_name && <Text style={styles.handleSub}>@{p.handle}</Text>}
              {!p.is_me && p.last_active_at && (
                <Text style={styles.lastSeen}>{formatLastSeen(p.last_active_at)}</Text>
              )}
              {p.bio && <Text style={styles.bio}>{p.bio}</Text>}

              {/* Blocked banner — surfaces the state + a one-tap Unblock
                  so users don't have to dig through Settings → Blocked. */}
              {p.is_blocked_by_me && (
                <View style={styles.blockedBanner}>
                  <Icon name="close" size={12} color={colors.danger ?? "#ef4444"} />
                  <Text style={styles.blockedBannerText}>You blocked this account</Text>
                  <Pressable
                    onPress={async () => {
                      try {
                        await safetyApi.unblock(accessToken!, p.handle);
                        queryClient.invalidateQueries();
                      } catch (err) {
                        Alert.alert("Couldn't unblock", err instanceof ApiError ? err.message : "Try again");
                      }
                    }}
                    style={styles.blockedBannerBtn}
                  >
                    <Text style={styles.blockedBannerBtnText}>Unblock</Text>
                  </Pressable>
                </View>
              )}

              {/* Stats row — followers / following pills are tappable so
                  users can drill into the lists. clustars + likes are
                  informational only for now. */}
              <View style={styles.statsRow}>
                <StatPill value={p.stats.clustars} label="clustars" />
                <StatPill
                  value={p.stats.followers}
                  label="followers"
                  onPress={() => router.push(`/followers/${handle}`)}
                />
                <StatPill
                  value={p.stats.following}
                  label="following"
                  onPress={() => router.push(`/following/${handle}`)}
                />
                <StatPill value={p.stats.total_likes} label="likes" />
              </View>

              {/* Follow / edit action */}
              {p.is_me ? (
                <Pressable
                  onPress={() => router.push("/settings")}
                  style={styles.followBtnOutline}
                >
                  <Text style={styles.followBtnOutlineText}>Edit profile</Text>
                </Pressable>
              ) : (
                // Follow + Message side-by-side, mirroring the mockup.
                <View style={{ flexDirection: "row", gap: 8, marginTop: spacing.md }}>
                  <Pressable
                    onPress={() => followMut.mutate(p.is_following)}
                    disabled={followMut.isPending}
                    style={[
                      p.is_following ? styles.followBtnOutline : styles.followBtn,
                      followMut.isPending && { opacity: 0.6 },
                      { marginTop: 0 },
                    ]}
                  >
                    <Text
                      style={
                        p.is_following ? styles.followBtnOutlineText : styles.followBtnText
                      }
                    >
                      {p.is_following ? "Following" : p.is_followed_by ? "Follow back" : "Follow"}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() =>
                      router.push({
                        pathname: "/dm-compose",
                        params: {
                          handle: p.handle,
                          displayName: p.display_name ?? "",
                        },
                      })
                    }
                    style={styles.messageBtn}
                  >
                    <Text style={styles.messageBtnText}>Message</Text>
                  </Pressable>
                </View>
              )}

              <View style={styles.sectionDivider} />
              <Text style={styles.sectionLabel}>Clustars</Text>
            </View>
          }
          renderItem={({ item }) => <GridCard item={item} onPress={() => router.push(`/thread/${item.id}`)} />}
          ListEmptyComponent={
            !clustarsQ.isLoading ? (
              <Text style={styles.empty}>No clustars yet.</Text>
            ) : null
          }
        />
      )}

      {/* Tab bar shows only on your OWN profile view — that's when this
          screen counts as a "root" destination. Someone else's profile
          is a drill-in, so no tab bar (back arrow gets you home). */}
      {p?.is_me && <TabBar activeKey="profile" />}
    </SafeAreaView>
  );
}

function StatPill({
  value,
  label,
  onPress,
}: {
  value: number;
  label: string;
  onPress?: () => void;
}) {
  // Wrap in Pressable only if tappable — avoids stealing hitSlop from
  // surrounding UI when it's a plain stat.
  const inner = (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
  return onPress ? (
    <Pressable onPress={onPress} hitSlop={4}>
      {inner}
    </Pressable>
  ) : (
    inner
  );
}

function GridCard({ item, onPress }: { item: FeedItem; onPress: () => void }) {
  const hasImage = !!item.media_url && item.media_type === "image";
  const engagement =
    (item.stats.likes ?? 0) +
    (item.stats.replies ?? 0) +
    (item.stats.reposts ?? 0);
  const isHot = !hasImage && engagement >= 10;

  return (
    <Pressable
      style={[
        styles.gridCard,
        !hasImage && styles.gridCardText,
        isHot && styles.gridCardHot,
      ]}
      onPress={onPress}
    >
      {hasImage ? (
        <Image source={{ uri: item.media_url! }} style={styles.gridImg} contentFit="cover" />
      ) : (
        <View style={styles.gridTextWrap}>
          <Text
            style={[styles.gridBody, isHot && { color: colors.accentDim }]}
            numberOfLines={4}
          >
            {item.body || "…"}
          </Text>
        </View>
      )}

      {/* Stats overlay — now on BOTH image AND text cells. Text cells use
          a subtle dark chip so the body text has room above it. Users
          asked for engagement visible on every cell in the grid. */}
      <View style={[styles.gridOverlay, !hasImage && styles.gridOverlayText]}>
        <View style={styles.gridStat}>
          <Icon name="heart" size={10} color={colors.t1} />
          <Text style={styles.gridStatText}>{item.stats.likes}</Text>
        </View>
        <View style={styles.gridStat}>
          <Icon name="comment" size={10} color={colors.t1} />
          <Text style={styles.gridStatText}>{item.stats.replies}</Text>
        </View>
        <View style={styles.gridStat}>
          <Icon name="repeat" size={10} color={colors.t1} />
          <Text style={styles.gridStatText}>{item.stats.reposts ?? 0}</Text>
        </View>
      </View>
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
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.s2,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  topTitle: { color: colors.t1, fontSize: 15, fontWeight: "600" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  headerBlock: { padding: spacing.xl, alignItems: "center" },
  avatarWrap: { marginBottom: spacing.md },
  avatar: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.s2 },
  avatarPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accentBg,
  },
  avatarText: { color: colors.accent, fontSize: 26, fontWeight: "700" },
  displayName: { color: colors.t1, fontSize: 20, fontWeight: "700", letterSpacing: -0.3 },
  handleSub: { color: colors.t3, fontSize: 13, marginTop: 2 },
  lastSeen: { color: colors.t3, fontSize: 11, marginTop: 4 },
  // Overlay on the avatar's bottom-right ~4:30 position. marginLeft:0
  // overrides PresenceDot's default inline margin. Small inset (~5%
  // of avatar size) keeps the dot on the circle edge, not floating in
  // the corner-of-bounding-box void.
  profilePresenceAnchor: {
    position: "absolute",
    bottom: 4,
    right: 4,
    marginLeft: 0,
  },
  blockedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: spacing.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: "rgba(239,68,68,0.12)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.3)",
  },
  blockedBannerText: { color: colors.t2, fontSize: 12, flex: 1 },
  blockedBannerBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: colors.s2,
    borderWidth: 1,
    borderColor: colors.borderS,
  },
  blockedBannerBtnText: { color: colors.t1, fontSize: 11, fontWeight: "600" },
  bio: {
    color: colors.t2,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
  },
  statsRow: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  stat: { alignItems: "center", minWidth: 60 },
  statValue: { color: colors.t1, fontSize: 17, fontWeight: "700" },
  statLabel: { color: colors.t3, fontSize: 11, marginTop: 2 },
  followBtn: {
    backgroundColor: colors.accent,
    paddingVertical: 10,
    paddingHorizontal: 40,
    borderRadius: 20,
    marginTop: spacing.md,
  },
  followBtnText: { color: colors.bg, fontWeight: "600", fontSize: 14 },
  followBtnOutline: {
    borderWidth: 1,
    borderColor: colors.borderS,
    paddingVertical: 10,
    paddingHorizontal: 40,
    borderRadius: 20,
    marginTop: spacing.md,
    backgroundColor: colors.s2,
  },
  followBtnOutlineText: { color: colors.t1, fontWeight: "600", fontSize: 14 },
  messageBtn: {
    borderWidth: 1,
    borderColor: colors.borderS,
    paddingVertical: 10,
    paddingHorizontal: 30,
    borderRadius: 20,
    backgroundColor: colors.s2,
  },
  messageBtnText: { color: colors.t1, fontWeight: "600", fontSize: 14 },
  sectionDivider: {
    width: "100%",
    height: 1,
    backgroundColor: colors.border,
    marginTop: spacing.xl,
  },
  sectionLabel: {
    color: colors.t3,
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: spacing.lg,
    alignSelf: "flex-start",
    paddingLeft: 4,
  },
  gridCard: {
    // Fixed width, not flex — guarantees 3-up columns even with only
    // 1 or 2 items in the grid (otherwise FlatList's row flex splits them
    // 50/50 or 100% wide).
    width: CELL_SIZE,
    height: CELL_SIZE,
    backgroundColor: colors.s1,
    overflow: "hidden",
    position: "relative",
    // Thin border between cells for the Instagram grid feel without gaps.
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.bg,
  },
  gridCardText: {
    backgroundColor: colors.s1,
  },
  gridCardHot: {
    backgroundColor: colors.accentBg,
  },
  gridImg: { width: "100%", height: "100%", backgroundColor: colors.s2 },
  gridTextWrap: {
    flex: 1,
    padding: 10,
    // Leave room at the bottom for the stats chip so it doesn't sit on top
    // of the last line of body text.
    paddingBottom: 24,
    justifyContent: "center",
  },
  gridBody: {
    color: colors.t1,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "500",
  },
  gridOverlay: {
    position: "absolute",
    left: 4,
    bottom: 4,
    flexDirection: "row",
    gap: 6,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  gridOverlayText: {
    // Text-cell overlay uses a solid-dark chip so it stays legible against
    // both plain-dark cells AND the accent-tint hot cells.
    backgroundColor: "rgba(0,0,0,0.7)",
  },
  gridStat: { flexDirection: "row", alignItems: "center", gap: 2 },
  gridStatText: { color: colors.t1, fontSize: 9, fontWeight: "500" },
  empty: { color: colors.t3, textAlign: "center", padding: spacing.xxl, fontSize: 13 },
});
