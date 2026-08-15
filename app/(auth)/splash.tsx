import { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, Animated, Easing, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { AntDesign } from "@expo/vector-icons";
import { authApi, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useGoogleAuth, googleConfigured } from "@/lib/googleAuth";
import { useToast } from "@/lib/toast";
import { colors, spacing } from "@/lib/theme";

// Splash — the first thing signed-out users see. Two paths out:
//   "Get started" → welcome (value prop) → phone
//   "I have an account" → phone directly
// Animated concentric rings behind the wordmark, mirroring the HTML mockup.

export default function SplashScreen() {
  const router = useRouter();
  const { signIn } = useAuth();
  const { promptAsync, response, request } = useGoogleAuth();
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  // React to Google's redirect. On success we have an id_token, we POST it
  // to our /auth/oauth/google endpoint which verifies and returns our
  // token pair. isNew=true routes through onboarding just like OTP signup.
  useEffect(() => {
    if (response?.type !== "success") return;
    const idToken = response.params?.id_token;
    if (!idToken) return;
    (async () => {
      setBusy(true);
      try {
        const res = await authApi.signInWithGoogle(idToken);
        // Google already verified email at their end → skip email-verify.
        // New Google users still pick a handle + grant location.
        await signIn(res.accessToken, res.refreshToken, res.user, {
          step: res.isNew ? "handle" : "complete",
        });
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : "Google sign-in failed";
        toast.error(msg);
      } finally {
        setBusy(false);
      }
    })();
  }, [response, signIn]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.artWrap}>
          <PulseRings />
          <Text style={styles.brand}>
            Clust<Text style={{ color: colors.accent }}>a</Text>r
          </Text>
          <Text style={styles.tagline}>the people around you are talking</Text>
        </View>

        <View style={styles.actions}>
          <Pressable
            style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.9 }]}
            onPress={() => router.push("/(auth)/welcome")}
          >
            <Text style={styles.primaryBtnText}>Get started</Text>
          </Pressable>

          {/* Divider then OAuth. Only render Google button if credentials
              are wired in app.json — otherwise it would open a broken flow. */}
          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          {googleConfigured && (
            <Pressable
              style={[styles.oauthBtn, busy && { opacity: 0.6 }]}
              onPress={() => promptAsync()}
              disabled={busy || !request}
            >
              <AntDesign name="google" size={18} color="#000" />
              <Text style={styles.oauthBtnText}>Continue with Google</Text>
            </Pressable>
          )}

          <Pressable
            style={styles.emailBtn}
            onPress={() => router.push("/(auth)/email")}
          >
            <Text style={styles.emailBtnText}>Continue with email</Text>
          </Pressable>

          <Pressable onPress={() => router.push("/(auth)/phone")} hitSlop={10}>
            <Text style={styles.ghostBtnText}>I have an account</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

// Three staggered rings that scale up and fade out on loop — same visual
// vocabulary as the FeedCard PulseDot, sized for a full-screen hero.
//
// Previously the delay was INSIDE the sequence, so each iteration waited
// again — leaving big dead gaps. Now the stagger happens once via setTimeout
// on the initial start, and each ring loops just the timing tick, giving
// a continuous ripple that never pauses.
function PulseRings() {
  const anim1 = useRef(new Animated.Value(0)).current;
  const anim2 = useRef(new Animated.Value(0)).current;
  const anim3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anims = [anim1, anim2, anim3];
    const loops: Animated.CompositeAnimation[] = [];
    const timers: any[] = [];

    anims.forEach((val, i) => {
      // resetBeforeIteration defaults to true — the value returns to 0
      // between loop iterations so the ring genuinely re-expands.
      const loop = Animated.loop(
        Animated.timing(val, {
          toValue: 1,
          duration: 2400,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        })
      );
      loops.push(loop);
      // Stagger the START of each ring only, not each iteration.
      timers.push(setTimeout(() => loop.start(), i * 800));
    });

    return () => {
      timers.forEach(clearTimeout);
      loops.forEach(l => l.stop());
    };
  }, [anim1, anim2, anim3]);

  const ringStyle = (v: Animated.Value) => ({
    transform: [
      {
        scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.15, 1] }),
      },
    ],
    opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
  });

  return (
    <View style={styles.ringsWrap} pointerEvents="none">
      <Animated.View style={[styles.ring, ringStyle(anim1)]} />
      <Animated.View style={[styles.ring, ringStyle(anim2)]} />
      <Animated.View style={[styles.ring, ringStyle(anim3)]} />
      <View style={styles.centerDot} />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, alignItems: "center", justifyContent: "space-between", padding: spacing.xxl },
  // artWrap now stacks vertically: rings block on top, then wordmark, then
  // tagline. No overlap between the animated centerDot and the "Clustar"
  // letters — they're in separate flex children.
  artWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  // Fixed-size box that owns the ring animation. Its own coordinate space
  // so absolute children (rings, centerDot) don't leak into the wordmark.
  ringsWrap: {
    width: 220,
    height: 220,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 40,
  },
  ring: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 110,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  centerDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.accent,
    shadowColor: colors.accent,
    shadowOpacity: 0.4,
    shadowRadius: 20,
  },
  brand: {
    fontSize: 42,
    fontWeight: "700",
    color: colors.t1,
    letterSpacing: -1,
  },
  tagline: { fontSize: 14, color: colors.t3, marginTop: 8 },
  actions: { width: "100%", alignItems: "center", gap: 8 },
  primaryBtn: {
    backgroundColor: colors.accent,
    paddingVertical: 14,
    paddingHorizontal: 48,
    borderRadius: 24,
    alignItems: "center",
    minWidth: 220,
  },
  primaryBtnText: { color: colors.bg, fontWeight: "600", fontSize: 15 },
  ghostBtnText: { color: colors.t2, fontSize: 13, padding: 12 },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginVertical: 12,
    width: "100%",
    maxWidth: 260,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.borderS },
  dividerText: { color: colors.t3, fontSize: 12 },
  oauthBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "#fff",
    paddingVertical: 13,
    paddingHorizontal: 24,
    borderRadius: 24,
    minWidth: 260,
  },
  oauthBtnText: { color: "#000", fontSize: 14, fontWeight: "500" },
  emailBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.s2,
    borderWidth: 1,
    borderColor: colors.borderS,
    paddingVertical: 13,
    paddingHorizontal: 24,
    borderRadius: 24,
    minWidth: 260,
    marginTop: 8,
  },
  emailBtnText: { color: colors.t1, fontSize: 14, fontWeight: "500" },
});
