import { useEffect, useState, useCallback } from "react";
import Constants from "expo-constants";
import { Platform } from "react-native";

type GoogleSigninModule = {
  configure: (config: Record<string, any>) => void;
  hasPlayServices: (options?: Record<string, any>) => Promise<void>;
  signIn: () => Promise<any>;
};

let GoogleSignin: GoogleSigninModule | null = null;
let statusCodes: { SIGN_IN_CANCELLED: string; PLAY_SERVICES_NOT_AVAILABLE: string } | null = null;

// react-native-google-signin is a native module. Expo Go does not register it,
// so importing it at startup crashes the app before the router mounts.
// Guard the import and disable the feature when running in unsupported envs.
try {
  const googleSigninModule = require("@react-native-google-signin/google-signin") as {
    GoogleSignin: GoogleSigninModule;
    statusCodes: { SIGN_IN_CANCELLED: string; PLAY_SERVICES_NOT_AVAILABLE: string };
  };

  GoogleSignin = googleSigninModule.GoogleSignin ?? null;
  statusCodes = googleSigninModule.statusCodes ?? null;

  const extra = (Constants.expoConfig?.extra ?? {}) as {
    googleWebClientId?: string;
    googleIosClientId?: string;
    googleAndroidClientId?: string;
  };

  if (GoogleSignin && (Platform.OS === "android" || Platform.OS === "ios")) {
    GoogleSignin.configure({
      webClientId: extra.googleWebClientId,
      iosClientId: extra.googleIosClientId,
      offlineAccess: false,
      scopes: ["profile", "email"],
    });
  }
} catch (error) {
  console.warn("[googleAuth] Google Sign-In unavailable in this environment:", error);
}

const extra = (Constants.expoConfig?.extra ?? {}) as {
  googleWebClientId?: string;
  googleIosClientId?: string;
  googleAndroidClientId?: string;
};

export const googleConfigured = Boolean(extra.googleWebClientId) && Boolean(GoogleSignin);

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
    if (!GoogleSignin || !statusCodes) {
      setResponse({
        type: "error",
        error: "Google sign-in is unavailable in this environment. Please use email or phone.",
      });
      return;
    }

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

  return { request: Boolean(GoogleSignin), response, promptAsync };
}
