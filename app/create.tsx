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
import { useRouter } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import Slider from "@react-native-community/slider";
import { clustarApi, mediaApi, ApiError, FeedItem } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { getCurrentLocation, getPlaceName, Coords } from "@/lib/location";
import { Icon } from "@/components/Icon";
import { IdentityPicker } from "@/components/IdentityPicker";
import { useToast } from "@/lib/toast";
import { colors, radius, spacing } from "@/lib/theme";

// Named radius presets from PRD 4.1. Presets snap the slider to common
// values; slider gives fine-grained control for anything in between.
const PRESETS = [
  { label: "This room", value: 20 },
  { label: "This bus", value: 50 },
  { label: "This block", value: 200 },
  { label: "This area", value: 500 },
  { label: "Wider", value: 1000 },
];

const RADIUS_MIN = 20;
const RADIUS_MAX = 1000; // 1km cap per user preference

function formatRadius(m: number): string {
  if (m >= 1000) return "1km";
  if (m >= 100) return `${Math.round(m / 10) * 10}m`;
  return `${m}m`;
}

// Lifespan choices per PRD 4.1. 4h remains the default because it hits
// the "commute + a few hours after" sweet spot for the alpha use cases.
const LIFESPAN_CHOICES = [
  { label: "1h", value: 1 },
  { label: "4h", value: 4 },
  { label: "12h", value: 12 },
  { label: "24h", value: 24 },
];
const DEFAULT_LIFESPAN = 4;
const MAX_BODY = 180;

