import { View, StyleSheet } from "react-native";
import { computePresence } from "@/lib/presence";
import { colors } from "@/lib/theme";

// Small green dot indicator, usually pinned to the bottom-right of an
// avatar to show "online now". Only rendered when the user is in the
// ONLINE window — for RECENT/OFFLINE we lean on the last-seen text
// (or nothing) so the visual signal stays crisp.
//
// Skip rendering entirely for burner-authored context: presence on
// burner handles would leak whether the underlying account is active
// right now, weakening anonymity.

interface Props {
  lastActiveAt: string | null | undefined;
  size?: number;
  // If true, render even when RECENT (yellow-ish). Default false —
  // green dot ONLY for actively-online.
  showRecent?: boolean;
}

export function PresenceDot({ lastActiveAt, size = 10, showRecent = false }: Props) {
  const state = computePresence(lastActiveAt);
  if (state === "offline") return null;
  if (state === "recent" && !showRecent) return null;

  return (
    <View
      style={[
        styles.dot,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: state === "online" ? "#22c55e" : "#eab308",
          borderWidth: Math.max(1, Math.round(size / 6)),
          borderColor: colors.bg,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  dot: {
    // Positioning is the caller's concern — some placements want it
    // inline (next to text), others want absolute bottom-right of an
    // avatar. We just render the dot itself here.
  },
});
