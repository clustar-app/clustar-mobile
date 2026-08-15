import { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { clustarApi, repostApi, ApiError, FeedItem } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { getCurrentLocation, getPlaceName, Coords } from "@/lib/location";
import { Icon } from "@/components/Icon";
import { IdentityPicker } from "@/components/IdentityPicker";
import { useToast } from "@/lib/toast";
import { colors, radius, spacing } from "@/lib/theme";

// Twitter-style quote-repost compose screen. Reposter can:
//   - Add an optional comment (280 chars, above the quoted original)
//   - Pick their own radius (where their repost is discoverable)
//   - Pick anchor mode + visibility
// Expiry is INHERITED from the original — a repost can't outlive its source.
// Tapping the repost card anywhere else in the app opens the original's
// thread; all engagement (likes, replies) lives on the source.

const PRESETS = [
  { label: "This room", value: 20 },
  { label: "This bus", value: 50 },
  { label: "This block", value: 200 },
  { label: "This area", value: 500 },
  { label: "Wider", value: 1000 },
];
const MAX_COMMENT = 280;

export default function RepostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { accessToken } = useAuth();
  const toast = useToast();

  const [comment, setComment] = useState("");
  const [radiusM, setRadiusM] = useState(500);
  const [anchorMode, setAnchorMode] = useState<"pinned" | "travelling">("pinned");
  const [visibility, setVisibility] = useState<"public" | "followers">("public");
  const [coords, setCoords] = useState<Coords | null>(null);
  const [placeLabel, setPlaceLabel] = useState<string | null>(null);
  const [locError, setLocError] = useState<string | null>(null);
  const [identity, setIdentity] = useState<"user" | "burner">("user");

  // Load the original clustar so the reposter sees what they're quoting.
  const originalQuery = useQuery({
    queryKey: ["clustar", id],
    queryFn: () => clustarApi.get(accessToken!, id!),
    enabled: !!accessToken && !!id,
  });

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

  const mutation = useMutation({
    mutationFn: () =>
      repostApi.create(accessToken!, id!, {
        lat: coords!.lat,
        lng: coords!.lng,
        radius_m: radiusM,
        anchor_mode: anchorMode,
        visibility,
        comment: comment.trim() || undefined,
        as_burner: identity === "burner",
      }),
    onSuccess: (created: FeedItem) => {
      const originalId = id!;

      // setQueriesData patches EVERY cached feed regardless of the coord
      // key it was stored under. Previously we used setQueryData with the
      // repost screen's coords which could differ from the feed's coords by
      // GPS jitter — patch missed the cache, count stayed stale until refetch.
      queryClient.setQueriesData<FeedItem[]>(
        { queryKey: ["feed"] },
        (prev: FeedItem[] | undefined) => {
          const withNewCard = !prev
            ? [{ ...created, distance_m: 0 }]
            : prev.some(c => c.id === created.id)
            ? prev
            : [{ ...created, distance_m: 0 }, ...prev];
          // Also bump reposted_by_me + count on the ORIGINAL wherever it
          // appears — direct card or as .original inside another repost.
          return withNewCard.map(c => {
            if (c.id === originalId) {
              return {
                ...c,
                reposted_by_me: created.id,
                stats: { ...c.stats, reposts: (c.stats.reposts ?? 0) + 1 },
              };
            }
            return c;
          });
        }
      );
      queryClient.setQueryData<any>(["clustar", originalId], (prev: any) =>
        prev
          ? {
              ...prev,
              reposted_by_me: created.id,
              stats: { ...prev.stats, reposts: (prev.stats.reposts ?? 0) + 1 },
            }
          : prev
      );
      queryClient.invalidateQueries({ queryKey: ["feed"] });
      queryClient.invalidateQueries({ queryKey: ["clustar", originalId] });
      router.back();
    },
    onError: err => {
      const msg = err instanceof ApiError ? err.message : "Failed to repost";
      toast.error(msg);
    },
  });

  const original = originalQuery.data;
  const isBusy = mutation.isPending;
  const canPost = !!coords && !isBusy;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.topBtn}>
            <Icon name="close" size={18} color={colors.t2} />
          </Pressable>
          <Text style={styles.topTitle}>Repost</Text>
          <Pressable
            onPress={() => canPost && mutation.mutate()}
            disabled={!canPost}
            hitSlop={8}
            style={[styles.postPill, !canPost && { opacity: 0.4 }]}
          >
            {isBusy ? (
              <ActivityIndicator color={colors.bg} size="small" />
            ) : (
              <Text style={styles.postPillText}>Post</Text>
            )}
          </Pressable>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: spacing.xl, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          <TextInput
            style={styles.textarea}
            placeholder="Add a comment (optional)..."
            placeholderTextColor={colors.t3}
            value={comment}
            onChangeText={t => t.length <= MAX_COMMENT && setComment(t)}
            multiline
            autoFocus
          />
          <Text style={styles.charCount}>
            {comment.length} / {MAX_COMMENT}
          </Text>

          {/* Quoted original preview */}
          {original ? (
            <View style={styles.quotedCard}>
              <Text style={styles.quotedAuthor}>
                @{original.author.handle ?? "someone"}
                <Text style={{ color: colors.t3 }}> · original</Text>
              </Text>
              {original.body ? (
                <Text style={styles.quotedBody} numberOfLines={4}>
                  {original.body}
                </Text>
              ) : null}
              {original.media_url && original.media_type === "image" && (
                <Image
                  source={{ uri: original.media_url }}
                  style={styles.quotedImage}
                  contentFit="cover"
                />
              )}
              <Text style={styles.quotedMeta}>
                {original.stats.replies} replies · {original.stats.likes} likes
              </Text>
            </View>
          ) : (
            <View style={[styles.quotedCard, { alignItems: "center" }]}>
              <ActivityIndicator color={colors.accent} />
            </View>
          )}

          {/* Radius */}
          <View style={styles.sectionHead}>
            <Text style={styles.sectionLabel}>Radius</Text>
            <Text style={styles.sectionValue}>
              {radiusM < 1000 ? `${radiusM}m` : `${radiusM / 1000}km`}
            </Text>
          </View>
          <View style={styles.presetRow}>
            {PRESETS.map(p => (
              <Pressable
                key={p.value}
                style={[styles.preset, radiusM === p.value && styles.presetActive]}
                onPress={() => setRadiusM(p.value)}
              >
                <Text
                  style={[
                    styles.presetLabel,
                    radiusM === p.value && { color: colors.accent, fontWeight: "600" },
                  ]}
                >
                  {p.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Anchor */}
          <View style={styles.sectionHead}>
            <Text style={styles.sectionLabel}>Anchor</Text>
          </View>
          <View style={styles.pairRow}>
            <Pressable
              onPress={() => setAnchorMode("pinned")}
              style={[styles.pair, anchorMode === "pinned" && styles.pairActive]}
            >
              <Icon
                name="pin"
                size={16}
                color={anchorMode === "pinned" ? colors.accent : colors.t2}
              />
              <Text
                style={[
                  styles.pairText,
                  anchorMode === "pinned" && { color: colors.accent, fontWeight: "600" },
                ]}
              >
                Pinned here
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setAnchorMode("travelling")}
              style={[styles.pair, anchorMode === "travelling" && styles.pairActive]}
            >
              <Icon
                name="nav"
                size={16}
                color={anchorMode === "travelling" ? colors.accent : colors.t2}
              />
              <Text
                style={[
                  styles.pairText,
                  anchorMode === "travelling" && { color: colors.accent, fontWeight: "600" },
                ]}
              >
                Travels with me
              </Text>
            </Pressable>
          </View>

          {/* Visibility */}
          <View style={styles.sectionHead}>
            <Text style={styles.sectionLabel}>Visible to</Text>
          </View>
          <View style={styles.pairRow}>
            <Pressable
              onPress={() => setVisibility("public")}
              style={[styles.pair, visibility === "public" && styles.pairActive]}
            >
              <Icon
                name="users"
                size={16}
                color={visibility === "public" ? colors.accent : colors.t2}
              />
              <Text
                style={[
                  styles.pairText,
                  visibility === "public" && { color: colors.accent, fontWeight: "600" },
                ]}
              >
                Public
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setVisibility("followers")}
              style={[styles.pair, visibility === "followers" && styles.pairActive]}
            >
              <Icon
                name="mask"
                size={16}
                color={visibility === "followers" ? colors.accent : colors.t2}
              />
              <Text
                style={[
                  styles.pairText,
                  visibility === "followers" && { color: colors.accent, fontWeight: "600" },
                ]}
              >
                Followers only
              </Text>
            </Pressable>
          </View>

          {/* Identity picker — repost can be posted as main OR burner. Server
              blocks self-reposts even via burner-of-original-author. */}
          <View style={styles.sectionHead}>
            <Text style={styles.sectionLabel}>Reposting as</Text>
          </View>
          <IdentityPicker value={identity} onChange={setIdentity} />

          {/* Location + inherited expiry */}
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Location</Text>
            <Text style={styles.metaValue}>
              {coords
                ? placeLabel ?? "your area"
                : locError
                ? "Not available"
                : "Getting..."}
            </Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Expires</Text>
            <Text style={styles.metaValue}>
              {original ? `inherited from original` : "..."}
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
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
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.s2,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  topTitle: { fontSize: 16, fontWeight: "600", color: colors.t1 },
  postPill: {
    backgroundColor: colors.accent,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
    minWidth: 68,
    alignItems: "center",
  },
  postPillText: { color: colors.bg, fontWeight: "600", fontSize: 13 },

  textarea: {
    color: colors.t1,
    fontSize: 16,
    lineHeight: 22,
    minHeight: 60,
    textAlignVertical: "top",
    paddingTop: spacing.md,
  },
  charCount: { color: colors.t3, fontSize: 11, textAlign: "right", marginTop: 4 },

  quotedCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.lg,
    backgroundColor: colors.s1,
  },
  quotedAuthor: { color: colors.t1, fontSize: 13, fontWeight: "600", marginBottom: 6 },
  quotedBody: { color: colors.t1, fontSize: 14, lineHeight: 20, marginBottom: 6 },
  quotedImage: { width: "100%", height: 140, borderRadius: 8, backgroundColor: colors.s2, marginBottom: 6 },
  quotedMeta: { color: colors.t3, fontSize: 11, marginTop: 4 },

  sectionHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  sectionLabel: {
    color: colors.t3,
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  sectionValue: { color: colors.accent, fontSize: 13, fontWeight: "600" },
  presetRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: spacing.md },
  preset: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  presetActive: { borderColor: colors.accent, backgroundColor: colors.accentBg },
  presetLabel: { color: colors.t2, fontSize: 13 },
  pairRow: { flexDirection: "row", gap: 8, marginBottom: spacing.md },
  pair: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  pairActive: { borderColor: colors.accent, backgroundColor: colors.accentBg },
  pairText: { color: colors.t1, fontSize: 13 },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  metaLabel: { color: colors.t2, fontSize: 13 },
  metaValue: { color: colors.t1, fontSize: 13, fontWeight: "500" },
});
