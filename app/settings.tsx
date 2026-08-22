import { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Alert } from "@/lib/alert";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import { userApi, mediaApi, ApiError, preferencesApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Icon } from "@/components/Icon";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import Slider from "@react-native-community/slider";
import {
  usePreferences, setPreference, RANGE_MIN_M, RANGE_MAX_M,
} from "@/lib/preferences";
import { colors, radius, spacing } from "@/lib/theme";

// Own-profile edit screen. Set display name (public) and bio (up to 280 chars).
// Handle changes deferred — that requires collision checking + reserving the
// old handle for a period, which is a Phase 3 concern.

export default function SettingsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { accessToken, user, signOut, updateUser } = useAuth();
  const [signOutOpen, setSignOutOpen] = useState(false);
  const doSignOut = () => {
    // Kick off async sign-out immediately. Its state updates trigger
    // AuthGate to redirect to /(auth)/splash automatically — nothing to
    // navigate here.
    signOut();
  };

  // Load fresh profile to seed the form (server has canonical values).
  const meQuery = useQuery({
    queryKey: ["profile", user?.handle],
    queryFn: () => userApi.getProfile(accessToken!, user!.handle),
    enabled: !!accessToken && !!user?.handle,
  });

  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  // avatarUrl: the URL that will be persisted. Starts from server truth,
  // updates immediately after a successful upload so the preview reflects
  // the pending state before the user hits Save.
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // Seed form fields once profile arrives.
  useEffect(() => {
    if (meQuery.data) {
      setDisplayName(meQuery.data.display_name ?? "");
      setBio(meQuery.data.bio ?? "");
      setAvatarUrl(meQuery.data.avatar_url);
    }
  }, [meQuery.data]);

  // ── Avatar upload ────────────────────────────────────────────────────────
  const pickAvatar = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Photo access denied", "Enable photo library access in Settings.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"] as any,
      quality: 0.8,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    const contentType =
      asset.mimeType ??
      (/\.png$/i.test(asset.uri) ? "image/png" :
       /\.webp$/i.test(asset.uri) ? "image/webp" :
       "image/jpeg");

    setUploadingAvatar(true);
    try {
      const signed = await mediaApi.sign(accessToken!, contentType);
      await mediaApi.uploadBinary(signed.upload_url, asset.uri, contentType);
      setAvatarUrl(signed.public_url);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Upload failed";
      Alert.alert("Couldn't upload", msg);
    } finally {
      setUploadingAvatar(false);
    }
  };

  const save = useMutation({
    mutationFn: () =>
      userApi.updateMe(accessToken!, {
        display_name: displayName.trim() || null,
        bio: bio.trim() || null,
        avatar_url: avatarUrl,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile", user?.handle] });
      updateUser({ display_name: displayName.trim() || null });
      router.back();
    },
    onError: err => {
      const msg = err instanceof ApiError ? err.message : "Couldn't save";
      Alert.alert("Save failed", msg);
    },
  });

  const bioRemaining = 280 - bio.length;
  const canSave = !save.isPending;

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
          <Text style={styles.topTitle}>Edit profile</Text>
          <Pressable
            onPress={() => canSave && save.mutate()}
            disabled={!canSave}
            hitSlop={8}
            style={[styles.saveBtn, !canSave && { opacity: 0.4 }]}
          >
            {save.isPending ? (
              <ActivityIndicator color={colors.bg} size="small" />
            ) : (
              <Text style={styles.saveBtnText}>Save</Text>
            )}
          </Pressable>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: spacing.xl }}
          keyboardShouldPersistTaps="handled"
        >
          {meQuery.isLoading ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <>
              {/* Avatar picker — tap to swap in a new image. Upload happens
                  immediately; the URL is saved to the user's profile when
                  they hit Save. Shows a spinner while uploading. */}
              <View style={styles.avatarBlock}>
                <Pressable onPress={pickAvatar} disabled={uploadingAvatar} style={styles.avatarWrap}>
                  {avatarUrl ? (
                    <Image source={{ uri: avatarUrl }} style={styles.avatar} contentFit="cover" />
                  ) : (
                    <View style={[styles.avatar, styles.avatarPlaceholder]}>
                      <Text style={styles.avatarInitial}>
                        {(user?.handle ?? "?").slice(0, 2).toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <View style={styles.avatarBadge}>
                    {uploadingAvatar ? (
                      <ActivityIndicator size="small" color={colors.bg} />
                    ) : (
                      <Icon name="image" size={12} color={colors.bg} />
                    )}
                  </View>
                </Pressable>
              </View>

              <Text style={styles.label}>Display name</Text>
              <TextInput
                style={styles.input}
                value={displayName}
                onChangeText={setDisplayName}
                placeholder="e.g. Jane A."
                placeholderTextColor={colors.t3}
                maxLength={60}
                autoCapitalize="words"
              />
              <Text style={styles.help}>
                Shows on your profile. Leave blank to display @{user?.handle} only.
              </Text>

              <Text style={[styles.label, { marginTop: spacing.xl }]}>Bio</Text>
              <TextInput
                style={[styles.input, styles.multiline]}
                value={bio}
                onChangeText={t => t.length <= 280 && setBio(t)}
                placeholder="A short intro"
                placeholderTextColor={colors.t3}
                multiline
              />
              <Text style={styles.charCount}>{bioRemaining} left</Text>

              <View style={styles.divider} />

              {/* Burner management — dedicated screen shows active + retired */}
              <Pressable
                onPress={() => router.push("/burners")}
                style={styles.linkRow}
              >
                <Icon name="mask" size={16} color={colors.anon} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.linkRowTitle}>Burner identity</Text>
                  <Text style={styles.linkRowSub}>Manage your anonymous handle</Text>
                </View>
                <Icon name="chevron-down" size={16} color={colors.t3} />
              </Pressable>

              <View style={styles.divider} />

              <Pressable
                onPress={() => router.push("/blocked")}
                style={styles.linkRow}
              >
                <Icon name="close" size={16} color={colors.t2} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.linkRowTitle}>Blocked accounts</Text>
                  <Text style={styles.linkRowSub}>See and unblock accounts you've blocked</Text>
                </View>
                <Icon name="chevron-down" size={16} color={colors.t3} />
              </Pressable>

              {/* Admin-only link — server-side gate on /admin/* still
                  enforces access; this just hides the entry point from
                  non-admins so they don't wonder what it is. */}
              {meQuery.data?.is_admin && (
                <>
                  <View style={styles.divider} />
                  <Pressable
                    onPress={() => router.push("/admin")}
                    style={styles.linkRow}
                  >
                    <Icon name="radar" size={16} color="#f97316" />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.linkRowTitle}>Moderation queue</Text>
                      <Text style={styles.linkRowSub}>Review reports and take action</Text>
                    </View>
                    <Icon name="chevron-down" size={16} color={colors.t3} />
                  </Pressable>
                </>
              )}

              <View style={styles.divider} />

              {/* Discovery range slider — controls the "Showing within"
                  radius on Feed. Persisted in AsyncStorage via prefs. */}
              <RangeSetting />

              <View style={styles.divider} />

              {/* Privacy toggles */}
              <PrivacySettings token={accessToken!} />

              <View style={styles.divider} />

              <Pressable
                onPress={() => setSignOutOpen(true)}
                style={styles.signOutBtn}
              >
                <Text style={styles.signOutBtnText}>Sign out</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <ConfirmDialog
        visible={signOutOpen}
        onClose={() => setSignOutOpen(false)}
        title="Sign out?"
        message="You'll be returned to the login screen."
        confirmLabel="Sign out"
        onConfirm={doSignOut}
        destructive
        icon="close"
      />
    </SafeAreaView>
  );
}

