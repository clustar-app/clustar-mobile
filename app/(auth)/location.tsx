import { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as Location from "expo-location";
import { useAuth } from "@/lib/auth";
import { colors, spacing } from "@/lib/theme";

// PRD 5.2 #4: "Location permission request with in-context explanation
// shown before the OS prompt — explain that Clustar only shows content
// near the user and never shows their exact position to others."
// This screen IS that explanation. Tapping "Allow" then triggers the
// native permission dialog.
//
// "Not now" still lets them through to the feed — the feed re-asks in its
// own useEffect, and the app degrades gracefully to "Location unavailable"
// if they keep refusing.

export default function LocationScreen() {
  const router = useRouter();
  const { finishOnboarding } = useAuth();
  const [busy, setBusy] = useState(false);

  const finish = async () => {
    await finishOnboarding();
    router.replace("/");
  };

  const onAllow = async () => {
    setBusy(true);
    try {
      await Location.requestForegroundPermissionsAsync();
      // We don't gate onboarding on the answer — even a denial lets them
      // through. The feed screen surfaces the empty state if there's no
      // location, and iOS/Android let them change their mind in Settings.
    } finally {
      setBusy(false);
      await finish();
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.artWrap}>
          <View style={styles.ringOuter} />
          <View style={styles.ringMid} />
          <View style={styles.ringInner}>
            <Text style={styles.pinEmoji}>📍</Text>
          </View>
        </View>

        <Text style={styles.title}>Clustar needs your location</Text>
        <Text style={styles.subtitle}>
          To show threads near you and let others in range join yours. We
          never share your exact position — only your neighborhood.
        </Text>

        <Pressable
          style={[styles.primaryBtn, busy && { opacity: 0.4 }]}
          onPress={onAllow}
          disabled={busy}
        >
          <Text style={styles.primaryBtnText}>
            {busy ? "Requesting..." : "Allow location"}
          </Text>
        </Pressable>

        <Pressable onPress={finish} hitSlop={10}>
          <Text style={styles.ghostText}>Not now</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 36 },
  artWrap: {
    width: 220,
    height: 220,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 32,
    position: "relative",
  },
  ringOuter: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 110,
    borderWidth: 1,
    borderColor: colors.accentDim,
    opacity: 0.15,
    borderStyle: "dashed",
  },
  ringMid: {
    position: "absolute",
    width: 170,
    height: 170,
    borderRadius: 85,
    borderWidth: 1,
    borderColor: colors.accentDim,
    opacity: 0.3,
    borderStyle: "dashed",
  },
  ringInner: {
    width: 130,
    height: 130,
    borderRadius: 65,
    backgroundColor: colors.accentBg,
    alignItems: "center",
    justifyContent: "center",
  },
  pinEmoji: { fontSize: 48 },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: colors.t1,
    textAlign: "center",
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
    marginBottom: 12,
  },
  primaryBtnText: { color: colors.bg, fontWeight: "600", fontSize: 15 },
  ghostText: { color: colors.t2, fontSize: 13, padding: 8 },
});
