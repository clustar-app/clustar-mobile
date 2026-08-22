import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Modal,
  Animated,
  Easing,
  ScrollView,
} from "react-native";
import { Icon } from "@/components/Icon";
import { onToastError } from "@/lib/toast";
import { colors, radius, spacing } from "@/lib/theme";

// ── Themed imperative alert ────────────────────────────────────────────────
// Drop-in replacement for React Native's `Alert.alert` that renders our own
// dark-themed dialog. Same call signature — no state plumbing needed in the
// caller.
//
// Usage:
//   import { showAlert } from "@/lib/alert";
//
//   showAlert({
//     title: "Retire this burner?",
//     message: "You'll get a new anonymous handle.",
//     icon: "repeat",
//     actions: [
//       { label: "Cancel", style: "cancel" },
//       { label: "Rotate", onPress: doRotate, style: "destructive" },
//     ],
//   });
//
// Mount <AlertHost /> once in app/_layout.tsx below the ToastProvider so
// alerts float above every screen and modal.

export type AlertAction = {
  label: string;
  onPress?: () => void;
  style?: "default" | "cancel" | "destructive";
};

export type AlertOptions = {
  title: string;
  message?: string;
  icon?: string;
  actions?: AlertAction[]; // default: [{ label: "OK" }]
};

type Listener = (opts: AlertOptions) => void;
const listeners = new Set<Listener>();

export function showAlert(opts: AlertOptions) {
  listeners.forEach((l) => l(opts));
}

// ── React Native Alert-compatible shim ─────────────────────────────────────
// Drop-in replacement for `import { Alert } from "react-native"`. Same call
// shape, so callers only need to change the import path. Maps RN's button
// object shape to our AlertAction shape.

type RNAlertButton = {
  text?: string;
  onPress?: () => void;
  style?: "default" | "cancel" | "destructive";
};

export const Alert = {
  alert(title: string, message?: string, buttons?: RNAlertButton[]) {
    showAlert({
      title,
      message,
      actions: buttons?.map((b) => ({
        label: b.text ?? "OK",
        onPress: b.onPress,
        style: b.style,
      })),
    });
  },
};

// ── AlertHost ──────────────────────────────────────────────────────────────
// Listens for showAlert() calls and renders a queued list. Only one alert
// visible at a time — additional ones queue and animate in as previous
// dismisses. Prevents overlapping dialogs on rapid errors.

export function AlertHost() {
  const [queue, setQueue] = useState<AlertOptions[]>([]);

  useEffect(() => {
    const listener: Listener = (opts) => {
      setQueue((cur) => [...cur, opts]);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  // Clear the alert queue on toast errors — the error toast conveys the
  // problem more directly than layering another dialog behind it.
  useEffect(() => {
    return onToastError(() => setQueue([]));
  }, []);

  const current = queue[0];
  const dismiss = () => setQueue((cur) => cur.slice(1));

  return current ? (
    <AlertDialog key={queue.length} opts={current} onDismiss={dismiss} />
  ) : null;
}

// ── AlertDialog ────────────────────────────────────────────────────────────
// Single dialog instance. Scale + fade in/out. Actions row uses same visual
// language as ConfirmDialog. Buttons stack vertically when > 2 to avoid
// truncated labels.

function AlertDialog({
  opts,
  onDismiss,
}: {
  opts: AlertOptions;
  onDismiss: () => void;
}) {
  const scale = useRef(new Animated.Value(0.92)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale, {
        toValue: 1,
        damping: 20,
        stiffness: 260,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, scale]);

  const close = (cb?: () => void) => {
    // Fire the action FIRST, then animate the dialog out. If we defer the
    // callback to after the animation finishes, actions that flip the auth
    // state (e.g. signOut) tear down the whole tree — including this
    // Animated timer — and the scheduled setTimeout never runs. Firing
    // first guarantees the action fires; the visual close still animates
    // even if the tree unmounts mid-flight.
    if (cb) cb();
    Animated.parallel([
      Animated.timing(scale, {
        toValue: 0.92,
        duration: 140,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 140,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) {
        setVisible(false);
        onDismiss();
      }
    });
  };

  const actions = opts.actions ?? [{ label: "OK", style: "default" as const }];
  const stacked = actions.length > 2;

  return (
    <Modal
      transparent
      visible={visible}
      onRequestClose={() => close()}
      animationType="none"
      statusBarTranslucent
    >
      <Animated.View style={[styles.backdrop, { opacity }]}>
        <Pressable
          style={styles.backdropPress}
          onPress={() => {
            // Tapping backdrop dismisses via the first cancel button, or a
            // plain dismiss when none exists.
            const cancel = actions.find((a) => a.style === "cancel");
            close(cancel?.onPress);
          }}
        />
      </Animated.View>

      <View style={styles.root} pointerEvents="box-none">
        <Animated.View
          style={[styles.dialog, { opacity, transform: [{ scale }] }]}
        >
          {opts.icon && (
            <View style={styles.iconBubble}>
              <Icon name={opts.icon as any} size={20} color={colors.accent} />
            </View>
          )}
          <Text style={styles.title}>{opts.title}</Text>
          {opts.message && (
            <ScrollView
              style={{ maxHeight: 220, width: "100%" }}
              contentContainerStyle={{ paddingVertical: 4 }}
            >
              <Text style={styles.message}>{opts.message}</Text>
            </ScrollView>
          )}

          <View style={[styles.buttons, stacked && styles.buttonsStacked]}>
            {actions.map((action, i) => (
              <AlertButton
                key={i}
                action={action}
                stacked={stacked}
                onPress={() => close(action.onPress)}
              />
            ))}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

function AlertButton({
  action,
  stacked,
  onPress,
}: {
  action: AlertAction;
  stacked: boolean;
  onPress: () => void;
}) {
  const isCancel = action.style === "cancel";
  const isDestructive = action.style === "destructive";
  const isPrimary = !isCancel && !isDestructive;

  const bg = isCancel
    ? colors.s2
    : isDestructive
      ? colors.danger
      : colors.accent;
  const fg = isCancel
    ? colors.t1
    : isDestructive
      ? "#fff"
      : colors.bg;

  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: isPrimary ? colors.accentDim : colors.borderS }}
      style={({ pressed }) => [
        styles.btn,
        !stacked && { flex: 1 },
        { backgroundColor: bg },
        isCancel && { borderWidth: 1, borderColor: colors.border },
        pressed && { opacity: 0.85 },
      ]}
    >
      <Text style={[styles.btnLabel, { color: fg }]}>{action.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  backdropPress: { flex: 1 },
  root: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.xl,
  },
  dialog: {
    backgroundColor: colors.s1,
    borderRadius: radius.lg,
    padding: spacing.xl,
    width: "100%",
    maxWidth: 340,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.4,
    shadowRadius: 30,
    elevation: 20,
  },
  iconBubble: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.accentBg,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  title: {
    color: colors.t1,
    fontSize: 17,
    fontWeight: "600",
    textAlign: "center",
  },
  message: {
    color: colors.t2,
    fontSize: 13,
    textAlign: "center",
    marginTop: 8,
    lineHeight: 19,
  },
  buttons: {
    flexDirection: "row",
    gap: 8,
    marginTop: spacing.xl,
    width: "100%",
  },
  buttonsStacked: {
    flexDirection: "column",
  },
  btn: {
    paddingVertical: 13,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  btnLabel: {
    fontSize: 14,
    fontWeight: "600",
  },
});
