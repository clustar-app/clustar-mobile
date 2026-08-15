import { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  ActionSheetIOS,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { dmsApi, ApiError, mediaApi, identityApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Icon } from "@/components/Icon";
import { colors, radius, spacing } from "@/lib/theme";

// First-message compose. Pre-fills recipient from URL params but leaves
// it editable so users can DM anyone (including burners) by typing the
// handle directly. Server resolves burner handles preferentially, so
// @cool_anon reaches the burner, not any accidentally-named user.
//
// Sender identity: main by default, or any of your burners. On success:
//   • accepted thread (rare — someone accepted your very first msg fast) → open it
//   • requested thread → open it too, with a pending banner. User can see
//     what they sent and add follow-ups (they'll all wait for acceptance).

export default function DmComposeScreen() {
  const { handle: initialHandle, displayName } = useLocalSearchParams<{
    handle: string;
    displayName?: string;
  }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { accessToken, user } = useAuth();
  const [handle, setHandle] = useState(initialHandle ?? "");
  const [body, setBody] = useState("");
  const [pendingMedia, setPendingMedia] = useState<
    { url: string; type: string; width: number; height: number; localUri: string } | null
  >(null);
  const [uploading, setUploading] = useState(false);
  const [asBurnerId, setAsBurnerId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Resolve state so we can (a) block sending to a nonexistent handle
  // BEFORE the user hits Send and gets a server error and (b) show a
  // small "anon" tag when the recipient is a burner.
  const [resolved, setResolved] = useState<{ type: "user" | "burner"; handle: string } | null>(null);
  const [resolveErr, setResolveErr] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);

  const burnersQ = useQuery({
    queryKey: ["burners"],
    queryFn: () => identityApi.listBurners(accessToken!),
    enabled: !!accessToken,
  });

  // Debounced handle resolver. Wait ~350ms after typing stops, then hit
  // the resolve endpoint. Result feeds the "anon" tag and inline error.
  useEffect(() => {
    const cleaned = handle.trim().replace(/^@/, "");
    if (!cleaned) {
      setResolved(null);
      setResolveErr(null);
      return;
    }
    setResolving(true);
    const t = setTimeout(async () => {
      try {
        const info = await dmsApi.resolveHandle(accessToken!, cleaned);
        setResolved(info);
        setResolveErr(null);
      } catch (err) {
        setResolved(null);
        setResolveErr(err instanceof ApiError ? err.message : "Handle not found");
      } finally {
        setResolving(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [handle, accessToken]);

  const asBurner = burnersQ.data?.find(b => b.id === asBurnerId) ?? null;
  const senderLabel = asBurner ? `@${asBurner.handle}` : `@${user?.handle}`;

  const sendMut = useMutation({
    mutationFn: () =>
      dmsApi.sendToHandle(
        accessToken!,
        handle.trim(),
        body.trim() || undefined,
        pendingMedia
          ? {
              url: pendingMedia.url,
              type: pendingMedia.type,
              width: pendingMedia.width,
              height: pendingMedia.height,
            }
          : undefined,
        asBurnerId ?? undefined,
      ),
    onSuccess: (res) => {
      // Force-invalidate BOTH inbox queries so the messages screen
      // shows the new sent-request row immediately when the user
      // navigates back. Previously the sent-request only appeared
      // after a manual refresh.
      queryClient.invalidateQueries({ queryKey: ["dm-sent-requests"] });
      queryClient.invalidateQueries({ queryKey: ["dm-threads"] });
      if (res.thread_id) {
        router.replace(`/dm/${res.thread_id}`);
      } else {
        router.back();
      }
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : "Couldn't send";
      Alert.alert("Couldn't send", msg);
    },
  });

  const startAttach = async () => {
    const pick = async (source: "camera" | "library") => {
      const perm = source === "camera"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission needed", `Allow ${source === "camera" ? "camera" : "photo"} access.`);
        return;
      }
      const res = source === "camera"
        ? await ImagePicker.launchCameraAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            quality: 0.85,
            exif: false,
          })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            quality: 0.85,
            exif: false,
          });
      if (res.canceled || !res.assets[0]) return;
      const asset = res.assets[0];
      setUploading(true);
      try {
        const uploaded = await mediaApi.uploadImage(accessToken!, asset.uri, asset.mimeType ?? "image/jpeg");
        setPendingMedia({
          url: uploaded.url,
          type: asset.mimeType ?? "image/jpeg",
          width: asset.width,
          height: asset.height,
          localUri: asset.uri,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Upload failed";
        Alert.alert("Couldn't attach", msg);
      } finally {
        setUploading(false);
      }
    };

    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ["Cancel", "Take Photo", "Choose from Library"],
          cancelButtonIndex: 0,
        },
        (i) => {
          if (i === 1) pick("camera");
          if (i === 2) pick("library");
        }
      );
    } else {
      Alert.alert("Attach photo", undefined, [
        { text: "Camera", onPress: () => pick("camera") },
        { text: "Library", onPress: () => pick("library") },
        { text: "Cancel", style: "cancel" },
      ]);
    }
  };

  const canSend =
    handle.trim().length > 0 &&
    !!resolved &&                       // must resolve to a real target
    (body.trim().length > 0 || !!pendingMedia) &&
    !sendMut.isPending &&
    !uploading;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.topBtn}>
          <Icon name="close" size={18} color={colors.t2} />
        </Pressable>
        <Text style={styles.topTitle}>New message</Text>
        <Pressable
          onPress={() => canSend && sendMut.mutate()}
          disabled={!canSend}
          style={[styles.sendPill, !canSend && { opacity: 0.4 }]}
        >
          {sendMut.isPending ? (
            <ActivityIndicator color={colors.bg} size="small" />
          ) : (
            <Text style={styles.sendPillText}>Send</Text>
          )}
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Editable recipient — pre-fills but lets you type a burner handle */}
        <View style={styles.recipient}>
          <Text style={styles.recipLabel}>To</Text>
          <TextInput
            style={styles.recipInput}
            value={handle}
            onChangeText={(t) => setHandle(t.replace(/^@/, ""))}
            placeholder="handle or burner"
            placeholderTextColor={colors.t3}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {resolving && <ActivityIndicator size="small" color={colors.t3} />}
          {resolved?.type === "burner" && (
            <View style={styles.anonPill}>
              <Text style={styles.anonPillText}>anon</Text>
            </View>
          )}
        </View>
        {resolveErr && !resolving && (
          <Text style={styles.errText}>{resolveErr}</Text>
        )}
        {!resolveErr && displayName && handle === initialHandle && (
          <Text style={styles.subMeta}>{displayName}</Text>
        )}

        {/* Sender identity picker */}
        <Pressable onPress={() => setPickerOpen(v => !v)} style={styles.identityRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.identityLabel}>From</Text>
            <Text style={styles.identityHandle}>{senderLabel}</Text>
          </View>
          <Icon name={pickerOpen ? "chevron-up" : "chevron-down"} size={16} color={colors.t3} />
        </Pressable>

        {pickerOpen && (
          <View style={styles.identityList}>
            <IdentityOption
              label={`@${user?.handle} · main`}
              active={!asBurnerId}
              onPress={() => { setAsBurnerId(null); setPickerOpen(false); }}
            />
            {/* Retired burners are read-only history — they can't be
                used to send new messages (server rejects). Filter them
                out so the picker only shows viable send-as identities. */}
            {(burnersQ.data ?? []).filter(b => !b.retired_at).map(b => (
              <IdentityOption
                key={b.id}
                label={`@${b.handle} · burner`}
                active={asBurnerId === b.id}
                onPress={() => { setAsBurnerId(b.id); setPickerOpen(false); }}
              />
            ))}
          </View>
        )}

        <TextInput
          style={styles.input}
          placeholder={pendingMedia ? "Add a caption..." : "Say something..."}
          placeholderTextColor={colors.t3}
          value={body}
          onChangeText={setBody}
          multiline
          autoFocus
          maxLength={2000}
          editable={!sendMut.isPending}
        />

        {pendingMedia && (
          <View style={styles.mediaPreview}>
            <Image source={{ uri: pendingMedia.localUri }} style={styles.mediaThumb} contentFit="cover" />
            <Pressable onPress={() => setPendingMedia(null)} style={styles.mediaClose} hitSlop={6}>
              <Icon name="close" size={12} color={colors.bg} />
            </Pressable>
          </View>
        )}

        <View style={styles.toolbar}>
          <Pressable
            onPress={startAttach}
            style={[styles.toolBtn, uploading && { opacity: 0.5 }]}
            hitSlop={6}
            disabled={uploading}
          >
            {uploading ? (
              <ActivityIndicator size="small" color={colors.t2} />
            ) : (
              <Icon name="image" size={20} color={colors.t2} />
            )}
          </Pressable>
        </View>

        <Text style={styles.hint}>
          First messages arrive as a request. Decline is silent, and a
          declined sender can't request again for 30 days.
        </Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function IdentityOption({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.identityOpt, active && styles.identityOptActive]}>
      <Text style={[styles.identityOptText, active && { color: colors.accent }]}>{label}</Text>
      {active && <Icon name="check" size={14} color={colors.accent} />}
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
  sendPill: {
    minWidth: 60, paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 18, backgroundColor: colors.accent,
    alignItems: "center", justifyContent: "center",
  },
  sendPillText: { color: colors.bg, fontWeight: "700", fontSize: 13 },

  recipient: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: 4,
  },
  recipLabel: { color: colors.t3, fontSize: 13 },
  recipInput: {
    flex: 1, color: colors.t1, fontSize: 14, fontWeight: "600",
    paddingVertical: 6,
  },
  subMeta: {
    color: colors.t3, fontSize: 11,
    paddingHorizontal: spacing.xl, paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  errText: {
    color: colors.danger ?? "#ef4444",
    fontSize: 11, fontWeight: "500",
    paddingHorizontal: spacing.xl, paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  anonPill: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10,
    backgroundColor: colors.accentBg, borderWidth: 1, borderColor: colors.accent,
  },
  anonPillText: { color: colors.accent, fontSize: 10, fontWeight: "600" },

  identityRow: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: spacing.xl, paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  identityLabel: { color: colors.t3, fontSize: 11, marginBottom: 2 },
  identityHandle: { color: colors.t1, fontSize: 14, fontWeight: "600" },

  identityList: {
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  identityOpt: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.xl, paddingVertical: 12,
  },
  identityOptActive: { backgroundColor: colors.accentBg },
  identityOptText: { color: colors.t1, fontSize: 13, fontWeight: "500" },

  input: {
    flex: 1,
    padding: spacing.xl,
    color: colors.t1,
    fontSize: 16,
    lineHeight: 22,
    textAlignVertical: "top",
  },

  mediaPreview: {
    marginHorizontal: spacing.xl,
    marginBottom: spacing.md,
    borderRadius: radius.md,
    overflow: "hidden",
    position: "relative",
    alignSelf: "flex-start",
  },
  mediaThumb: { width: 140, height: 140, borderRadius: radius.md },
  mediaClose: {
    position: "absolute", top: 6, right: 6,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: "#000000cc",
    alignItems: "center", justifyContent: "center",
  },

  toolbar: {
    flexDirection: "row",
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
    gap: 8,
  },
  toolBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.s2,
    alignItems: "center", justifyContent: "center",
  },

  hint: {
    color: colors.t3, fontSize: 11, lineHeight: 16,
    paddingHorizontal: spacing.xl, paddingBottom: spacing.xl,
  },
});
