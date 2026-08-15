import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { clustarApi, likeApi, FeedItem, safetyApi, ApiError, nearbyApi } from "@/lib/api";
import { usePreferences } from "@/lib/preferences";
import { useAuth } from "@/lib/auth";
import { getCurrentLocation, getPlaceName, Coords } from "@/lib/location";
import { getSocket } from "@/lib/realtime";
import { PulseDot, computeHeat } from "@/components/PulseDot";
import { Icon } from "@/components/Icon";
import { TierBadge } from "@/components/TierBadge";
import { TabBar } from "@/components/TabBar";
import { Image } from "expo-image";
import { colors, radius, spacing } from "@/lib/theme";

// Was a module-level constant. Now sourced from user preferences
// (persisted via lib/preferences). Kept as fallback if prefs haven't
// hydrated yet on first render.
const DEFAULT_RANGE_M = 500;

// Haversine — needed client-side to filter incoming realtime clustars against
// the user's discovery range. The server broadcasts every new clustar to feed
// subscribers; each client decides for itself whether it's in-range.
// Bucketed count display for the "N nearby" pill:
//   0-99      → exact
//   100-999   → nearest hundred with "+" (100+, 200+, …, 900+)
//   1k-999k   → nearest thousand with "k" (1k, 2k, …)
//   1M+       → nearest million with "m" (1m, 2m, …)
// Rounding is DOWN (floor) so "100+" means "at least 100 but under 200".
function formatNearbyCount(n: number): string {
  if (n < 100) return String(n);
  if (n < 1000) return `${Math.floor(n / 100) * 100}+`;
  if (n < 1_000_000) return `${Math.floor(n / 1000)}k`;
  return `${Math.floor(n / 1_000_000)}m`;
}

function distanceMeters(a: {lat: number, lng: number}, b: {lat: number, lng: number}): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x = Math.sin(dLat/2) ** 2 + Math.sin(dLng/2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(x));
}

