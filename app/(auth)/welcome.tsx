import { View, Text, Pressable, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { colors, spacing } from "@/lib/theme";

// Step 1 of the visible-dot onboarding progress. Sells the product before
// asking for a phone number. Skip goes straight to phone.

export default function WelcomeScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Pressable
          style={styles.skip}
          onPress={() => router.push("/(auth)/phone")}
          hitSlop={12}
        >
          <Text style={styles.skipText}>Skip</Text>
        </Pressable>

        <View style={styles.art}>
          <NetworkIllustration />
        </View>

        <Text style={styles.title}>
          Create and join threads with anyone sharing your space
        </Text>
        <Text style={styles.subtitle}>
          Buses, venues, neighborhoods — start a clustar and everyone nearby can
          join. Everything expires in 24 hours.
        </Text>

        <Pressable
          style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.9 }]}
          onPress={() => router.push("/(auth)/phone")}
        >
          <Text style={styles.primaryBtnText}>Continue</Text>
        </Pressable>

        <View style={styles.dotsRow}>
          <View style={[styles.dot, styles.dotActive]} />
          <View style={styles.dot} />
          <View style={styles.dot} />
        </View>
      </View>
    </SafeAreaView>
  );
}

// Cheap decorative "network" illustration built with Views — center accent
// dot surrounded by satellite dots. Keeps us dep-free (no SVG lib) and
// still evokes the "proximity is the graph" idea.
function NetworkIllustration() {
  const satellite = (top: number, left: number, size = 8, opacity = 0.9) => (
    <View
      key={`${top}-${left}`}
      style={{
        position: "absolute",
        top,
        left,
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.t2,
        opacity,
      }}
    />
  );
  return (
    <View style={illust.wrap}>
      <View style={illust.outerRing} />
      <View style={illust.innerRing} />
      <View style={illust.center} />
      {satellite(30, 60, 8)}
      {satellite(30, 120, 8)}
      {satellite(100, 30, 8)}
      {satellite(100, 150, 8)}
      {satellite(60, 20, 6, 0.6)}
      {satellite(60, 165, 6, 0.6)}
    </View>
  );
}

const illust = StyleSheet.create({
  wrap: {
    width: 200,
    height: 160,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  outerRing: {
    position: "absolute",
    width: 130,
    height: 130,
    borderRadius: 65,
    borderWidth: 1,
    borderColor: colors.accent,
    opacity: 0.3,
    borderStyle: "dashed",
  },
  innerRing: {
    position: "absolute",
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 1,
    borderColor: colors.accent,
    opacity: 0.55,
    borderStyle: "dashed",
  },
  center: {
    position: "absolute",
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.accent,
  },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 36 },
  skip: { position: "absolute", top: 20, right: 20 },
  skipText: { color: colors.t3, fontSize: 13 },
  art: { marginBottom: 32 },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: colors.t1,
    textAlign: "center",
    lineHeight: 28,
    marginBottom: 12,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 14,
    color: colors.t2,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 32,
  },
  primaryBtn: {
    backgroundColor: colors.accent,
    paddingVertical: 14,
    borderRadius: 24,
    width: "100%",
    alignItems: "center",
    marginBottom: 20,
  },
  primaryBtnText: { color: colors.bg, fontWeight: "600", fontSize: 15 },
  dotsRow: { flexDirection: "row", gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.t4 },
  dotActive: { width: 18, borderRadius: 3, backgroundColor: colors.accent },
});
