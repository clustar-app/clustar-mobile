import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { colors } from "@/lib/theme";

// A small pulsing dot: solid inner circle + a ring that scales up and
// fades out on a loop. The loop duration is driven by `heat` so a busy
// clustar visibly beats faster than a quiet one — same idea as the
// original HTML mockup's --spd CSS variable, but implemented with the
// React Native Animated API.

interface Props {
  /** Higher = faster beat. 0 = cold, ~3+ = very hot. */
  heat: number;
  color?: string;
}

// Map heat to a loop duration in ms. Tuned by feel — jam a couple test
// values in the feed and adjust if it looks wrong.
function heatToDurationMs(heat: number): number {
  if (heat >= 3) return 700;   // very hot
  if (heat >= 1.5) return 1100; // hot
  if (heat >= 0.5) return 1700; // warm
  if (heat >= 0.1) return 2500; // cool
  return 3500;                   // cold
}

export function PulseDot({ heat, color = colors.accent }: Props) {
  const anim = useRef(new Animated.Value(0)).current;
  const duration = heatToDurationMs(heat);

  useEffect(() => {
    // Reset then start a fresh loop whenever duration changes so the
    // animation speed updates when heat changes (e.g. new reply comes in).
    anim.setValue(0);
    const loop = Animated.loop(
      Animated.timing(anim, {
        toValue: 1,
        duration,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [duration, anim]);

  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [1, 2.8] });
  const opacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] });

  return (
    <View style={styles.wrap}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Animated.View
        style={[
          styles.ring,
          { borderColor: color, transform: [{ scale }], opacity },
        ]}
      />
    </View>
  );
}

// Heat estimator based on visible fields. Weighs replies heavier than
// passive participants (talk is a stronger signal than presence) and
// decays with age so old clustars cool even if they had big numbers.
export function computeHeat(stats: { participants: number; replies: number; likes: number }, createdAt: string): number {
  const ageMin = Math.max(1, (Date.now() - new Date(createdAt).getTime()) / 60_000);
  return (stats.participants + stats.replies * 2 + stats.likes) / ageMin;
}

const styles = StyleSheet.create({
  wrap: {
    width: 8,
    height: 8,
    marginTop: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    position: "absolute",
  },
  ring: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
    position: "absolute",
  },
});