export default function FeedScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { accessToken, user, signOut } = useAuth();
  const { discovery_range_m } = usePreferences();
  const rangeM = discovery_range_m ?? DEFAULT_RANGE_M;
  const [coords, setCoords] = useState<Coords | null>(null);
  const [placeLabel, setPlaceLabel] = useState<string | null>(null);
  const [locError, setLocError] = useState<string | null>(null);
  // Like state now comes from `item.liked_by_me` on the server response —
  // persistent across sessions. We only mutate the cached item during
  // optimistic updates; no separate client-side Set needed.

  // Get location on mount. Reverse-geocode in parallel — we don't block the
  // feed on it. If geocoding fails we just fall back to "your area".
  useEffect(() => {
    (async () => {
      try {
        const c = await getCurrentLocation();
        setCoords(c);
        getPlaceName(c.lat, c.lng).then(setPlaceLabel);
      } catch (err) {
        setLocError(err instanceof Error ? err.message : "Location error");
      }
    })();
  }, []);

  const {
    data: items,
    isLoading,
    isFetching,
    refetch,
    error,
  } = useQuery({
    queryKey: ["feed", coords?.lat, coords?.lng, rangeM],
    queryFn: () => clustarApi.discover(accessToken!, coords!.lat, coords!.lng, rangeM),
    enabled: !!accessToken && !!coords,
  });

  // Nearby active-user count — refetched every 60s. Small widget above
  // the feed showing "N nearby" so users know the app is alive around
  // them even when the feed itself is empty. Uses same range as feed.
  const nearbyQ = useQuery({
    queryKey: ["nearby-active", coords?.lat, coords?.lng, rangeM],
    queryFn: () => nearbyApi.activeCount(accessToken!, coords!.lat, coords!.lng, rangeM),
    enabled: !!accessToken && !!coords,
    refetchInterval: 60_000,
  });

  // Client-side heat sort — every stats broadcast rearranges the feed so
  // "popping" clustars float to the top in real time. Cheap: the visible
  // list is only ~20 items in v1, sort on every render is fine.
  // MUST be declared AFTER `items` above (TDZ — a previous version put this
  // useMemo first and the whole screen crashed silently on render).
  const sortedItems = useMemo(() => {
    if (!items) return items;
    return [...items].sort((a, b) => {
      const heatA = computeHeat(
        { participants: a.stats.participants, replies: a.stats.replies ?? 0, likes: a.stats.likes },
        a.created_at
      );
      const heatB = computeHeat(
        { participants: b.stats.participants, replies: b.stats.replies ?? 0, likes: b.stats.likes },
        b.created_at
      );
      return heatB - heatA;
    });
  }, [items]);

  const onRefresh = useCallback(() => refetch(), [refetch]);

  // Realtime: subscribe to the global feed channel while this screen is
  // mounted. New clustars are filtered by distance client-side; stats
  // updates patch cards in place so "N here" grows without a refresh.
  useEffect(() => {
    if (!coords) return;
    const socket = getSocket();
    if (!socket) return;

    socket.emit("feed:subscribe");

    const handleNewClustar = (clustar: FeedItem) => {
      // Client-side range filter — don't inject something the user's range
      // wouldn't have surfaced in the initial fetch.
      const d = distanceMeters(coords, clustar.anchor);
      if (d > Math.min(clustar.radius_m, rangeM)) return;

      queryClient.setQueryData<FeedItem[]>(["feed", coords.lat, coords.lng], prev => {
        if (!prev) return [{ ...clustar, distance_m: Math.round(d) }];
        if (prev.some(c => c.id === clustar.id)) return prev; // dedupe echoes
        return [{ ...clustar, distance_m: Math.round(d) }, ...prev];
      });
    };

    const handleStatsUpdate = (payload: {
      id: string;
      stats: { participants?: number; replies?: number; likes?: number; reposts?: number };
    }) => {
      queryClient.setQueryData<FeedItem[]>(["feed", coords.lat, coords.lng], prev => {
        if (!prev) return prev;
        // Patch the direct card AND any REPOST that wraps this original —
        // repost cards display the original's stats (join'd server-side), so
        // they need the same update to stay in sync. Without this, a like on
        // the original wouldn't tick up the count shown on its repost cards.
        return prev.map(c => {
          const isDirectMatch = c.id === payload.id;
          const isRepostOfTarget = !!c.is_repost && c.original?.id === payload.id;
          if (!isDirectMatch && !isRepostOfTarget) return c;
          return { ...c, stats: { ...c.stats, ...payload.stats } };
        });
      });
    };

    const handleExpired = (payload: { id: string }) => {
      queryClient.setQueryData<FeedItem[]>(["feed", coords.lat, coords.lng], prev =>
        prev ? prev.filter(c => c.id !== payload.id) : prev
      );
    };

    socket.on("clustar:new", handleNewClustar);
    socket.on("clustar:stats", handleStatsUpdate);
    socket.on("clustar:expired", handleExpired);

    return () => {
      socket.emit("feed:unsubscribe");
      socket.off("clustar:new", handleNewClustar);
      socket.off("clustar:stats", handleStatsUpdate);
      socket.off("clustar:expired", handleExpired);
    };
  }, [coords, queryClient]);

  // ── Like toggle ────────────────────────────────────────────────────────
  // Reposts route the like to the ORIGINAL clustar's id — engagement always
  // lives on the source. Optimistic: flip both liked_by_me and the count on
  // the cached item; server broadcasts the true stats via `clustar:stats`
  // which reconciles any drift.
  const likeClustar = useMutation({
    mutationFn: (clustarId: string) => likeApi.toggleClustar(accessToken!, clustarId),
  });

  const handleLikeClustar = (clustar: FeedItem) => {
    if (!coords) return;
    const targetId = clustar.is_repost && clustar.original ? clustar.original.id : clustar.id;
    const wasLiked = clustar.liked_by_me;
    const delta = wasLiked ? -1 : 1;

    const patch = (c: FeedItem): FeedItem => {
      // Update the exact card the user tapped, plus any other card in the
      // feed that references the same original (multiple reposts of one
      // clustar keep their hearts in sync).
      const sameTarget =
        c.id === clustar.id ||
        (c.is_repost && c.original?.id === targetId) ||
        c.id === targetId;
      if (!sameTarget) return c;
      return {
        ...c,
        liked_by_me: !wasLiked,
        stats: { ...c.stats, likes: Math.max(0, c.stats.likes + delta) },
      };
    };

    queryClient.setQueryData<FeedItem[]>(["feed", coords.lat, coords.lng], prev =>
      prev ? prev.map(patch) : prev
    );

    likeClustar.mutate(targetId, {
      onError: () => {
        // Roll back.
        queryClient.setQueryData<FeedItem[]>(["feed", coords.lat, coords.lng], prev =>
          prev
            ? prev.map(c => {
                const sameTarget =
                  c.id === clustar.id ||
                  (c.is_repost && c.original?.id === targetId) ||
                  c.id === targetId;
                if (!sameTarget) return c;
                return {
                  ...c,
                  liked_by_me: wasLiked,
                  stats: { ...c.stats, likes: Math.max(0, c.stats.likes - delta) },
                };
              })
            : prev
        );
      },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.brand}>
          Clust<Text style={{ color: colors.accent }}>a</Text>r
        </Text>
        {/* Tap own @handle → own profile (Edit lives inside that screen).
            Previously this was tied to signOut, which was harsh + hidden. */}
        <Pressable
          onPress={() => user?.handle && router.push(`/user/${user.handle}`)}
          hitSlop={16}
        >
          <Text style={{ color: colors.t2, fontSize: 13 }}>@{user?.handle}</Text>
        </Pressable>
      </View>

      <View style={styles.rangeBar}>
        <View style={styles.rangeDot} />
        <Text style={{ color: colors.t3, fontSize: 12, flex: 1 }}>
          {coords
            ? `Showing within ${rangeM >= 1000 ? "1km" : `${rangeM}m`} — ${placeLabel ?? "your area"}`
            : locError
            ? "Location unavailable"
            : "Getting your location..."}
        </Text>
        {/* Nearby-active count — always visible so users see the "0"
            state and understand quiet vs busy areas. Bucketed formatting:
              • 0-99   → exact number
              • 100-999 → nearest hundred with "+" (100+, 200+, ...)
              • 1000+   → 1k, 2k, ... 999k
              • 1M+     → 1m, 2m, ... */}
        {coords && (
          <View style={styles.nearbyPill}>
            <View style={styles.nearbyPillDot} />
            <Text style={styles.nearbyPillText}>
              {formatNearbyCount(nearbyQ.data?.count ?? 0)} nearby
            </Text>
          </View>
        )}
      </View>

      {locError && (
        <View style={styles.errorBox}>
          <Text style={{ color: colors.danger, fontSize: 13 }}>{locError}</Text>
        </View>
      )}

      {error && (
        <View style={styles.errorBox}>
          <Text style={{ color: colors.danger, fontSize: 13 }}>
            {(error as Error).message}
          </Text>
        </View>
      )}

      {isLoading && !items ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : items && items.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Nothing nearby yet</Text>
          <Text style={styles.emptySub}>
            No one's started a clustar in this area. Be the first — it only takes a second.
          </Text>
          <Pressable style={styles.createBtn} onPress={() => router.push("/create")}>
            <Text style={styles.createBtnText}>Create the first clustar</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={sortedItems ?? []}
          keyExtractor={item => item.id}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 100 }}
          refreshControl={
            <RefreshControl
              refreshing={isFetching && !isLoading}
              onRefresh={onRefresh}
              tintColor={colors.accent}
            />
          }
          renderItem={({ item }) => (
            <FeedCard
              item={item}
              onPress={() => {
                // Tapping a repost opens the original's thread — engagement
                // lives on the source, not on the repost surface.
                const targetId = item.is_repost && item.original ? item.original.id : item.id;
                router.push(`/thread/${targetId}`);
              }}
              onLike={() => handleLikeClustar(item)}
            />
          )}
        />
      )}

      {/* Tab bar replaces the standalone FAB — Create is the middle "+"
          button, plus Messages + Profile round out the shell. */}
      <TabBar activeKey="feed" />
    </SafeAreaView>
  );
}

