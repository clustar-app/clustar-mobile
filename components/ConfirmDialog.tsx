import { useEffect, useRef } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Modal,
  Animated,
  Easing,
} from "react-native";
import { Icon } from "@/components/Icon";
import { colors, radius, spacing } from "@/lib/theme";

// ── ConfirmDialog ──────────────────────────────────────────────────────────
// Custom dialog for confirms (rotate burner, block, delete, etc.). Replaces
// Alert.alert with something that matches the app's dark aesthetic instead
// of the platform's default white/grey system dialog.
//
// Usage:
//   <ConfirmDialog
//     visible={showConfirm}
//     onClose={() => setShowConfirm(false)}
//     title="Retire this burner?"
//     message="You'll get a new anonymous handle."
//     confirmLabel="Rotate"
//     onConfirm={handleRotate}
//     destructive
//     icon="refresh"
//   />

interface Props {
  visible: boolean;
  onClose: () => void;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  destructive?: boolean;
  icon?: string;
  loading?: boolean;
}

export function ConfirmDialog({
  visible,
  onClose,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  destructive = false,
  icon,
  loading = false,
}: Props) {
  const scale = useRef(new Animated.Value(0.92)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(scale, {
          toValue: 1,
          damping: 20,
          stiffness: 260,
          mass: 0.9,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 180,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    } else {
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
      ]).start();
    }
  }, [visible, scale, opacity]);

  const handleConfirm = () => {
    onClose();
    setTimeout(onConfirm, 160);
  };

  const accentColor = destructive ? colors.danger : colors.accent;
  const accentBg = destructive ? colors.dangerBg : colors.accentBg;

  return (
    <Modal
      transparent
      visible={visible}
      onRequestClose={onClose}
      animationType="none"
      statusBarTranslucent
    >
      <Animated.View style={[styles.backdrop, { opacity }]}>
        <Pressable style={styles.backdropPress} onPress={onClose} />
      </Animated.View>

      <View style={styles.root} pointerEvents="box-none">
        <Animated.View
          style={[
            styles.dialog,
            { opacity, transform: [{ scale }] },
          ]}
        >
          {icon && (
            <View style={[styles.iconBubble, { backgroundColor: accentBg }]}>
              <Icon name={icon as any} size={20} color={accentColor} />
            </View>
          )}

          <Text style={styles.title}>{title}</Text>
          {message && <Text style={styles.message}>{message}</Text>}

          <View style={styles.buttons}>
            <Pressable
              onPress={onClose}
              android_ripple={{ color: colors.borderS }}
              disabled={loading}
              style={({ pressed }) => [
                styles.button,
                styles.cancel,
                pressed && { backgroundColor: colors.s3 },
              ]}
            >
              <Text style={styles.cancelLabel}>{cancelLabel}</Text>
            </Pressable>

            <Pressable
              onPress={handleConfirm}
              android_ripple={{
                color: destructive ? "rgba(255,255,255,0.15)" : colors.accentDim,
              }}
              disabled={loading}
              style={({ pressed }) => [
                styles.button,
                styles.confirm,
                { backgroundColor: accentColor },
                pressed && { opacity: 0.85 },
                loading && { opacity: 0.6 },
              ]}
            >
              <Text
                style={[
                  styles.confirmLabel,
                  destructive && { color: "#fff" },
                ]}
              >
                {loading ? "…" : confirmLabel}
              </Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
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
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.4,
    shadowRadius: 30,
    elevation: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  iconBubble: {
    width: 48,
    height: 48,
    borderRadius: 24,
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
  button: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  cancel: {
    backgroundColor: colors.s2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelLabel: {
    color: colors.t1,
    fontSize: 14,
    fontWeight: "500",
  },
  confirm: {},
  confirmLabel: {
    color: colors.bg,
    fontSize: 14,
    fontWeight: "600",
  },
});
