import Constants from "expo-constants";

// Module-level singleton so api.ts can read tokens WITHOUT threading them
// through every function call, and can trigger silent refresh from inside
// the fetch wrapper. React auth context syncs to this on token changes.
//
// This is the pattern that lets an app "stay logged in" like WhatsApp:
//   - accessToken lives in memory + secure storage, short-lived (15m)
//   - refreshToken lives ONLY in secure storage, long-lived (60d)
//   - On any 401, api.ts calls store.refresh(), which:
//       1. Dedupes concurrent refresh calls (5 requests hit 401 at once →
//          they all await the single in-flight refresh)
//       2. Hits /auth/refresh with the current refresh token
//       3. Rotates: server returns new pair, both stored
//       4. Returns the new access token so callers can retry
//   - If refresh fails (refresh token expired / revoked), fires the
//     onAuthFailure callback which the auth context uses to sign out.

const BASE_URL =
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ??
  "http://localhost:3000";

let accessToken: string | null = null;
let refreshToken: string | null = null;
let refreshInFlight: Promise<string | null> | null = null;
let onTokensUpdated: ((access: string, refresh: string) => void) | null = null;
let onAuthFailure: (() => void) | null = null;

export const authStore = {
  setTokens(access: string | null, refresh: string | null) {
    accessToken = access;
    refreshToken = refresh;
  },

  clear() {
    accessToken = null;
    refreshToken = null;
  },

  getAccess(): string | null {
    return accessToken;
  },

  getRefresh(): string | null {
    return refreshToken;
  },

  // Called by the auth context on token changes so it can persist to
  // secure storage and update React state.
  registerTokensUpdated(cb: (access: string, refresh: string) => void) {
    onTokensUpdated = cb;
  },

  // Called by the auth context so we can trigger sign-out from anywhere.
  registerAuthFailure(cb: () => void) {
    onAuthFailure = cb;
  },

  // Perform silent refresh. Returns the new access token, or null if the
  // refresh failed (in which case onAuthFailure has already been invoked).
  async refresh(): Promise<string | null> {
    // Dedupe concurrent refreshes — every 401'd request awaits the same
    // in-flight promise. Without this, ten requests failing at once would
    // fire ten refresh calls, invalidating each other via rotation.
    if (refreshInFlight) return refreshInFlight;
    if (!refreshToken) {
      onAuthFailure?.();
      return null;
    }

    refreshInFlight = (async () => {
      try {
        const res = await fetch(`${BASE_URL}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok || !payload?.ok) {
          // Refresh token expired, revoked, or reused — sign the user out.
          onAuthFailure?.();
          return null;
        }
        const { accessToken: newAccess, refreshToken: newRefresh } = payload.data;
        accessToken = newAccess;
        refreshToken = newRefresh;
        onTokensUpdated?.(newAccess, newRefresh);
        return newAccess;
      } catch {
        onAuthFailure?.();
        return null;
      } finally {
        refreshInFlight = null;
      }
    })();

    return refreshInFlight;
  },
};