// ── Discovery range slider ────────────────────────────────────────────────
// Purely-client preference persisted via lib/preferences. Snaps to
// 10-meter increments below 100m and 50-meter increments above so
// slider labels stay tidy. Feed re-fetches automatically because
// its useQuery keys on the range.
function RangeSetting() {
  const { discovery_range_m } = usePreferences();
  const value = discovery_range_m ?? 500;
  const displayed = value >= 1000 ? "1km" : `${value}m`;
  return (
    <View style={styles.linkRow}>
      <Icon name="radar" size={16} color={colors.t2} />
      <View style={{ flex: 1 }}>
        <Text style={styles.linkRowTitle}>Showing within</Text>
        <Text style={styles.linkRowSub}>Feed radius · {displayed}</Text>
        <Slider
          style={{ marginTop: 6, height: 32 }}
          minimumValue={RANGE_MIN_M}
          maximumValue={RANGE_MAX_M}
          step={10}
          value={value}
          onSlidingComplete={(v) => {
            // Round to 10m below 100m, 50m above — keeps values tidy.
            const snapped = v < 100 ? Math.round(v / 10) * 10 : Math.round(v / 50) * 50;
            setPreference("discovery_range_m", snapped);
          }}
          minimumTrackTintColor={colors.accent}
          maximumTrackTintColor={colors.s3}
          thumbTintColor={colors.accent}
        />
      </View>
    </View>
  );
}

