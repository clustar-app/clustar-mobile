import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Animated,
} from "react-native";
import { useToast } from "@/lib/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/Icon";
import { ConfirmDialog } from "@/components/ConfirmDialog";
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
  const [confirmOpen, setConfirmOpen] = useState(false);

  const burnerQ = useQuery({
    queryKey: ["burner", user?.id],
    queryFn: () => identityApi.getBurner(accessToken!),
    enabled: !!accessToken && !!user?.id,
    staleTime: 60_000,
  });

  const rotate = useMutation({
    mutationFn: () => identityApi.rotateBurner(accessToken!),
    onSuccess: fresh => {
      queryClient.setQueryData(["burner", user?.id], fresh);
      queryClient.invalidateQueries({ queryKey: ["burner"] });
    },
    onError: (err: unknown) => {
      const msg = err instanceof ApiError ? err.message : "Couldn't rotate";
      toast.error(msg);
    },
  });

  const handleRotate = () => {
    setRotating(true);
    rotate.mutate(undefined, { onSettled: () => setRotating(false) });
  };

  const burnerHandle = burnerQ.data?.handle ?? "loading...";

  return (
    <View style={styles.wrap}>
      <View style={styles.tabs}>
        <IdentityCard
          selected={value === "user"}
          disabled={!!locked}
          onPress={() => !locked && onChange("user")}
          accentColor={colors.accent}
          accentBg={colors.accentBg}
          avatar={
            <View style={[styles.avatarDot, styles.avatarMain]}>
              <Text style={styles.avatarText}>
                {(user?.handle ?? "?").slice(0, 1).toUpperCase()}
              </Text>
            </View>
          }
          title={`@${user?.handle ?? "you"}`}
          subtitle="Your public account"
        />

        <IdentityCard
          selected={value === "burner"}
          disabled={!!locked}
          onPress={() => !locked && onChange("burner")}
          accentColor={colors.anon}
          accentBg={colors.anonBg}
          avatar={
            <View style={[styles.avatarDot, styles.avatarAnon]}>
              <Icon name="mask" size={12} color={colors.anon} />
            </View>
          }
          title={`@${burnerHandle}`}
          subtitle="Anonymous · burner"
        />
      </View>

      {locked && lockedReason && (
        <View style={styles.lockRow}>
          <Icon name="pin" size={12} color={colors.t3} />
          <Text style={styles.lockText}>{lockedReason}</Text>
        </View>
      )}

      {!locked && value === "burner" && (
        <Pressable
          onPress={() => setConfirmOpen(true)}
          disabled={rotating}
          android_ripple={{ color: colors.borderS }}
          style={({ pressed }) => [
            styles.rotateRow,
            pressed && { opacity: 0.7 },
          ]}
        >
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

      <ConfirmDialog
        visible={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Retire this burner?"
        message="You'll get a new anonymous handle. Old posts stay under the current burner name but you can never post as it again."
        confirmLabel="Rotate"
        onConfirm={handleRotate}
        destructive
        icon="repeat"
      />
    </View>
  );
}

// ── IdentityCard ────────────────────────────────────────────────────────────
// Individual card. Animated scale + accent glow on selection. Ripple on
// Android press. Fades avatar/text opacity when disabled (locked mode).

interface CardProps {
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
  accentColor: string;
  accentBg: string;
  avatar: React.ReactNode;
  title: string;
  subtitle: string;
}

function IdentityCard({
  selected,
  disabled,
  onPress,
  accentColor,
  accentBg,
  avatar,
  title,
  subtitle,
}: CardProps) {
  // Two Animated.Values, split across two nested Animated.Views. React
  // Native's Animated system refuses to mix native-driven props (transform)
  // with JS-driven props (color) on the SAME node — you get the runtime
  // error "Attempting to run JS driven animation on animated node that has
  // been moved to native earlier". Nesting keeps each driver on its own
  // node so both animate freely.
  const scale = useRef(new Animated.Value(selected ? 1 : 0.98)).current;
  const glow = useRef(new Animated.Value(selected ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(glow, {
      toValue: selected ? 1 : 0,
      damping: 20,
      stiffness: 200,
      useNativeDriver: false, // borderColor / backgroundColor: JS only
    }).start();

    Animated.spring(scale, {
      toValue: selected ? 1 : 0.98,
      damping: 18,
      stiffness: 260,
      useNativeDriver: true, // transform: native driven for smoothness
    }).start();
  }, [selected, glow, scale]);

  const borderColor = glow.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.border, accentColor],
  });

  const backgroundColor = glow.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.s1, accentBg],
  });

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      android_ripple={{ color: colors.borderS, borderless: false }}
      style={styles.tabPress}
    >
      {/* Outer node: native-driven transform */}
      <Animated.View style={{ transform: [{ scale }] }}>
        {/* Inner node: JS-driven color changes */}
        <Animated.View
          style={[
            styles.tab,
            { borderColor, backgroundColor },
            disabled && { opacity: 0.5 },
          ]}
        >
          {avatar}
          <View style={{ flex: 1 }}>
            <Text
              style={[
                styles.tabTitle,
                selected && { color: accentColor },
              ]}
              numberOfLines={1}
            >
              {title}
            </Text>
            <Text style={styles.tabSub} numberOfLines={1}>
              {subtitle}
            </Text>
          </View>
          {selected && (
            <View style={[styles.check, { backgroundColor: accentColor }]}>
              <Icon name="check" size={10} color={colors.bg} />
            </View>
          )}
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.sm },
  tabs: {
    flexDirection: "row",
    gap: 10,
  },
  tabPress: {
    flex: 1,
    borderRadius: radius.md,
    overflow: "hidden",
  },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 12,
  },
  avatarDot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarMain: { backgroundColor: colors.accentBg },
  avatarAnon: { backgroundColor: colors.anonBg },
  avatarText: { color: colors.accent, fontSize: 13, fontWeight: "600" },
  tabTitle: { color: colors.t1, fontSize: 13, fontWeight: "500" },
  tabSub: { color: colors.t3, fontSize: 11, marginTop: 2 },
  check: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  lockRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
    paddingHorizontal: 4,
  },
  lockText: { color: colors.t3, fontSize: 11 },
  rotateRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 10,
    padding: 8,
    borderRadius: radius.sm,
  },
  rotateText: { color: colors.t3, fontSize: 11 },
});
