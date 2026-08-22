import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Pressable,
  Easing,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import RootSiblings from "react-native-root-siblings";
import { Icon } from "@/components/Icon";
import { colors, radius, spacing } from "@/lib/theme";

// ── Toast ──────────────────────────────────────────────────────────────────
// Slide-in-from-top notifications for errors, successes, and info messages.
// Uses react-native-root-siblings so toasts render above ANY modal, action
// sheet, or dialog. Auto-dismiss after 3.6s, tap to dismiss early.
//
// Usage:
//   const toast = useToast();
//   toast.error("Couldn't send DM");
//   toast.success("Message sent");
//   toast.info("Location permission required");
//
// Also emits a global "toast:error" event so any open sheet/dialog can
// close itself when an error fires — otherwise the toast lands behind the
// popup on some Android devices. Components subscribe via `onToastError`.

type ToastKind = "error" | "success" | "info";

// ── Cross-component event: close popups on error ─────────────────────────
const errorListeners = new Set<() => void>();
export function onToastError(cb: () => void): () => void {
  errorListeners.add(cb);
  return () => errorListeners.delete(cb);
}
function fireErrorEvent() {
  errorListeners.forEach((cb) => cb());
}

// ── Public API ───────────────────────────────────────────────────────────
export function useToast() {
  return {
    error: (msg: string) => {
      fireErrorEvent();
      pushToast("error", msg);
    },
    success: (msg: string) => pushToast("success", msg),
    info: (msg: string) => pushToast("info", msg),
  };
}

// Provider — kept for backwards-compat with anything importing it, but no
// longer required; RootSiblings mounts toasts at the true root. Just
// passes children through.
export function ToastProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

// ── Root-sibling implementation ──────────────────────────────────────────
// Each toast becomes its own RootSibling. On dismiss it unmounts itself
// from the sibling registry. New toasts stack via vertical offset.

let activeToasts: { id: number; sibling: RootSiblings; height: number }[] = [];
let nextId = 1;
const TOAST_GAP = 6;

function pushToast(kind: ToastKind, message: string) {
  const id = nextId++;
  const offset = computeOffset();
  const sibling = new RootSiblings(
    (
      <ToastCard
        kind={kind}
        message={message}
        offsetTop={offset}
        onDismiss={() => {
          activeToasts = activeToasts.filter((t) => t.id !== id);
          try { sibling.destroy(); } catch {}
        }}
      />
    )
  );
  activeToasts.push({ id, sibling, height: 60 });
}

function computeOffset(): number {
  // Rough — real height comes from onLayout later. Stack additive gap.
  return activeToasts.reduce((sum, t) => sum + t.height + TOAST_GAP, 0);
}

// ── ToastCard ────────────────────────────────────────────────────────────
// The visible bit. Slides in from behind the status bar, holds for 3.6s,
// slides out. Tap dismisses early.

const DISPLAY_MS = 3600;

function ToastCard({
  kind,
  message,
  offsetTop,
  onDismiss,
}: {
  kind: ToastKind;
  message: string;
  offsetTop: number;
  onDismiss: () => void;
}) {
  const translateY = useRef(new Animated.Value(-100)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const dismissed = useRef(false);

  useEffect(() => {
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: 0,
        damping: 18,
        stiffness: 220,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();

    const t = setTimeout(dismiss, DISPLAY_MS);
    return () => clearTimeout(t);
  }, []);

  const dismiss = () => {
    if (dismissed.current) return;
    dismissed.current = true;
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: -100,
        duration: 220,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 180,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => finished && onDismiss());
  };

  const { icon, tint, tintBg } = kindStyle(kind);

  return (
    <View style={styles.host} pointerEvents="box-none">
      <SafeAreaView edges={["top"]} pointerEvents="box-none">
        <Animated.View
          style={[
            styles.row,
            {
              marginTop: offsetTop,
              opacity,
              transform: [{ translateY }],
            },
          ]}
        >
          <Pressable
            onPress={dismiss}
            android_ripple={{ color: colors.borderS }}
            style={styles.card}
          >
            <View style={[styles.iconBubble, { backgroundColor: tintBg }]}>
              <Icon name={icon as any} size={14} color={tint} />
            </View>
            <Text style={styles.msg} numberOfLines={3}>
              {message}
            </Text>
          </Pressable>
        </Animated.View>
      </SafeAreaView>
    </View>
  );
}

function kindStyle(kind: ToastKind) {
  switch (kind) {
    case "error":
      return { icon: "close", tint: colors.danger, tintBg: colors.dangerBg };
    case "success":
      return { icon: "check", tint: colors.success, tintBg: colors.successBg };
    case "info":
      return { icon: "eye", tint: colors.accent, tintBg: colors.accentBg };
  }
}

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    elevation: 9999,
  },
  row: {
    paddingHorizontal: spacing.md,
    marginTop: 6,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.s2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 12,
    paddingHorizontal: 14,
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
  },
  iconBubble: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  msg: { color: colors.t1, fontSize: 13, flex: 1, lineHeight: 18 },
});
