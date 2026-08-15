import { Modal, Pressable, View, StyleSheet, Text, Dimensions } from "react-native";
import { Image } from "expo-image";
import { colors } from "@/lib/theme";

// Full-screen image viewer used across screens. Dark backdrop, tap anywhere
// (including the image itself) to dismiss. GIFs animate because expo-image
// supports them on both iOS and Android; regular RN Image only handles GIFs
// on iOS out of the box.

interface Props {
  uri: string | null;
  onClose: () => void;
}

export function ImageViewer({ uri, onClose }: Props) {
  const { width, height } = Dimensions.get("window");
  return (
    <Modal
      visible={!!uri}
      animationType="fade"
      transparent
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={styles.closeChip}>
          <Text style={{ color: colors.t1, fontSize: 14 }}>Close</Text>
        </View>
        {uri && (
          <Image
            source={{ uri }}
            style={{ width: width, height: height * 0.85 }}
            contentFit="contain"
            transition={120}
          />
        )}
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.95)",
    alignItems: "center",
    justifyContent: "center",
  },
  closeChip: {
    position: "absolute",
    top: 60,
    right: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: 999,
    zIndex: 10,
  },
});
