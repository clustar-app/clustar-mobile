import { useEffect, useRef } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View, ActivityIndicator } from "react-native";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as Notifications from "expo-notifications";
import { AuthContext, useAuthProviderValue, useAuth } from "@/lib/auth";
import { connectSocket, disconnectSocket } from "@/lib/realtime";
import { registerForPushNotifications, platformString } from "@/lib/pushNotifications";
import { notificationsApi } from "@/lib/api";
import { colors } from "@/lib/theme";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Feed data is time-sensitive; don't cache aggressively.
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// Redirects users based on auth state — signed-in users can't see auth
// screens, signed-out users can't see anything else. Placed in a child
// component so it can consume the AuthContext provided just above.
function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading, accessToken, onboardingStep, onboardingComplete } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const inAuthGroup = segments[0] === "(auth)";
    const currentAuthStep = segments[1] as string | undefined;

    if (!user) {
      // Signed out — into the auth flow (splash).
      if (!inAuthGroup) router.replace("/(auth)/splash");
      return;
    }

    if (!onboardingComplete) {
      // Resume the user at the EXACT step they left off on. Each onboarding
      // screen advances the step in secure storage as it succeeds — if the
      // app is killed and reopened, we land here on the same screen.
      const stepToRoute: Record<string, string> = {
        "email-verify": "/(auth)/email-verify",
        "handle": "/(auth)/handle",
        "location": "/(auth)/location",
      };
      const target = stepToRoute[onboardingStep];
      const alreadyOnStep = inAuthGroup && currentAuthStep === onboardingStep;
      if (target && !alreadyOnStep) {
        router.replace(target as any);
      }
      return;
    }

    // Fully signed in AND onboarded — leave any auth screen for the feed.
    if (inAuthGroup) router.replace("/");
  }, [user, loading, segments, onboardingStep, onboardingComplete]);

  // Socket lifecycle follows auth. Connect once we have a token; tear down
  // on sign-out. Screens don't need to know how connections are established.
  useEffect(() => {
    if (accessToken) {
      connectSocket(accessToken);
    } else {
      disconnectSocket();
    }
  }, [accessToken]);

  // Push registration follows auth too. Register once per app-open when
  // signed in; the server upserts on token so re-registration is safe.
  // Unregister on sign-out so this device stops receiving pushes for
  // the account that logged out.
  const lastRegisteredToken = useRef<string | null>(null);
  useEffect(() => {
    if (!accessToken) {
      // Sign-out path — best-effort unregister (may fail if token gone).
      const t = lastRegisteredToken.current;
      if (t) {
        // Note: no access token to send — the delete endpoint needs auth.
        // We rely on the server-side upsert-on-reregister to reassign
        // token ownership when the next user signs in on this device.
      }
      return;
    }
    (async () => {
      const expoToken = await registerForPushNotifications();
      if (!expoToken) return;
      lastRegisteredToken.current = expoToken;
      try {
        await notificationsApi.register(accessToken, expoToken, platformString());
      } catch (err) {
        console.warn("[push] register with server failed:", err);
      }
    })();
  }, [accessToken]);

  // Tap-to-route handler. Runs once — the response listener is a global
  // subscription. Reads notification.data.type to figure out where to go.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as any;
      if (!data?.type) return;
      switch (data.type) {
        case "dm_message":
        case "dm_request":
        case "dm_accepted":
        case "dm_merged":
          if (data.thread_id) router.push(`/dm/${data.thread_id}`);
          break;
        case "reply":
        case "nearby_clustar":
        case "popping_clustar":
          if (data.clustar_id) router.push(`/thread/${data.clustar_id}`);
          break;
      }
    });
    return () => sub.remove();
  }, [router]);

  // Clear the React Query cache whenever the signed-in user changes.
  // This prevents cross-user data bleed — before this, user B could briefly
  // see user A's cached burner / feed / thread data on first render.
  // First render seeds the ref without clearing (no previous user to leak from).
  const queryClient = useQueryClient();
  const lastUserId = useRef(user?.id ?? null);
  useEffect(() => {
    const currentId = user?.id ?? null;
    if (lastUserId.current !== currentId) {
      queryClient.clear();
      lastUserId.current = currentId;
    }
  }, [user?.id, queryClient]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return <>{children}</>;
}

export default function RootLayout() {
  const auth = useAuthProviderValue();

  return (
    <SafeAreaProvider>
      <AuthContext.Provider value={auth}>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="light" />
          <AuthGate>
            <Stack
              screenOptions={{
                headerStyle: { backgroundColor: colors.bg },
                headerTintColor: colors.t1,
                headerTitleStyle: { fontWeight: "600" },
                contentStyle: { backgroundColor: colors.bg },
                animation: "fade",
              }}
            >
              <Stack.Screen name="(auth)" options={{ headerShown: false }} />
              <Stack.Screen name="index" options={{ headerShown: false }} />
              {/*
                transparentModal (instead of "modal") keeps the underlying
                screen in the React tree, which lets react-native-root-siblings
                render overlays (toasts) ABOVE this modal. With a native
                "modal" presentation, the modal is pushed to its own VC on
                iOS and toasts fall behind it.

                slide_from_bottom preserves the familiar bottom-up modal feel
                even though we're no longer using the native modal presentation.

                headerShown:false — these screens ship their own top bar
                (X + title + Post), so we don't need the default header
                stacked on top of it.
              */}
              {/* Back to native modal presentation — the transparentModal
                  workaround was only needed for toast layering, which we've
                  reverted. headerShown:false so the screen's own top bar
                  isn't stacked under a default navigator header. */}
              <Stack.Screen
                name="create"
                options={{ presentation: "modal", headerShown: false }}
              />
              <Stack.Screen
                name="repost"
                options={{ presentation: "modal", headerShown: false }}
              />
              <Stack.Screen name="thread/[id]" options={{ title: "" }} />
              <Stack.Screen name="user/[handle]" options={{ headerShown: false }} />
              <Stack.Screen name="followers/[handle]" options={{ headerShown: false }} />
              <Stack.Screen name="following/[handle]" options={{ headerShown: false }} />
              <Stack.Screen name="burners" options={{ headerShown: false }} />
              <Stack.Screen name="messages" options={{ headerShown: false }} />
              <Stack.Screen name="dm-requests" options={{ headerShown: false }} />
              <Stack.Screen name="blocked" options={{ headerShown: false }} />
              <Stack.Screen name="dm/[threadId]" options={{ headerShown: false }} />
              <Stack.Screen
                name="dm-compose"
                options={{ presentation: "modal", headerShown: false }}
              />
              <Stack.Screen
                name="settings"
                options={{ presentation: "modal", headerShown: false }}
              />
            </Stack>
          </AuthGate>
        </QueryClientProvider>
      </AuthContext.Provider>
    </SafeAreaProvider>
  );
}
