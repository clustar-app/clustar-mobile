import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { Platform } from "react-native";

// Expo Go dropped remote-push support in SDK 53. Any getExpoPushTokenAsync
// call there prints a warning + throws. Detect Expo Go and skip
// registration silently — the app still functions (realtime socket
// events still update UI in-foreground), just no lock-screen pushes.
// To test real pushes: build a dev build via EAS and install that.
const IS_EXPO_GO = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

// Expo push notification wiring.
//
// - Handler decides what happens when a notif arrives while the app IS
//   in foreground. We DO show it (banner+sound) so users know a message
//   arrived even without leaving the current screen — the realtime
//   socket updates the inbox row, but users often miss those without
//   the auditory/visual cue.
// - registerForPushNotifications() runs on sign-in: asks permission,
//   fetches the Expo push token, returns it for the caller to send to
//   the server.
// - Tap-to-route is wired up in the root layout via the notification
//   response listener.

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    // These two are required on newer expo-notifications versions.
    shouldShowBanner: true,
    shouldShowList: true,
  }) as any,
});

/**
 * Ask the OS for permission (if not already granted) and return the
 * Expo push token for this device. Returns null on simulator (Expo
 * push tokens require a real device), or when the user denies perms.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  // Android needs an explicit high-importance channel or notifications
  // arrive silently and heads-up-less.
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#FF3B30",
    });
  }

  if (!Device.isDevice) {
    // Simulators can't get real push tokens — silently no-op so dev
    // builds don't spam warnings.
    return null;
  }

  if (IS_EXPO_GO) {
    // Expo Go SDK 53+ dropped remote push. Skip cleanly.
    console.log("[push] Expo Go detected — skipping push registration. Use a dev build to test push.");
    return null;
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let final = existing;
  if (existing !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    final = status;
  }
  if (final !== "granted") return null;

  try {
    // Expo's push token; falls back gracefully when no projectId is set
    // (bare dev builds without EAS config).
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;
    const tokenData = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    return tokenData.data;
  } catch (err) {
    console.warn("[push] getExpoPushTokenAsync failed:", err);
    return null;
  }
}

export function platformString(): "ios" | "android" | "web" {
  if (Platform.OS === "ios") return "ios";
  if (Platform.OS === "android") return "android";
  return "web";
}
