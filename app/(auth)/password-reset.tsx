import { useState } from "react";
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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { authApi, ApiError } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { Icon } from "@/components/Icon";
import { colors, radius, spacing } from "@/lib/theme";

// Step 1 of password reset — enter email, we send a 6-digit code.
// Server response is deliberately generic ("code sent if account exists")
// so this endpoint can't be used to check whether an email is registered.

export default function PasswordResetScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const submit = async () => {
    if (!emailValid) return;
    setBusy(true);
    try {
      await authApi.requestPasswordReset(email.trim());
      router.replace({
        pathname: "/(auth)/password-reset-verify",
        params: { email: email.trim() },
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Couldn't send code";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.container}>
          <Pressable onPress={() => router.back()} style={styles.back} hitSlop={12}>
            <Icon name="back" size={20} color={colors.t2} />
          </Pressable>

          <View style={styles.artWrap}>
            <View style={styles.artCircle}>
              <Icon name="mail" size={36} color={colors.accent} />
            </View>
          </View>

          <Text style={styles.title}>Reset your password</Text>
          <Text style={styles.subtitle}>
            Enter your email and we'll send you a 6-digit code to set a new
            password.
          </Text>

          <View style={styles.inputWrap}>
            <Icon name="mail" size={16} color={colors.t3} />
            <TextInput
              style={styles.input}
              placeholder="you@example.com"
              placeholderTextColor={colors.t3}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              editable={!busy}
            />
          </View>

          <Pressable
            style={[styles.primaryBtn, (!emailValid || busy) && { opacity: 0.4 }]}
            onPress={submit}
            disabled={!emailValid || busy}
          >
            {busy ? (
              <ActivityIndicator color={colors.bg} />
            ) : (
              <Text style={styles.primaryBtnText}>Send code</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, padding: spacing.xxl, justifyContent: "center" },
  back: { position: "absolute", top: 20, left: 20, padding: 8 },
  artWrap: { alignItems: "center", marginBottom: spacing.xxl },
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
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.s2,
    borderWidth: 1,
    borderColor: colors.borderS,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 16,
  },
  input: { flex: 1, color: colors.t1, fontSize: 15 },
  primaryBtn: {
    backgroundColor: colors.accent,
    paddingVertical: 14,
    borderRadius: 24,
    alignItems: "center",
  },
  primaryBtnText: { color: colors.bg, fontWeight: "600", fontSize: 15 },
});
