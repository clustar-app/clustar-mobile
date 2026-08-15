import { useState } from "react";
import { View, Text, Pressable, StyleSheet, Alert, ActivityIndicator } from "react-native";
import { useToast } from "@/lib/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/Icon";
import { identityApi, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { colors, radius, spacing } from "@/lib/theme";

// The identity picker every compose/reply surface uses. Two modes:
//   "you"    → main account, shown with @handle and the accent avatar
//   "anon"   → burner, shown with the anon color and burner handle
// Optional `locked` prop disables the toggle and displays a lock hint —
// used inside threads where the user already posted (identity-per-thread
// rule from PRD 4.4).

interface Props {
  value: "user" | "burner";
  onChange: (next: "user" | "burner") => void;
  locked?: boolean;         // true once the user has posted in this thread
  lockedReason?: string;    // shown as helper text when locked
}

export function IdentityPicker({ value, onChange, locked, lockedReason }: Props) {
  const { user, accessToken } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [rotating, setRotating] = useState(false);

  // Fetch (and cache) the user's current burner. Key is scoped by user.id
  // so signing in as someone else doesn't briefly show the previous user's
  // burner while their own fetch is in flight. Belt-and-suspenders with
  // the cache-clear on signOut in AuthGate.
  const burnerQ = useQuery({
    queryKey: ["burner", user?.id],
    queryFn: () => identityApi.getBurner(accessToken!),
    enabled: !!accessToken && !!user?.id,
    staleTime: 60_000,
  });

  const rotate = useMutation({
    mutationFn: () => identityApi.rotateBurner(accessToken!),
    onSuccess: fresh => {
      // Optimistically write the fresh burner into cache so the picker
      // re-renders instantly, then invalidate so any other consumer refetches
      // from the server (source of truth).
      queryClient.setQueryData(["burner", user?.id], fresh);
      queryClient.invalidateQueries({ queryKey: ["burner"] });
    },
    onError: (err: unknown) => {
      const msg = err instanceof ApiError ? err.message : "Couldn't rotate";
      toast.error(msg);
    },
  });

  const confirmRotate = () => {
    Alert.alert(
      "Retire this burner?",
      "You'll get a new anonymous handle. Old posts stay under the current burner name but you can never post as it again.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Rotate",
          style: "destructive",
          onPress: () => {
            // mutate() is fire-and-forget — onError/onSettled handle any
            // failure and reset UI. mutateAsync() throws even when onError
            // catches, which surfaces as an "Uncaught (in promise)" error.
            setRotating(true);
            rotate.mutate(undefined, {
              onSettled: () => setRotating(false),
            });
          },
        },
      ]
    );
  };

  const burnerHandle = burnerQ.data?.handle ?? "loading...";

  return (
    <View style={styles.wrap}>
      <View style={styles.tabs}>
        <Pressable
          onPress={() => !locked && onChange("user")}
          style={[styles.tab, value === "user" && styles.tabActive]}
          disabled={!!locked}
        >
          <View style={[styles.avatarDot, styles.avatarMain]}>
            <Text style={styles.avatarText}>
              {(user?.handle ?? "?").slice(0, 1).toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.tabTitle, value === "user" && { color: colors.accent }]}>
              @{user?.handle ?? "you"}
            </Text>
            <Text style={styles.tabSub}>Your public account</Text>
          </View>
        </Pressable>

        <Pressable
          onPress={() => !locked && onChange("burner")}
          style={[styles.tab, value === "burner" && styles.tabActive]}
          disabled={!!locked}
        >
          <View style={[styles.avatarDot, styles.avatarAnon]}>
            <Icon name="mask" size={12} color={colors.anon} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.tabTitle, value === "burner" && { color: colors.anon }]}>
              @{burnerHandle}
            </Text>
            <Text style={styles.tabSub}>Anonymous · burner</Text>
          </View>
        </Pressable>
      </View>

      {locked && lockedReason && (
        <View style={styles.lockRow}>
          <Icon name="pin" size={12} color={colors.t3} />
          <Text style={styles.lockText}>{lockedReason}</Text>
        </View>
      )}

      {!locked && value === "burner" && (
        <Pressable onPress={confirmRotate} disabled={rotating} style={styles.rotateRow}>
          {rotating ? (
            <ActivityIndicator size="small" color={colors.t3} />
          ) : (
            <>
              <Icon name="repeat" size={12} color={colors.t3} />
              <Text style={styles.rotateText}>Rotate burner (weekly)</Text>
            </>
          )}
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.sm },
  tabs: {
    flexDirection: "row",
    gap: 8,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 12,
  },
  tabActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentBg,
  },
  avatarDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarMain: { backgroundColor: colors.accentBg },
  avatarAnon: { backgroundColor: colors.anonBg },
  avatarText: { color: colors.accent, fontSize: 12, fontWeight: "600" },
  tabTitle: { color: colors.t1, fontSize: 13, fontWeight: "500" },
  tabSub: { color: colors.t3, fontSize: 11, marginTop: 2 },
  lockRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 4,
  },
  lockText: { color: colors.t3, fontSize: 11 },
  rotateRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 8,
    padding: 8,
  },
  rotateText: { color: colors.t3, fontSize: 11 },
});
