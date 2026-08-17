import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { authApi, ApiError } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { Icon } from "@/components/Icon";
import { colors, radius, spacing } from "@/lib/theme";

// Step 2 of password reset — verify the emailed code + set a new password.
// On success the server revokes every existing refresh token for the account,
// so any other device signed in with the old password gets kicked out on
// its next silent-refresh. This screen surfaces that in the confirmation.

const CELLS = 6;
const RESEND_COOLDOWN_S = 30;

export default function PasswordResetVerifyScreen() {
  const { email } = useLocalSearchParams<{ email: string }>();
  const router = useRouter();
  const [digits, setDigits] = useState<string[]>(Array(CELLS).fill(""));

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/(auth)/splash");
  };
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_S);
  const inputs = useRef<Array<TextInput | null>>([]);
  const toast = useToast();

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const setDigit = (i: number, v: string) => {
    const cleaned = v.replace(/\D/g, "").slice(0, 1);
    const next = [...digits];
    next[i] = cleaned;
    setDigits(next);
    if (cleaned && i < CELLS - 1) inputs.current[i + 1]?.focus();
  };

  const onKey = (i: number, key: string) => {
    if (key === "Backspace" && !digits[i] && i > 0) inputs.current[i - 1]?.focus();
  };

  const code = digits.join("");
  const codeReady = code.length === CELLS;
  const passwordReady = password.length >= 8;
  const canSubmit = codeReady && passwordReady && !busy && !!email;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      await authApi.resetPassword(email as string, code, password);
      Alert.alert(
        "Password updated",
        "Every device signed in with your old password has been signed out. Log in with your new password now.",
        [{ text: "OK", onPress: () => router.replace("/(auth)/email") }]
      );
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Couldn't reset";
      toast.error(msg);
      setDigits(Array(CELLS).fill(""));
      inputs.current[0]?.focus();
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!email || cooldown > 0) return;
    try {
      await authApi.requestPasswordReset(email as string);
      setCooldown(RESEND_COOLDOWN_S);
      toast.success(`New code emailed to ${email}`);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Couldn't resend";
      toast.error(msg);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Pressable onPress={handleBack} style={styles.back} hitSlop={12}>
            <Icon name="back" size={20} color={colors.t2} />
          </Pressable>

          <View style={styles.artWrap}>
            <View style={styles.artCircle}>
              <Icon name="mail" size={36} color={colors.accent} />
            </View>
          </View>

          <Text style={styles.title}>Set a new password</Text>
          <Text style={styles.subtitle}>
            We sent a 6-digit code to <Text style={{ color: colors.t1 }}>{email}</Text>.
          </Text>

          <View style={styles.row}>
            {digits.map((d, i) => (
              <TextInput
                key={i}
                ref={el => (inputs.current[i] = el)}
                style={[styles.cell, d && styles.cellFilled]}
                value={d}
                onChangeText={v => setDigit(i, v)}
                onKeyPress={({ nativeEvent }) => onKey(i, nativeEvent.key)}
                keyboardType="number-pad"
                maxLength={1}
                autoFocus={i === 0}
                editable={!busy}
              />
            ))}
          </View>

          <View style={styles.pwRow}>
            <TextInput
              style={styles.pwInput}
              placeholder="New password (min 8)"
              placeholderTextColor={colors.t3}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPass}
              autoCapitalize="none"
              autoComplete="new-password"
              editable={!busy}
            />
            <Pressable onPress={() => setShowPass(v => !v)} hitSlop={8}>
              <Text style={{ color: colors.t3, fontSize: 12 }}>{showPass ? "Hide" : "Show"}</Text>
            </Pressable>
          </View>

          <Pressable
            style={[styles.primaryBtn, !canSubmit && { opacity: 0.4 }]}
            onPress={submit}
            disabled={!canSubmit}
          >
            {busy ? (
              <ActivityIndicator color={colors.bg} />
            ) : (
              <Text style={styles.primaryBtnText}>Update password</Text>
            )}
          </Pressable>

          <View style={{ alignItems: "center", marginTop: spacing.lg }}>
            <Pressable onPress={resend} disabled={cooldown > 0} hitSlop={8}>
              <Text style={[styles.resend, cooldown > 0 && { color: colors.t3 }]}>
                {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { flexGrow: 1, padding: spacing.xxl, justifyContent: "center" },
  back: { position: "absolute", top: 20, left: 20, padding: 8 },
  artWrap: { alignItems: "center", marginBottom: spacing.xl },
  artCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.accentBg,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: colors.t1,
    textAlign: "center",
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 14,
    color: colors.t2,
    textAlign: "center",
    lineHeight: 21,
    marginBottom: spacing.xl,
  },
  row: { flexDirection: "row", justifyContent: "center", gap: 8, marginBottom: spacing.lg },
  cell: {
    width: 46,
    height: 54,
    backgroundColor: colors.s2,
    borderWidth: 1,
    borderColor: colors.borderS,
    borderRadius: radius.md,
    fontSize: 22,
    fontWeight: "600",
    color: colors.t1,
    textAlign: "center",
  },
  cellFilled: { borderColor: colors.accent, backgroundColor: colors.accentBg },
  pwRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.s2,
    borderWidth: 1,
    borderColor: colors.borderS,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    marginBottom: spacing.lg,
  },
  pwInput: { flex: 1, paddingVertical: 14, color: colors.t1, fontSize: 15 },
  primaryBtn: {
    backgroundColor: colors.accent,
    paddingVertical: 14,
    borderRadius: 24,
    alignItems: "center",
  },
  primaryBtnText: { color: colors.bg, fontWeight: "600", fontSize: 15 },
  resend: { color: colors.accent, fontSize: 13, fontWeight: "500", padding: 8 },
});
