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
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { authApi, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/lib/toast";
import { Icon } from "@/components/Icon";
import { colors, radius, spacing } from "@/lib/theme";

// Email auth screen with signup/login tabs. Design mirrors the mockup:
// segmented control at the top, email + password with show/hide, password
// strength on signup, forgot-password link on login.
//
// On signup: server issues tokens BUT emailVerified=false, so we route
// through /email-verify before the rest of onboarding.
// On login: if the account already verified email, straight to feed;
// otherwise same verify-then-continue path.

type Mode = "signup" | "login";

export default function EmailAuthScreen() {
  const router = useRouter();
  const { signIn } = useAuth();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [busy, setBusy] = useState(false);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const passwordValid = password.length >= 8;
  const canSubmit = emailValid && passwordValid && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      const fn = mode === "signup" ? authApi.signupEmail : authApi.loginEmail;
      const res = await fn(email.trim(), password);

      // Decide the exact starting step. Email verification is a HARD gate —
      // any unverified email account starts at "email-verify" and can't
      // reach the feed until they verify.
      const step = !res.emailVerified
        ? "email-verify"
        : res.isNew
        ? "handle"
        : "complete";

      await signIn(res.accessToken, res.refreshToken, res.user, { step });

      if (!res.emailVerified) {
        // Fire the verification email in the background — screen also
        // exposes a Resend button in case this call ever fails.
        authApi.sendEmailVerification(email.trim()).catch(() => {});
      }
      // AuthGate handles the redirect based on the step we just set.
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Something went wrong";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const strength = passwordStrength(password);

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
          <Pressable onPress={() => router.back()} style={styles.back} hitSlop={12}>
            <Icon name="back" size={20} color={colors.t2} />
          </Pressable>

          <Text style={styles.brand}>
            Clust<Text style={{ color: colors.accent }}>a</Text>r
          </Text>

          {/* Signup/Login segmented control */}
          <View style={styles.tabs}>
            <Pressable
              onPress={() => setMode("signup")}
              style={[styles.tab, mode === "signup" && styles.tabActive]}
            >
              <Text style={[styles.tabText, mode === "signup" && styles.tabTextActive]}>
                Sign up
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setMode("login")}
              style={[styles.tab, mode === "login" && styles.tabActive]}
            >
              <Text style={[styles.tabText, mode === "login" && styles.tabTextActive]}>
                Log in
              </Text>
            </Pressable>
          </View>

          {/* Email */}
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
              autoComplete="email"
            />
          </View>

          {/* Password with show/hide */}
          <View style={styles.inputWrap}>
            <TextInput
              style={[styles.input, { paddingLeft: 4 }]}
              placeholder={mode === "signup" ? "Create a password (min 8)" : "Password"}
              placeholderTextColor={colors.t3}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPass}
              autoCapitalize="none"
              autoComplete={mode === "signup" ? "new-password" : "password"}
            />
            <Pressable onPress={() => setShowPass(v => !v)} hitSlop={8}>
              <Text style={{ color: colors.t3, fontSize: 12 }}>{showPass ? "Hide" : "Show"}</Text>
            </Pressable>
          </View>

          {/* Password strength meter — signup only */}
          {mode === "signup" && password.length > 0 && (
            <View style={styles.strengthWrap}>
              <View style={styles.strengthBars}>
                {[0, 1, 2].map(i => (
                  <View
                    key={i}
                    style={[
                      styles.strengthBar,
                      i < strength.score && { backgroundColor: strength.color },
                    ]}
                  />
                ))}
              </View>
              <Text style={[styles.strengthLabel, { color: strength.color }]}>
                {strength.label}
              </Text>
            </View>
          )}

          {mode === "login" && (
            <Pressable
              onPress={() => router.push("/(auth)/password-reset")}
              hitSlop={8}
              style={{ alignSelf: "flex-end", marginBottom: 12 }}
            >
              <Text style={styles.link}>Forgot password?</Text>
            </Pressable>
          )}

          <Pressable
            style={[styles.submitBtn, !canSubmit && { opacity: 0.4 }]}
            onPress={submit}
            disabled={!canSubmit}
          >
            {busy ? (
              <ActivityIndicator color={colors.bg} />
            ) : (
              <Text style={styles.submitBtnText}>
                {mode === "signup" ? "Create account" : "Log in"}
              </Text>
            )}
          </Pressable>

          <Text style={styles.footerText}>
            {mode === "signup" ? "Already have one? " : "New to Clustar? "}
            <Text
              style={styles.link}
              onPress={() => setMode(m => (m === "signup" ? "login" : "signup"))}
            >
              {mode === "signup" ? "Log in" : "Sign up"}
            </Text>
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// Simple heuristic — length + character-class variety. Not zxcvbn but good
// enough for a signup hint.
function passwordStrength(pw: string): { score: 0 | 1 | 2 | 3; label: string; color: string } {
  if (pw.length === 0) return { score: 0, label: "", color: colors.t4 };
  const hasLower = /[a-z]/.test(pw);
  const hasUpper = /[A-Z]/.test(pw);
  const hasNum = /\d/.test(pw);
  const hasSym = /[^\w]/.test(pw);
  const variety = [hasLower, hasUpper, hasNum, hasSym].filter(Boolean).length;

  if (pw.length < 8) return { score: 1, label: "Too short", color: colors.danger };
  if (pw.length < 12 && variety < 3) return { score: 2, label: "OK", color: colors.accent };
  return { score: 3, label: "Strong", color: colors.success };
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { flexGrow: 1, padding: spacing.xxl, justifyContent: "center" },
  back: { position: "absolute", top: 20, left: 20, padding: 8 },
  brand: {
    fontSize: 32,
    fontWeight: "700",
    color: colors.t1,
    textAlign: "center",
    letterSpacing: -0.8,
    marginBottom: 28,
  },
  tabs: {
    flexDirection: "row",
    backgroundColor: colors.s2,
    borderRadius: 12,
    padding: 3,
    marginBottom: 24,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 10,
  },
  tabActive: { backgroundColor: colors.s4 },
  tabText: { color: colors.t2, fontSize: 13, fontWeight: "500" },
  tabTextActive: { color: colors.t1 },
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
    marginBottom: 12,
  },
  input: { flex: 1, color: colors.t1, fontSize: 15 },
  strengthWrap: { marginBottom: 12 },
  strengthBars: { flexDirection: "row", gap: 4, marginBottom: 4 },
  strengthBar: { flex: 1, height: 3, borderRadius: 2, backgroundColor: colors.s3 },
  strengthLabel: { fontSize: 11 },
  link: { color: colors.accent, fontSize: 13 },
  submitBtn: {
    backgroundColor: colors.accent,
    paddingVertical: 14,
    borderRadius: 24,
    alignItems: "center",
    marginTop: 12,
  },
  submitBtnText: { color: colors.bg, fontWeight: "600", fontSize: 15 },
  footerText: {
    color: colors.t3,
    fontSize: 13,
    textAlign: "center",
    marginTop: 16,
  },
});
