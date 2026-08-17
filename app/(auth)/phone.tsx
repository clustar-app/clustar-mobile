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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useNavigation } from "expo-router";
import { authApi, ApiError } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { colors, radius, spacing } from "@/lib/theme";

export default function PhoneScreen() {
  const router = useRouter();
  const [prefix, setPrefix] = useState("+234");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/(auth)/splash");
  };

  const fullPhone = `${prefix}${phone.replace(/\s+/g, "")}`;

  const onContinue = async () => {
    if (phone.length < 7) {
      toast.error("Enter a phone number");
      return;
    }
    setLoading(true);
    try {
      await authApi.sendOtp(fullPhone);
      router.push({
        pathname: "/(auth)/otp",
        params: { phone: fullPhone, returnTo: "/(auth)/phone" },
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Something went wrong";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.container}>
          <Pressable onPress={handleBack} style={styles.back} hitSlop={12}>
            <Text style={{ color: colors.t2, fontSize: 15 }}>← Back</Text>
          </Pressable>

          <Text style={styles.brand}>
            Clust<Text style={{ color: colors.accent }}>a</Text>r
          </Text>

          <Text style={styles.title}>What's your number?</Text>
          <Text style={styles.subtitle}>
            We'll text you a code.
          </Text>

          <View style={styles.phoneRow}>
            <TextInput
              style={styles.prefix}
              value={prefix}
              onChangeText={setPrefix}
              autoCapitalize="none"
              keyboardType="phone-pad"
              maxLength={5}
            />
            <TextInput
              style={styles.phoneInput}
              value={phone}
              onChangeText={setPhone}
              placeholder="812 345 6789"
              placeholderTextColor={colors.t3}
              keyboardType="phone-pad"
              autoFocus
            />
          </View>

          <Pressable
            style={({ pressed }) => [styles.button, pressed && { opacity: 0.9 }]}
            onPress={onContinue}
            disabled={loading}
          >
            <Text style={styles.buttonText}>{loading ? "Sending..." : "Send code"}</Text>
          </Pressable>

          <View style={styles.dotsRow}>
            <View style={styles.dot} />
            <View style={[styles.dot, styles.dotActive]} />
            <View style={styles.dot} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, padding: spacing.xxl, justifyContent: "center" },
  brand: {
    fontSize: 36,
    fontWeight: "700",
    color: colors.t1,
    textAlign: "center",
    marginBottom: 48,
    letterSpacing: -1,
  },
  title: { fontSize: 22, fontWeight: "700", color: colors.t1, marginBottom: spacing.sm },
  subtitle: { fontSize: 14, color: colors.t2, marginBottom: spacing.xxl, lineHeight: 20 },
  phoneRow: { flexDirection: "row", gap: 10, marginBottom: spacing.xl },
  prefix: {
    backgroundColor: colors.s2,
    borderWidth: 1,
    borderColor: colors.borderS,
    borderRadius: radius.md,
    paddingVertical: 14,
    paddingHorizontal: 12,
    fontSize: 15,
    color: colors.t1,
    width: 80,
    textAlign: "center",
  },
  phoneInput: {
    flex: 1,
    backgroundColor: colors.s2,
    borderWidth: 1,
    borderColor: colors.borderS,
    borderRadius: radius.md,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 15,
    color: colors.t1,
  },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 20,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonText: { color: colors.bg, fontWeight: "600", fontSize: 15 },
  back: { position: "absolute", top: 40, left: 20 },
  dotsRow: { flexDirection: "row", gap: 6, alignSelf: "center", marginTop: 24 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.t4 },
  dotActive: { width: 18, borderRadius: 3, backgroundColor: colors.accent },
});
