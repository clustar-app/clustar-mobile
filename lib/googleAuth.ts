import * as Google from "expo-auth-session/providers/google";
import * as WebBrowser from "expo-web-browser";
import Constants from "expo-constants";

// Ensure the OAuth redirect completes when the user comes back from the
// browser. Must be called once per app at import time; safe to call more.
WebBrowser.maybeCompleteAuthSession();

// Reads client IDs from app.json extra. Empty strings mean "not configured";
// the OAuth buttons should be disabled or hidden in that case.
const extra = (Constants.expoConfig?.extra ?? {}) as {
  googleWebClientId?: string;
  googleIosClientId?: string;
  googleAndroidClientId?: string;
};

export const googleConfigured = Boolean(
  extra.googleIosClientId || extra.googleAndroidClientId || extra.googleWebClientId
);

// Hook wrapper — call inside a component. Returns a `promptAsync` that
// opens Google's sign-in flow and resolves with the id_token (or null on
// cancel / error). We request `id_token` responseType so we can send it
// straight to our server for verification.
export function useGoogleAuth() {
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    iosClientId: extra.googleIosClientId,
    androidClientId: extra.googleAndroidClientId,
    webClientId: extra.googleWebClientId,
    scopes: ["profile", "email"],
  });

  return { request, response, promptAsync };
}
