import { useEffect, useState, useCallback } from "react";
import Constants from "expo-constants";
import {
  GoogleSignin,
  statusCodes,
} from "@react-native-google-signin/google-signin";

// Native Google Sign-In. No browser redirects — uses Google Play Services
// directly. The Android OAuth client's SHA-1 fingerprint (registered in
// Firebase / google-services.json) is what proves the app's identity.
// The Web Client ID is required to receive an ID token we can verify on
// the server side.

const extra = (Constants.expoConfig?.extra ?? {}) as {
  googleWebClientId?: string;
  googleIosClientId?: string;
  googleAndroidClientId?: string;
};

// Configure once at module load. Safe to call multiple times.
GoogleSignin.configure({
  webClientId: extra.googleWebClientId,
  iosClientId: extra.googleIosClientId,
  offlineAccess: false,
  scopes: ["profile", "email"],
});

export const googleConfigured = Boolean(extra.googleWebClientId);

type GoogleResponseType =
  | { type: "success"; params: { id_token: string } }
  | { type: "cancel" }
  | { type: "error"; error: string };

/**
 * Hook wrapper that mirrors the previous expo-auth-session API so the caller
 * code doesn't need to change. `promptAsync` opens Google's native picker;
 * the result lands in `response` on the next render.
 */
export function useGoogleAuth() {
  const [response, setResponse] = useState<GoogleResponseType | null>(null);

  const promptAsync = useCallback(async () => {
    try {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const result = await GoogleSignin.signIn();
      // v13 returns { type: "success", data: { idToken, user, ... } }
      // v11/12 returns { idToken, user, ... } directly.
      const idToken =
        (result as any)?.data?.idToken ?? (result as any)?.idToken ?? null;
      if (!idToken) {
        setResponse({ type: "error", error: "No ID token returned by Google" });
        return;
      }
      setResponse({ type: "success", params: { id_token: idToken } });
    } catch (e: any) {
      if (e?.code === statusCodes.SIGN_IN_CANCELLED) {
        setResponse({ type: "cancel" });
      } else if (e?.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        setResponse({ type: "error", error: "Google Play Services not available" });
      } else {
        setResponse({ type: "error", error: e?.message ?? "Google sign-in failed" });
      }
    }
  }, []);

  return { request: true, response, promptAsync };
}
