import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { authApi, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/lib/toast";
import { Icon } from "@/components/Icon";
import { colors, radius, spacing } from "@/lib/theme";

// 6-digit code input mirroring the phone OTP screen. Sits BETWEEN signup and
// the rest of onboarding (handle → location). On success we route to /handle
// so users continue the same flow phone-signups take.

const CELLS = 6;
const RESEND_COOLDOWN_S = 30;

export default function EmailVerifyScreen() {
  const params = useLocalSearchParams<{ email?: string }>();
  const router = useRouter();
  const { user, updateUser, setOnboardingStep } = useAuth();
  const toast = useToast();
  // Email comes from either the route param (fresh signup flow) or the
  // signed-in user (resume path after killing/reopening the app).
  const email = params.email ?? user?.email ?? "";
  const [digits, setDigits] = useState<string[]>(Array(CELLS).fill(""));
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_S);
  const inputs = useRef<Array<TextInput | null>>([]);

  // Countdown for the resend button so users can't spam.
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
    if (next.every(d => d.length === 1)) verify(next.join(""));
  };

  const onKey = (i: number, key: string) => {
    if (key === "Backspace" && !digits[i] && i > 0) inputs.current[i - 1]?.focus();
  };

  const verify = async (code: string) => {
    if (!email) return;
    setBusy(true);
    try {
      await authApi.verifyEmail(email, code);
      // Update local user + advance the onboarding step so a mid-flow
      // kill-and-reopen resumes at handle, not back at verify.
      await updateUser({ email_verified: true });
      await setOnboardingStep("handle");
      // AuthGate reacts to the step change and routes automatically.
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Invalid code";
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
      await authApi.sendEmailVerification(email);
      setCooldown(RESEND_COOLDOWN_S);
      toast.success(`New code emailed to ${email}`);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Couldn't resend";
      toast.error(msg);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.artWrap}>
          <View style={styles.artCircle}>
            <Icon name="mail" size={40} color={colors.accent} />
          </View>
        </View>

        <Text style={styles.title}>Check your email</Text>
        <Text style={styles.subtitle}>
          We sent a 6-digit code to <Text style={{ color: colors.t1 }}>{email}</Text>. In dev,
          it also prints to the API terminal.
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

        <Text style={{ color: colors.t3, textAlign: "center", fontSize: 12, marginTop: spacing.md }}>
          {busy ? "Verifying..." : "Auto-submits when all 6 digits are entered"}
        </Text>

        <View style={{ marginTop: spacing.xxl, alignItems: "center" }}>
          <Pressable onPress={resend} disabled={cooldown > 0} hitSlop={8}>
            <Text style={[styles.resend, cooldown > 0 && { color: colors.t3 }]}>
              {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, padding: spacing.xxl, justifyContent: "center" },
  artWrap: { alignItems: "center", marginBottom: spacing.xxl },
  artCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
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
    marginBottom: spacing.xxl,
  },
  row: { flexDirection: "row", justifyContent: "center", gap: 8 },
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
  resend: { color: colors.accent, fontSize: 13, fontWeight: "500", padding: 8 },
});