function FeedCard({
  item,
  onPress,
  onLike,
}: {
  item: FeedItem;
  onPress: () => void;
  onLike: () => void;
}) {
  const router = useRouter();
  const { accessToken } = useAuth();

  // Report clustar — freeform reason on iOS, canned menu on Android.
  // Kept as a per-card closure so we can pass it to the kebab handler
  // without threading a bunch of props.
  const promptReportClustar = (clustarId: string) => {
    const submit = async (reason: string) => {
      const r = reason?.trim();
      if (!r) return;
      try {
        await safetyApi.report(accessToken!, { target_type: "clustar", target_id: clustarId, reason: r });
        require("react-native").Alert.alert("Report submitted", "A moderator will review it.");
      } catch (err) {
        require("react-native").Alert.alert("Couldn't report", err instanceof ApiError ? err.message : "Try again");
      }
    };
    const RN = require("react-native");
    if (RN.Platform.OS === "ios" && (RN.Alert as any).prompt) {
      (RN.Alert as any).prompt("Report clustar", "What's the issue?", [
        { text: "Cancel", style: "cancel" },
        { text: "Submit", onPress: submit },
      ], "plain-text");
    } else {
      RN.Alert.alert("Report clustar", "Choose a reason:", [
        { text: "Cancel", style: "cancel" },
        { text: "Spam", onPress: () => submit("spam") },
        { text: "Harassment", onPress: () => submit("harassment") },
        { text: "Inappropriate", onPress: () => submit("inappropriate") },
        { text: "Other", onPress: () => submit("other") },
      ]);
    }
  };

  const remaining = getRemaining(item.expires_at);
  const distance = item.distance_m !== undefined ? formatDistance(item.distance_m) : null;
  const isLiked = item.liked_by_me;
  const isRepost = !!item.is_repost && !!item.original;

  const heat = computeHeat(
    { participants: item.stats.participants, replies: item.stats.replies ?? 0, likes: item.stats.likes },
    item.created_at
  );

  return (
    <Pressable style={styles.card} onPress={onPress}>
      <PulseDot heat={heat} />
      <View style={{ flex: 1 }}>
        {/* Card header: creator handle top-right + reposted-by badge if repost */}
        <View style={styles.cardHeader}>
          {isRepost && (
            <View style={styles.repostBadge}>
              <Icon name="repeat" size={11} color={colors.accent} />
              <Text style={styles.repostBadgeText}>Repost</Text>
            </View>
          )}
          <View style={{ flex: 1 }} />
          {item.author.handle && item.author.type === "user" && (
            // Only main-account handles are tappable — burner handles have
            // no public profile page (PRD 4.4).
            <Pressable
              onPress={(e) => {
                e.stopPropagation?.();
                router.push(`/user/${item.author.handle}`);
              }}
              hitSlop={8}
              style={{ flexDirection: "row", alignItems: "center" }}
            >
              <Text style={styles.cardHandle}>@{item.author.handle}</Text>
              <TierBadge tier={item.author.tier} size={11} />
            </Pressable>
          )}
          {item.author.handle && item.author.type === "burner" && (
            // Burner handles have no public profile — tapping opens a
            // pre-filled DM compose instead. Sender sees "anon" tag on
            // the compose recipient so they know it's a burner.
            <Pressable
              onPress={(e) => {
                e.stopPropagation?.();
                router.push({
                  pathname: "/dm-compose",
                  params: { handle: item.author.handle },
                });
              }}
              hitSlop={8}
            >
              <Text style={styles.cardHandle}>@{item.author.handle}</Text>
            </Pressable>
          )}
          {/* Card kebab — Report clustar. Own clustars can be deleted from
              the thread screen; here we just surface Report. */}
          {!item.authored_by_me && (
            <Pressable
              onPress={(e) => {
                e.stopPropagation?.();
                promptReportClustar(item.id);
              }}
              hitSlop={10}
              style={{ marginLeft: 6, padding: 2 }}
            >
              <Icon name="more" size={16} color={colors.t3} />
            </Pressable>
          )}
        </View>

        {/* Reposter's own comment sits on top */}
        {item.body ? (
          <Text style={styles.cardText} numberOfLines={3}>{item.body}</Text>
        ) : null}

        {/* Reposter's own media (if any — for reposts, always null; for
            original clustars, this is the clustar's attachment) */}
        {item.media_url && item.media_type === "image" && (
          <Image
            source={{ uri: item.media_url }}
            style={styles.cardImage}
            contentFit="cover"
            transition={80}
          />
        )}

        {/* Quoted original — twitter-style card-in-card */}
        {isRepost && item.original && (
          <View style={styles.quotedCard}>
            <Text style={styles.quotedAuthor}>
              @{item.original.author.handle ?? "someone"}
              <Text style={{ color: colors.t3 }}> · original</Text>
            </Text>
            {item.original.body ? (
              <Text style={styles.quotedBody} numberOfLines={3}>
                {item.original.body}
              </Text>
            ) : null}
            {item.original.media_url && item.original.media_type === "image" && (
              <Image
                source={{ uri: item.original.media_url }}
                style={styles.quotedImage}
                contentFit="cover"
                transition={80}
              />
            )}
          </View>
        )}

        <View style={styles.tagRow}>
          {(isRepost ? item.original?.tags ?? [] : item.tags).slice(0, 2).map(t => (
            <View key={t} style={styles.tag}>
              <Text style={styles.tagText}>#{t}</Text>
            </View>
          ))}
          {distance && (
            <View style={[styles.tag, { backgroundColor: colors.s2 }]}>
              <Text style={[styles.tagText, { color: colors.t2 }]}>{distance}</Text>
            </View>
          )}
        </View>
        <View style={styles.stats}>
          <View style={styles.statItem}>
            <Icon name="comment" size={13} color={colors.t3} />
            <Text style={styles.statText}>{item.stats.replies ?? 0}</Text>
          </View>

          <Pressable
            onPress={(e) => { e.stopPropagation?.(); onLike(); }}
            hitSlop={10}
            style={styles.statItem}
          >
            <Icon
              name={isLiked ? "heart-fill" : "heart"}
              size={13}
              color={isLiked ? colors.danger : colors.t3}
            />
            <Text style={[styles.statText, isLiked && { color: colors.danger }]}>
              {item.stats.likes}
            </Text>
          </Pressable>

          <View style={styles.statItem}>
            <Icon name="users" size={13} color={colors.t3} />
            <Text style={styles.statText}>{item.stats.participants}</Text>
          </View>

          <View style={[styles.statItem, { marginLeft: "auto" }]}>
            <Icon name="clock" size={12} color={colors.accentDim} />
            <Text style={[styles.statText, { color: colors.accentDim }]}>{remaining}</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

function getRemaining(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function formatDistance(m: number): string {
  if (m < 50) return "under 50m";
  if (m < 200) return "about 100m";
  if (m < 500) return "about 300m";
  if (m < 1000) return "under 1km";
  return `${(m / 1000).toFixed(1)}km`;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  brand: { fontSize: 20, fontWeight: "700", color: colors.t1, letterSpacing: -0.3 },
  rangeBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
  },
  rangeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
  nearbyPill: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: "rgba(34,197,94,0.14)",
    borderWidth: 1,
    borderColor: "rgba(34,197,94,0.35)",
  },
  nearbyPillDot: {
    width: 6, height: 6, borderRadius: 3, backgroundColor: "#22c55e",
  },
  nearbyPillText: { color: "#22c55e", fontSize: 11, fontWeight: "600" },
  errorBox: {
    marginHorizontal: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.dangerBg,
    marginBottom: spacing.md,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xxl },
  emptyTitle: { fontSize: 18, fontWeight: "600", color: colors.t1, marginBottom: spacing.sm },
  emptySub: { fontSize: 13, color: colors.t2, textAlign: "center", lineHeight: 20, marginBottom: spacing.xl },
  createBtn: {
    backgroundColor: colors.accent,
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 20,
  },
  createBtnText: { color: colors.bg, fontWeight: "600" },
  card: {
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.s1,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  pulse: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
    marginTop: 6,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
    gap: 8,
  },
  cardHandle: { color: colors.t3, fontSize: 12, fontWeight: "500" },
  repostBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.accentBg,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  repostBadgeText: { color: colors.accent, fontSize: 10, fontWeight: "600" },
  cardText: { color: colors.t1, fontSize: 14, lineHeight: 21, marginBottom: spacing.sm },
  cardImage: {
    width: "100%",
    height: 160,
    borderRadius: radius.md,
    backgroundColor: colors.s2,
    marginBottom: spacing.sm,
  },
  quotedCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.bg,
  },
  quotedAuthor: { color: colors.t1, fontSize: 12, fontWeight: "600", marginBottom: 4 },
  quotedBody: { color: colors.t1, fontSize: 13, lineHeight: 19, marginBottom: 6 },
  quotedImage: { width: "100%", height: 120, borderRadius: 8, backgroundColor: colors.s2 },
  tagRow: { flexDirection: "row", gap: 6, flexWrap: "wrap", marginBottom: spacing.sm },
  tag: {
    backgroundColor: colors.accentBg,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 8,
  },
  tagText: { color: colors.accent, fontSize: 11, fontWeight: "500" },
  stats: { flexDirection: "row", gap: spacing.md, alignItems: "center" },
  statItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  statIcon: { color: colors.t3, fontSize: 13 },
  statText: { color: colors.t3, fontSize: 12 },
  fab: {
    position: "absolute",
    right: spacing.xl,
    bottom: spacing.xxl,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
});
