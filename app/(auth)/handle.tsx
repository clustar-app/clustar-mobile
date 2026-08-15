import { useEffect, useMemo, useRef, useState } from "react";
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
import { authApi, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/lib/toast";
import { colors, radius, spacing } from "@/lib/theme";

// Onboarding step: pick a public handle. Required for every new user
// regardless of auth mode. Skip is deliberately removed — the auto-assigned
// `user_xxxxxxxx` isn't a real identity and doesn't belong on someone's card.
// User MUST type a real handle to continue.

const HANDLE_RE = /^[a-zA-Z0-9_]{3,20}$/;
const AUTO_HANDLE_RE = /^user_[a-f0-9]{8}$/i;

type CheckState = "idle" | "checking" | "ok" | "taken" | "invalid";

export default function HandleScreen() {
  const { user, accessToken, updateUser, setOnboardingStep } = useAuth();
  const toast = useToast();
  // Empty initial value so users are forced to type their own — pre-filling
  // with `user_xxxxxxxx` invites them to just tap Continue and keep it.
  const [handle, setHandle] = useState("");
  const [state, setState] = useState<CheckState>("idle");
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<any>();

  useEffect(() => {
    const trimmed = handle.trim();
    if (!trimmed) {
      setState("idle");
      return;
    }
    if (!HANDLE_RE.test(trimmed)) {
      setState("invalid");
      return;
    }
    // Refuse the auto-generated shape — it's not a "real" handle.
    if (AUTO_HANDLE_RE.test(trimmed)) {
      setState("invalid");
      return;
    }
    setState("checking");
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const { available } = await authApi.checkHandle(trimmed);
        setState(available ? "ok" : "taken");
      } catch {
        setState("idle");
      }
    }, 400);
    return () => clearTimeout(debounceRef.current);
  }, [handle]);

  const canContinue = state === "ok" && !saving;

  const onContinue = async () => {
    if (!canContinue) return;
    setSaving(true);
    try {
      const res = await authApi.setHandle(accessToken!, handle.trim());
      await updateUser({ handle: res.user.handle });
      await setOnboardingStep("location");
      // AuthGate reacts to step change and routes to /location automatically.
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Couldn't save handle";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const feedback = useMemo(() => {
    switch (state) {
      case "checking":
        return { text: "Checking...", color: colors.t3 };
      case "ok":
        return { text: "Available ✓", color: colors.success };
      case "taken":
        return { text: "Already taken", color: colors.danger };
      case "invalid":
        return {
          text: "3–20 letters, numbers, or _ · can't start with user_",
          color: colors.t3,
        };
      default:
        return null;
    }
  }, [state]);

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.container}>
          <Text style={styles.title}>Pick a handle</Text>
          <Text style={styles.subtitle}>
            This is how people see you across Clustar. You can still post
            anonymously with a burner in each clustar.
          </Text>

          <View style={styles.inputRow}>
            <Text style={styles.at}>@</Text>
            <TextInput
              style={styles.input}
              value={handle}
              onChangeText={setHandle}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              maxLength={20}
              placeholder="yourhandle"
              placeholderTextColor={colors.t3}
              editable={!saving}
            />
          </View>

          <View style={styles.feedbackRow}>
            {state === "checking" && <ActivityIndicator size="small" color={colors.t3} />}
            {feedback && (
              <Text style={{ color: feedback.color, fontSize: 12, textAlign: "center" }}>
                {feedback.text}
              </Text>
            )}
          </View>

          <Pressable
            style={[styles.primaryBtn, !canContinue && { opacity: 0.4 }]}
            onPress={onContinue}
            disabled={!canContinue}
          >
            {saving ? (
              <ActivityIndicator color={colors.bg} />
            ) : (
              <Text style={styles.primaryBtnText}>Continue</Text>
            )}
          </Pressable>

          <Text style={styles.hint}>
            Signed in as {user?.email ?? user?.handle ?? "you"}
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, padding: spacing.xxl, justifyContent: "center" },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: colors.t1,
    marginBottom: spacing.sm,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    color: colors.t2,
    lineHeight: 21,
    marginBottom: spacing.xxl,
    textAlign: "center",
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.s2,
    borderWidth: 1,
    borderColor: colors.borderS,
    borderRadius: radius.md,
    paddingHorizontal: 14,
  },
  at: { color: colors.t3, fontSize: 17, marginRight: 4 },
  input: {
    flex: 1,
    paddingVertical: 14,
    color: colors.t1,
    fontSize: 17,
  },
  feedbackRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 24,
    marginTop: 8,
    marginBottom: 16,
    justifyContent: "center",
  },
  primaryBtn: {
    backgroundColor: colors.accent,
    paddingVertical: 14,
    borderRadius: 24,
    alignItems: "center",
    marginTop: 8,
  },
  primaryBtnText: { color: colors.bg, fontWeight: "600", fontSize: 15 },
  hint: { color: colors.t3, fontSize: 12, textAlign: "center", marginTop: 24 },
});
