import { useRef, useState } from "react";
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
import { colors, radius, spacing } from "@/lib/theme";

const CELLS = 6;

export default function OtpScreen() {
  const { phone, returnTo } = useLocalSearchParams<{ phone?: string; returnTo?: string }>();
  const router = useRouter();
  const { signIn, signOut } = useAuth();
  const toast = useToast();
  const [digits, setDigits] = useState<string[]>(Array(CELLS).fill(""));
  const [loading, setLoading] = useState(false);
  const inputs = useRef<Array<TextInput | null>>([]);

  const handleBack = async () => {
    await signOut();
    if (returnTo) {
      router.replace(returnTo as string);
      return;
    }
    router.replace("/(auth)/splash");
  };

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
    if (!phone) return;
    setLoading(true);
    try {
      const res = await authApi.verifyOtp(phone, code);
      // NEW phone signups skip email-verify entirely (no email to check)
      // and go straight to handle → location → feed.
      // EXISTING users are already onboarded.
      await signIn(res.accessToken, res.refreshToken, res.user, {
        step: res.isNew ? "handle" : "complete",
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Invalid code";
      toast.error(msg);
      setDigits(Array(CELLS).fill(""));
      inputs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Pressable onPress={handleBack} style={styles.back}>
          <Text style={{ color: colors.t2, fontSize: 15 }}>← Back</Text>
        </Pressable>

        <Text style={styles.title}>Enter the code</Text>
        <Text style={styles.subtitle}>Sent to {phone}</Text>

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
              editable={!loading}
            />
          ))}
        </View>

        <Text style={{ color: colors.t3, textAlign: "center", fontSize: 12, marginTop: spacing.md }}>
          {loading ? "Verifying..." : "The code auto-submits when all 6 digits are entered"}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, padding: spacing.xxl, justifyContent: "center" },
  back: { position: "absolute", top: 60, left: spacing.xxl },
  title: { fontSize: 22, fontWeight: "700", color: colors.t1, marginBottom: spacing.sm, textAlign: "center" },
  subtitle: { fontSize: 14, color: colors.t2, marginBottom: spacing.xxl, textAlign: "center" },
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
});
