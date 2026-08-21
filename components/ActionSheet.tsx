import { useEffect, useRef } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Modal,
  Animated,
  Easing,
  Dimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Icon } from "@/components/Icon";
import { colors, radius, spacing } from "@/lib/theme";

// ── ActionSheet ────────────────────────────────────────────────────────────
// Bottom-sheet replacement for Alert.alert action-lists. Slides up over a
// dimmed backdrop, taps-outside dismiss, hardware back on Android dismisses.
// Ripple + scale press feedback on actions. Optional destructive tint.
//
// Usage:
//   <ActionSheet
//     visible={showSheet}
//     onClose={() => setShowSheet(false)}
//     title="Add a photo"
//     actions={[
//       { label: "Take photo", icon: "camera", onPress: takePhoto },
//       { label: "Choose from library", icon: "image", onPress: pickFromLibrary },
//       { label: "Remove", icon: "trash", onPress: removePhoto, destructive: true },
//     ]}
//   />

export type ActionSheetItem = {
  label: string;
  icon?: string;
  onPress: () => void;
  destructive?: boolean;
  disabled?: boolean;
};

interface Props {
  visible: boolean;
  onClose: () => void;
  title?: string;
  message?: string;
  actions: ActionSheetItem[];
  cancelLabel?: string;
}

const SCREEN_H = Dimensions.get("window").height;

export function ActionSheet({
  visible,
  onClose,
  title,
  message,
  actions,
  cancelLabel = "Cancel",
}: Props) {
  const translateY = useRef(new Animated.Value(SCREEN_H)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: 220,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.spring(translateY, {
          toValue: 0,
          damping: 22,
          stiffness: 240,
          mass: 1,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(backdropOpacity, {
          toValue: 0,
          duration: 180,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: SCREEN_H,
          duration: 220,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, translateY, backdropOpacity]);

  const handleAction = (action: ActionSheetItem) => {
    onClose();
    // Small delay so the sheet finishes closing before the action fires
    // (feels smoother than instantly firing while the sheet is animating).
    setTimeout(action.onPress, 220);
  };

  return (
    <Modal
      transparent
      visible={visible}
      onRequestClose={onClose}
      animationType="none"
      statusBarTranslucent
    >
      <View style={styles.root}>
        {/* Backdrop */}
        <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
          <Pressable style={styles.backdropPress} onPress={onClose} />
        </Animated.View>

        {/* Sheet */}
        <Animated.View
          style={[styles.sheetWrap, { transform: [{ translateY }] }]}
          pointerEvents="box-none"
        >
          <SafeAreaView edges={["bottom"]} style={styles.safe}>
            <View style={styles.sheet}>
              {/* Grabber handle */}
              <View style={styles.grabber} />

              {(title || message) && (
                <View style={styles.header}>
                  {title && <Text style={styles.title}>{title}</Text>}
                  {message && <Text style={styles.message}>{message}</Text>}
                </View>
              )}

              <View style={styles.actions}>
                {actions.map((action, i) => (
                  <Pressable
                    key={i}
                    onPress={() => !action.disabled && handleAction(action)}
                    android_ripple={{ color: colors.borderS }}
                    disabled={action.disabled}
                    style={({ pressed }) => [
                      styles.action,
                      i < actions.length - 1 && styles.actionDivider,
                      pressed && { backgroundColor: colors.s2 },
                      action.disabled && { opacity: 0.4 },
                    ]}
                  >
                    {action.icon && (
                      <View style={styles.iconWrap}>
                        <Icon
                          name={action.icon as any}
                          size={16}
                          color={action.destructive ? colors.danger : colors.t1}
                        />
                      </View>
                    )}
                    <Text
                      style={[
                        styles.actionLabel,
                        action.destructive && { color: colors.danger },
                      ]}
                    >
                      {action.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Pressable
                onPress={onClose}
                android_ripple={{ color: colors.borderS }}
                style={({ pressed }) => [
                  styles.cancel,
                  pressed && { backgroundColor: colors.s2 },
                ]}
              >
                <Text style={styles.cancelLabel}>{cancelLabel}</Text>
              </Pressable>
            </View>
          </SafeAreaView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.55)" },
  backdropPress: { flex: 1 },
  sheetWrap: { paddingHorizontal: spacing.md },
  safe: {},
  sheet: {
    backgroundColor: colors.s1,
    borderRadius: radius.lg,
    overflow: "hidden",
    marginBottom: spacing.sm,
    // Elevation shadow — subtle, iOS style
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 12,
  },
  grabber: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderS,
    marginTop: 10,
    marginBottom: 4,
  },
  header: {
    paddingHorizontal: spacing.md,
    paddingTop: 14,
    paddingBottom: 12,
    alignItems: "center",
  },
  title: { color: colors.t1, fontSize: 15, fontWeight: "600" },
  message: { color: colors.t3, fontSize: 12, marginTop: 4, textAlign: "center" },
  actions: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: spacing.md,
    paddingVertical: 16,
  },
  actionDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  iconWrap: {
    width: 20,
    alignItems: "center",
  },
  actionLabel: { color: colors.t1, fontSize: 15, fontWeight: "500" },
  cancel: {
    marginTop: spacing.sm,
    backgroundColor: colors.s1,
    paddingVertical: 16,
    alignItems: "center",
    borderRadius: radius.lg,
    // Second visual layer — separate from actions, like iOS style
  },
  cancelLabel: { color: colors.t1, fontSize: 15, fontWeight: "600" },
});