export default function CreateScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { accessToken } = useAuth();
  const toast = useToast();

  const [body, setBody] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [radiusM, setRadiusM] = useState(500);
  const [coords, setCoords] = useState<Coords | null>(null);
  const [placeLabel, setPlaceLabel] = useState<string | null>(null);
  const [locError, setLocError] = useState<string | null>(null);
  const [pendingImage, setPendingImage] = useState<{ uri: string; contentType: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [identity, setIdentity] = useState<"user" | "burner">("user");
  const [visibility, setVisibility] = useState<"public" | "followers">("public");
  const [anchorMode, setAnchorMode] = useState<"pinned" | "travelling">("pinned");
  const [lifespanHours, setLifespanHours] = useState<number>(DEFAULT_LIFESPAN);

  // Location + place label in parallel with the form so the user can start
  // typing while we resolve their neighborhood in the background.
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

  const tags = tagInput
    .split(/[\s,]+/)
    .map(t => t.replace(/^#/, "").trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 3);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!coords) {
        throw new Error("Fetching Location...");
      }

      let mediaUrl: string | undefined;
      let mediaType: "image" | undefined;
      if (pendingImage) {
        setUploading(true);
        try {
          const signed = await mediaApi.sign(accessToken!, pendingImage.contentType);
          await mediaApi.uploadBinary(signed.upload_url, pendingImage.uri, pendingImage.contentType);
          mediaUrl = signed.public_url;
          mediaType = "image";
        } finally {
          setUploading(false);
        }
      }
      return clustarApi.create(accessToken!, {
        body: body.trim(),
        tags,
        lat: coords.lat,
        lng: coords.lng,
        radius_m: radiusM,
        anchor_mode: anchorMode,
        lifespan_hours: lifespanHours,
        as_burner: identity === "burner",
        visibility,
        ...(mediaUrl ? { media_url: mediaUrl, media_type: mediaType } : {}),
      });
    },
    onSuccess: (created: FeedItem) => {
      // Optimistic prepend so the user sees their post immediately, even
      // before the socket echo arrives. Then invalidate to reconcile.
      if (coords) {
        queryClient.setQueryData<FeedItem[]>(["feed", coords.lat, coords.lng], prev => {
          const withDistance = { ...created, distance_m: 0 };
          if (!prev) return [withDistance];
          if (prev.some(c => c.id === created.id)) return prev;
          return [withDistance, ...prev];
        });
      }
      queryClient.invalidateQueries({ queryKey: ["feed"] });

      // Kick off the background-location task if this was a travelling
      // clustar. Fire-and-forget so the return-to-feed isn't gated on
      // permission prompts. The task is idempotent — safe to call even
      // if already running (silently no-ops).
      if (anchorMode === "travelling") {
        import("@/lib/backgroundLocation")
          .then(m => m.startTravellingAnchorTask())
          .catch(err => console.log("[travelling] start failed:", err));
      }

      router.back();
    },
    onError: err => {
      const msg = err instanceof ApiError ? err.message : "Failed to post";
      toast.error(msg);
    },
  });

  // Shared handler for BOTH camera + library. Extracted so the "choose
  // source" alert can call either without duplicating mime-type + state code.
  const handlePickedAsset = (asset: ImagePicker.ImagePickerAsset) => {
    const inferred = asset.mimeType ?? (
      /\.gif$/i.test(asset.uri) ? "image/gif" :
      /\.png$/i.test(asset.uri) ? "image/png" :
      /\.webp$/i.test(asset.uri) ? "image/webp" :
      "image/jpeg"
    );
    setPendingImage({ uri: asset.uri, contentType: inferred });
  };

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      toast.error("Camera access denied — enable in Settings");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"] as any,
      quality: 0.8,
      allowsEditing: false,
    });
    if (result.canceled || result.assets.length === 0) return;
    handlePickedAsset(result.assets[0]);
  };

  const pickFromLibrary = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      toast.error("Photo access denied — enable in Settings");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"] as any,
      quality: 0.7,
      allowsEditing: false,
    });
    if (result.canceled || result.assets.length === 0) return;
    handlePickedAsset(result.assets[0]);
  };

  const pickImage = () => {
    // Native Alert acts as a source-chooser action sheet. Fine on both iOS
    // and Android; upgrading to ActionSheetIOS / bottom sheet is a Phase 3
    // polish.
    Alert.alert(
      "Add a photo",
      undefined,
      [
        { text: "Take Photo", onPress: takePhoto },
        { text: "Choose from Library", onPress: pickFromLibrary },
        { text: "Cancel", style: "cancel" },
      ]
    );
  };

  const notImplemented = (label: string) =>
    toast.info(`${label} attachments coming in the next phase`);

  const canPost =
    (!!coords && (body.trim().length > 0 || !!pendingImage)) || false;
  const isBusy = mutation.isPending || uploading;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Top bar — mirrors the mockup: close, title, Post pill on the right */}
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.topBtn}>
            <Icon name="close" size={18} color={colors.t2} />
          </Pressable>
          <Text style={styles.topTitle}>New clustar</Text>
          <Pressable
            onPress={() => canPost && !isBusy && mutation.mutate()}
            disabled={!canPost || isBusy}
            hitSlop={8}
            style={[styles.postPill, (!canPost || isBusy) && { opacity: 0.4 }]}
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
          {/* Body */}
          {!coords && !locError && (
            <View style={styles.locationHint}>
              <Text style={styles.locationHintText}>Fetching Location...</Text>
            </View>
          )}

          {locError && (
            <View style={styles.locationHintError}>
              <Text style={styles.locationHintErrorText}>{locError}</Text>
            </View>
          )}

          <TextInput
            style={styles.textarea}
            placeholder="What's happening around you?"
            placeholderTextColor={colors.t3}
            value={body}
            onChangeText={t => t.length <= MAX_BODY && setBody(t)}
            multiline
            autoFocus
          />
          <Text style={styles.charCount}>
            {body.length} / {MAX_BODY}
          </Text>

          {/* Pending image preview */}
          {pendingImage && (
            <View style={styles.previewCard}>
              <Image source={{ uri: pendingImage.uri }} style={styles.previewImg} contentFit="cover" />
              <Pressable onPress={() => setPendingImage(null)} hitSlop={10} style={styles.previewRemove}>
                <Icon name="close" size={14} color={colors.t1} />
              </Pressable>
            </View>
          )}

          {/* Media bar — image works, others show a placeholder toast */}
          <View style={styles.mbar}>
            <Pressable onPress={pickImage} hitSlop={8} style={styles.mbarBtn}>
              <Icon name="image" size={20} color={colors.t2} />
            </Pressable>
            <Pressable onPress={() => notImplemented("Voice notes")} hitSlop={8} style={styles.mbarBtn}>
              <Icon name="phone" size={20} color={colors.t3} />
            </Pressable>
            <Pressable onPress={() => notImplemented("Video")} hitSlop={8} style={styles.mbarBtn}>
              <Icon name="more" size={20} color={colors.t3} />
            </Pressable>
          </View>

          {/* Tags */}
          <TextInput
            style={styles.tagInput}
            placeholder="add tags — food, delay, music (up to 3)"
            placeholderTextColor={colors.t3}
            value={tagInput}
            onChangeText={setTagInput}
            autoCapitalize="none"
          />
          {tags.length > 0 && (
            <View style={styles.tagChipRow}>
              {tags.map(t => (
                <View key={t} style={styles.tagChip}>
                  <Text style={styles.tagChipText}>#{t}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Radius — presets for common choices + slider for fine control.
              The two are two-way bound: tap a preset → slider snaps; drag
              the slider → the matching preset (if any) highlights. */}
          <View style={styles.sectionHead}>
            <Text style={styles.sectionLabel}>Radius</Text>
            <Text style={styles.sectionValue}>{formatRadius(radiusM)}</Text>
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
          <View style={styles.sliderWrap}>
            <Slider
              minimumValue={RADIUS_MIN}
              maximumValue={RADIUS_MAX}
              step={10}
              value={radiusM}
              onValueChange={setRadiusM}
              minimumTrackTintColor={colors.accent}
              maximumTrackTintColor={colors.s3}
              thumbTintColor={colors.accent}
            />
            <View style={styles.sliderLabels}>
              <Text style={styles.sliderLabelText}>20m</Text>
              <Text style={styles.sliderLabelText}>1km</Text>
            </View>
          </View>

          {/* Anchor mode — Pinned stays at this spot; Travelling moves with
              the creator's device. The server accepts both; the client
              updates the anchor coordinate over time for travelling posts
              via PATCH /clustars/:id/anchor (background wiring is a
              follow-up polish for now). */}
          <View style={styles.srow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.srowTitle}>Anchor</Text>
              <Text style={styles.srowSub}>
                {anchorMode === "pinned"
                  ? "Stays at this spot"
                  : "Moves with your device"}
              </Text>
            </View>
            <View style={{ flexDirection: "row", gap: 6 }}>
              <Pressable
                onPress={() => setAnchorMode("pinned")}
                style={[
                  styles.pill,
                  anchorMode !== "pinned" && { backgroundColor: colors.s2 },
                ]}
              >
                <Icon
                  name="pin"
                  size={12}
                  color={anchorMode === "pinned" ? colors.accent : colors.t2}
                />
                <Text
                  style={[
                    styles.pillText,
                    anchorMode !== "pinned" && { color: colors.t2, fontWeight: "500" },
                  ]}
                >
                  Pinned
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setAnchorMode("travelling")}
                style={[
                  styles.pill,
                  anchorMode !== "travelling" && { backgroundColor: colors.s2 },
                ]}
              >
                <Icon
                  name="nav"
                  size={12}
                  color={anchorMode === "travelling" ? colors.accent : colors.t2}
                />
                <Text
                  style={[
                    styles.pillText,
                    anchorMode !== "travelling" && { color: colors.t2, fontWeight: "500" },
                  ]}
                >
                  Travelling
                </Text>
              </Pressable>
            </View>
          </View>

          {/* Lifespan — 1h / 4h / 12h / 24h. Max is enforced server-side. */}
          <View style={styles.srow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.srowTitle}>Lifespan</Text>
              <Text style={styles.srowSub}>Expires in {lifespanHours}h</Text>
            </View>
            <View style={{ flexDirection: "row", gap: 4 }}>
              {LIFESPAN_CHOICES.map(c => {
                const active = lifespanHours === c.value;
                return (
                  <Pressable
                    key={c.value}
                    onPress={() => setLifespanHours(c.value)}
                    style={[
                      styles.pill,
                      !active && { backgroundColor: colors.s2 },
                      { minWidth: 44, justifyContent: "center" },
                    ]}
                  >
                    <Text
                      style={[
                        styles.pillText,
                        !active && { color: colors.t2, fontWeight: "500" },
                      ]}
                    >
                      {c.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Visibility picker — Public shows to everyone in range; Followers
              only reaches accounts that follow you (still radius-gated). */}
          <View style={styles.srow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.srowTitle}>Visible to</Text>
              <Text style={styles.srowSub}>
                {visibility === "public"
                  ? "Anyone in range"
                  : "Your followers who are in range"}
              </Text>
            </View>
            <View style={{ flexDirection: "row", gap: 6 }}>
              <Pressable
                onPress={() => setVisibility("public")}
                style={[
                  styles.pill,
                  visibility !== "public" && { backgroundColor: colors.s2 },
                ]}
              >
                <Icon
                  name="users"
                  size={12}
                  color={visibility === "public" ? colors.accent : colors.t2}
                />
                <Text
                  style={[
                    styles.pillText,
                    visibility !== "public" && { color: colors.t2, fontWeight: "500" },
                  ]}
                >
                  Public
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setVisibility("followers")}
                style={[
                  styles.pill,
                  visibility !== "followers" && { backgroundColor: colors.s2 },
                ]}
              >
                <Icon
                  name="mask"
                  size={12}
                  color={visibility === "followers" ? colors.accent : colors.t2}
                />
                <Text
                  style={[
                    styles.pillText,
                    visibility !== "followers" && { color: colors.t2, fontWeight: "500" },
                  ]}
                >
                  Followers
                </Text>
              </Pressable>
            </View>
          </View>

          {/* Identity picker — main account or burner */}
          <View style={styles.sectionHead}>
            <Text style={styles.sectionLabel}>Posting as</Text>
          </View>
          <IdentityPicker value={identity} onChange={setIdentity} />

          {/* Location context — shows the resolved place name once ready */}
          <View style={styles.srow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.srowTitle}>Location</Text>
              <Text style={styles.srowSub}>
                {coords
                  ? placeLabel ?? "your area"
                  : locError
                  ? "Not available — grant location permission"
                  : "Getting your location..."}
              </Text>
            </View>
            {!coords && !locError && <ActivityIndicator size="small" color={colors.t3} />}
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
  topTitle: { fontSize: 16, fontWeight: "600", color: colors.t1, letterSpacing: -0.2 },
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
    fontSize: 17,
    lineHeight: 24,
    minHeight: 100,
    textAlignVertical: "top",
    paddingTop: spacing.md,
  },
  charCount: { color: colors.t3, fontSize: 11, textAlign: "right", marginTop: 4 },

  previewCard: {
    position: "relative",
    marginTop: spacing.md,
    borderRadius: radius.md,
    overflow: "hidden",
  },
  previewImg: { width: "100%", height: 200, backgroundColor: colors.s2 },
  previewRemove: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.7)",
    alignItems: "center",
    justifyContent: "center",
  },

  mbar: {
    flexDirection: "row",
    gap: spacing.xl,
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: spacing.md,
  },
  mbarBtn: { padding: 4 },

  tagInput: {
    backgroundColor: colors.s2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: 14,
    color: colors.t1,
    fontSize: 14,
    marginBottom: spacing.sm,
  },
  tagChipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: spacing.lg },
  tagChip: {
    backgroundColor: colors.accentBg,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  tagChipText: { color: colors.accent, fontSize: 11, fontWeight: "500" },

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
  sliderWrap: { marginTop: 4, marginBottom: spacing.md },
  sliderLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 4,
    marginTop: -6,
  },
  sliderLabelText: { color: colors.t3, fontSize: 10 },

  srow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: spacing.md,
  },
  srowTitle: { color: colors.t1, fontSize: 14, fontWeight: "500" },
  srowSub: { color: colors.t3, fontSize: 11, marginTop: 2 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.accentBg,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
  },
  pillText: { color: colors.accent, fontSize: 12, fontWeight: "600" },
});