// ── Privacy toggles ───────────────────────────────────────────────────────
// hide_last_seen + nearby_alerts_enabled. Server-persisted so they
// apply across devices; local state mirrors the server for optimistic UI.
function PrivacySettings({ token }: { token: string }) {
  const prefsQ = useQuery({
    queryKey: ["me-preferences"],
    queryFn: () => preferencesApi.get(token),
  });
  const mut = useMutation({
    mutationFn: (patch: any) => preferencesApi.patch(token, patch),
    onSuccess: () => prefsQ.refetch(),
  });
  const prefs = prefsQ.data ?? { hide_last_seen: false, nearby_alerts_enabled: true };
  return (
    <>
      <View style={styles.linkRow}>
        <Icon name="eye" size={16} color={colors.t2} />
        <View style={{ flex: 1 }}>
          <Text style={styles.linkRowTitle}>Hide last seen</Text>
          <Text style={styles.linkRowSub}>Others won't see when you were last active</Text>
        </View>
        <Toggle
          value={prefs.hide_last_seen}
          onChange={(v) => mut.mutate({ hide_last_seen: v })}
        />
      </View>
      {/* Match the divider pattern the rest of Settings uses so the two
          toggle cards don't visually fuse into one block. */}
      <View style={styles.divider} />
      <View style={styles.linkRow}>
        <Icon name="radar" size={16} color={colors.t2} />
        <View style={{ flex: 1 }}>
          <Text style={styles.linkRowTitle}>Nearby alerts</Text>
          <Text style={styles.linkRowSub}>Push when new clustars pop up around you</Text>
        </View>
        <Toggle
          value={prefs.nearby_alerts_enabled}
          onChange={(v) => mut.mutate({ nearby_alerts_enabled: v })}
        />
      </View>
    </>
  );
}

// Minimal iOS-style toggle. Two states, animated shift by resetting
// the transform. Keeps external deps to zero.
function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable
      onPress={() => onChange(!value)}
      style={{
        width: 44, height: 26, borderRadius: 13,
        backgroundColor: value ? colors.accent : colors.s3,
        justifyContent: "center",
        padding: 2,
      }}
    >
      <View
        style={{
          width: 22, height: 22, borderRadius: 11,
          backgroundColor: "#fff",
          transform: [{ translateX: value ? 18 : 0 }],
        }}
      />
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
  saveBtn: {
    backgroundColor: colors.accent,
    paddingHorizontal: 20, paddingVertical: 8,
    borderRadius: 20, minWidth: 68, alignItems: "center",
  },
  saveBtnText: { color: colors.bg, fontWeight: "600", fontSize: 13 },
  label: { color: colors.t3, fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  input: {
    backgroundColor: colors.s2,
    borderWidth: 1, borderColor: colors.borderS, borderRadius: radius.md,
    paddingHorizontal: 14, paddingVertical: 12,
    color: colors.t1, fontSize: 15,
  },
  multiline: { minHeight: 90, textAlignVertical: "top", paddingTop: 12 },
  help: { color: colors.t3, fontSize: 11, marginTop: 6 },
  charCount: { color: colors.t3, fontSize: 11, textAlign: "right", marginTop: 4 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.xxl },
  signOutBtn: {
    borderWidth: 1, borderColor: colors.dangerBg,
    paddingVertical: 12, borderRadius: 12, alignItems: "center",
  },
  signOutBtnText: { color: colors.danger, fontWeight: "600", fontSize: 14 },

  avatarBlock: { alignItems: "center", marginBottom: spacing.xl },
  avatarWrap: { width: 96, height: 96, position: "relative" },
  avatar: { width: 96, height: 96, borderRadius: 48, backgroundColor: colors.s2 },
  avatarPlaceholder: {
    backgroundColor: colors.accentBg,
    alignItems: "center", justifyContent: "center",
  },
  avatarInitial: { color: colors.accent, fontSize: 28, fontWeight: "700" },
  avatarBadge: {
    position: "absolute",
    right: 0, bottom: 0,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: colors.accent,
    alignItems: "center", justifyContent: "center",
    borderWidth: 3, borderColor: colors.bg,
  },

  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.s2,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 14, paddingHorizontal: 14,
  },
  linkRowTitle: { color: colors.t1, fontSize: 14, fontWeight: "600" },
  linkRowSub: { color: colors.t3, fontSize: 12, marginTop: 2 },
});
