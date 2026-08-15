import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { storage } from "./storage";
import { authStore } from "./authStore";

// Persistent auth state — pair of tokens + user profile + a specific
// onboarding step that lets us resume signup exactly where the user left
// off if they close the app mid-flow.
//
// Onboarding steps in order:
//   email-verify → handle → location → complete
// A step can be skipped when it doesn't apply (phone signups skip
// email-verify; existing accounts get "complete" straight away).

const ACCESS_KEY = "clustar.accessToken";
const REFRESH_KEY = "clustar.refreshToken";
const USER_KEY = "clustar.user";
const STEP_KEY = "clustar.onboardingStep";

export type OnboardingStep = "email-verify" | "handle" | "location" | "complete";

export interface AuthUser {
  id: string;
  handle: string;
  display_name?: string | null;
  email?: string | null;
  email_verified?: boolean;
  auth_provider?: string;
  avatar_url?: string | null;
}

interface AuthState {
  loading: boolean;
  user: AuthUser | null;
  accessToken: string | null;
  onboardingStep: OnboardingStep;
  onboardingComplete: boolean;
  signIn: (
    accessToken: string,
    refreshToken: string,
    user: AuthUser,
    opts?: { step?: OnboardingStep }
  ) => Promise<void>;
  signOut: () => Promise<void>;
  setOnboardingStep: (step: OnboardingStep) => Promise<void>;
  finishOnboarding: () => Promise<void>;
  updateUser: (patch: Partial<AuthUser>) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

export function useAuthProviderValue(): AuthState {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [onboardingStep, setOnboardingStepState] = useState<OnboardingStep>("complete");
  const signOutRef = useRef<() => Promise<void>>();

  // Hydrate on boot.
  useEffect(() => {
    (async () => {
      try {
        const [access, refresh, userJson, step] = await Promise.all([
          storage.getItem(ACCESS_KEY),
          storage.getItem(REFRESH_KEY),
          storage.getItem(USER_KEY),
          storage.getItem(STEP_KEY),
        ]);
        if (access && refresh && userJson) {
          authStore.setTokens(access, refresh);
          setAccessToken(access);
          setUser(JSON.parse(userJson));
          setOnboardingStepState((step as OnboardingStep) ?? "complete");
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    authStore.registerTokensUpdated(async (access, refresh) => {
      setAccessToken(access);
      await Promise.all([
        storage.setItem(ACCESS_KEY, access),
        storage.setItem(REFRESH_KEY, refresh),
      ]);
    });
    authStore.registerAuthFailure(() => {
      signOutRef.current?.();
    });
  }, []);

  const signIn = useCallback(
    async (access: string, refresh: string, u: AuthUser, opts?: { step?: OnboardingStep }) => {
      const step = opts?.step ?? "complete";
      await Promise.all([
        storage.setItem(ACCESS_KEY, access),
        storage.setItem(REFRESH_KEY, refresh),
        storage.setItem(USER_KEY, JSON.stringify(u)),
        storage.setItem(STEP_KEY, step),
      ]);
      authStore.setTokens(access, refresh);
      setAccessToken(access);
      setUser(u);
      setOnboardingStepState(step);
    },
    []
  );

  const setOnboardingStep = useCallback(async (step: OnboardingStep) => {
    await storage.setItem(STEP_KEY, step);
    setOnboardingStepState(step);
  }, []);

  const finishOnboarding = useCallback(async () => {
    await storage.setItem(STEP_KEY, "complete");
    setOnboardingStepState("complete");
  }, []);

  const updateUser = useCallback(async (patch: Partial<AuthUser>) => {
    setUser(prev => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      storage.setItem(USER_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const signOut = useCallback(async () => {
    const refresh = authStore.getRefresh();
    if (refresh) {
      const base = (require("expo-constants").default.expoConfig?.extra?.apiBaseUrl as string) ?? "http://localhost:3000";
      fetch(`${base}/auth/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: refresh }),
      }).catch(() => {});
    }
    authStore.clear();
    await Promise.all([
      storage.removeItem(ACCESS_KEY),
      storage.removeItem(REFRESH_KEY),
      storage.removeItem(USER_KEY),
      storage.removeItem(STEP_KEY),
    ]);
    setAccessToken(null);
    setUser(null);
    setOnboardingStepState("complete");
  }, []);

  signOutRef.current = signOut;

  return {
    loading,
    user,
    accessToken,
    onboardingStep,
    onboardingComplete: onboardingStep === "complete",
    signIn,
    signOut,
    setOnboardingStep,
    finishOnboarding,
    updateUser,
  };
}

export { AuthContext };
