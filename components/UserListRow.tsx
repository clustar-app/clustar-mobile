import { View, Text, Pressable, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { userApi, FollowUser, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { TierBadge } from "@/components/TierBadge";
import { PresenceDot } from "@/components/PresenceDot";
import { colors, radius, spacing } from "@/lib/theme";

// One row = one user. Used by followers + following lists (and later by
// search results). Avatar, handle + optional bio, follow-toggle button on
// the right. Tapping the row (outside the button) opens their profile.

export function UserListRow({
  user,
  onFollowChange,
}: {
  user: FollowUser;
  // Called with the new is_following state so parent can update its cached
  // list optimistically (moves them to top / bottom, updates counters, etc.).
  onFollowChange?: (isFollowing: boolean) => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user: me, accessToken } = useAuth();

  const isMe = me?.handle?.toLowerCase() === user.handle.toLowerCase();

  const mut = useMutation({
    mutationFn: (currentlyFollowing: boolean) =>
      currentlyFollowing
        ? userApi.unfollow(accessToken!, user.handle)
        : userApi.follow(accessToken!, user.handle),
    onSuccess: (res) => {
      onFollowChange?.(res.is_following);
      // Invalidate this user's profile query if it's in cache — followers
      // count will have changed on their profile page.
      queryClient.invalidateQueries({ queryKey: ["profile", user.handle] });
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : "Follow failed";
      // Using Alert here (not toast) to match the rest of the app after
      // the toast revert. Non-blocking is fine — we don't roll back the
      // button state because we don't optimistically flip it in this row.
      import("react-native").then(({ Alert }) => Alert.alert("Couldn't update", msg));
    },
  });

  return (
    <Pressable
      style={styles.row}
      onPress={() => router.push(`/user/${user.handle}`)}
    >
      <View>
        {user.avatar_url ? (
          <Image source={{ uri: user.avatar_url }} style={styles.avatar} contentFit="cover" />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder]}>
            <Text style={styles.avatarText}>{user.handle.slice(0, 2).toUpperCase()}</Text>
          </View>
        )}
        {/* Presence dot pinned to bottom-right of avatar. Hidden for
            offline users — no visual clutter for the majority. */}
        <View style={styles.presenceAnchor}>
          <PresenceDot lastActiveAt={user.last_active_at} size={12} />
        </View>
      </View>

      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Text style={styles.handle} numberOfLines={1}>
            {user.display_name ?? user.handle}
          </Text>
          <TierBadge tier={user.tier} size={11} />
        </View>
        {user.bio ? (
          <Text style={styles.bio} numberOfLines={1}>
            {user.bio}
          </Text>
        ) : (
          <Text style={styles.bio} numberOfLines={1}>@{user.handle}</Text>
        )}
      </View>

      {/* Own row shows no follow button — you can't follow yourself. */}
      {!isMe && (
        <Pressable
          onPress={(e) => {
            e.stopPropagation?.();
            mut.mutate(user.is_following);
          }}
          disabled={mut.isPending}
          hitSlop={6}
          style={[
            user.is_following ? styles.btnGhost : styles.btnFilled,
            mut.isPending && { opacity: 0.5 },
          ]}
        >
          <Text style={user.is_following ? styles.btnGhostText : styles.btnFilledText}>
            {user.is_following ? "Following" : "Follow"}
          </Text>
        </Pressable>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.s2,
  },
  avatarPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accentBg,
  },
  avatarText: { color: colors.accent, fontSize: 14, fontWeight: "600" },
  // Overlay dot on the ~4:30 clock face of the circular avatar.
  presenceAnchor: {
    position: "absolute",
    bottom: 1,
    right: 1,
    marginLeft: 0,
  },
  handle: { color: colors.t1, fontSize: 14, fontWeight: "600" },
  bio: { color: colors.t3, fontSize: 12, marginTop: 2 },
  btnFilled: {
    backgroundColor: colors.accent,
    paddingHorizontal: 18,
    paddingVertical: 7,
    borderRadius: 16,
  },
  btnFilledText: { color: colors.bg, fontSize: 12, fontWeight: "600" },
  btnGhost: {
    borderWidth: 1,
    borderColor: colors.borderS,
    backgroundColor: colors.s2,
    paddingHorizontal: 18,
    paddingVertical: 7,
    borderRadius: 16,
  },
  btnGhostText: { color: colors.t1, fontSize: 12, fontWeight: "600" },
});
