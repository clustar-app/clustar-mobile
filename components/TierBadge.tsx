import { View, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";

// Small colored badge rendered right next to a handle. Verified-check
// style — solid tier color with a white glyph inside. Free tier renders
// nothing so the majority of the UI stays uncluttered.
//
//   free  → hidden
//   plus  → blue check   (subtle "premium creator" mark)
//   pro   → gold star    (elite / top-tier)
//
// The badge sits inline with text — the caller wraps handle + badge in
// a flexDirection:'row' container so the badge floats to the right of
// the username with correct baseline alignment.

export type Tier = "free" | "plus" | "pro" | null | undefined;

interface Props {
  tier: Tier;
  size?: number;   // outer diameter — default 14
}

// Per-tier visual config. Colors picked to read on both dark and light
// bubble backgrounds (accent-blue for plus, warm gold for pro).
const CONFIG: Record<Exclude<Tier, "free" | null | undefined>, {
  bg: string;
  icon: "check" | "star";
  glyphScale: number;   // glyph size relative to outer diameter
}> = {
  plus: { bg: "#3B82F6", icon: "check", glyphScale: 0.68 },
  pro:  { bg: "#F59E0B", icon: "star",  glyphScale: 0.58 },
};

export function TierBadge({ tier, size = 14 }: Props) {
  if (!tier || tier === "free") return null;
  const cfg = CONFIG[tier as "plus" | "pro"];
  if (!cfg) return null;

  const glyphSize = Math.round(size * cfg.glyphScale);

  return (
    <View
      style={[
        styles.wrap,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: cfg.bg,
          // Subtle same-color glow to lift the badge off tightly-spaced text.
          shadowColor: cfg.bg,
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.45,
          shadowRadius: 2,
          elevation: 2,
        },
      ]}
    >
      <Feather
        name={cfg.icon}
        size={glyphSize}
        color="#ffffff"
        style={{
          // Star glyph in Feather has a slight visual bottom-heaviness;
          // nudge up 0.5px so it looks centered inside the disc.
          marginTop: cfg.icon === "star" ? -0.5 : 0,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 4,
  },
});
