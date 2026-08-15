import { useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { identityApi, BurnerRecord, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Icon } from "@/components/Icon";
import { colors, radius, spacing } from "@/lib/theme";

// Burner identity screen. Mirrors the mockup:
//   • Active burner card at top (handle, created-ago, clustars/replies count, Rotate button)
//   • Explanation of what rotation means
//   • Retired burners list — no rotate, no reactivate, just history

export default function BurnersScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { accessToken, user } = useAuth();
  const [rotating, setRotating] = useState(false);

  const q = useQuery({
    queryKey: ["burners", user?.id],
    queryFn: () => identityApi.listBurners(accessToken!),
    enabled: !!accessToken && !!user?.id,
  });

  const rotate = useMutation({
    mutationFn: () => identityApi.rotateBurner(accessToken!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["burners", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["burner"] });
    },
    onError: err => {
      const msg = err instanceof ApiError ? err.message : "Couldn't rotate";
      Alert.alert("Couldn't rotate", msg);
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
            setRotating(true);
            rotate.mutate(undefined, { onSettled: () => setRotating(false) });
          },
        },
      ]
    );
  };

  const active = q.data?.find(b => b.active);
  const retired = q.data?.filter(b => !b.active) ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.topBtn}>
          <Icon name="back" size={18} color={colors.t2} />
        </Pressable>
        <Text style={styles.topTitle}>Burner identity</Text>
        <View style={{ width: 36 }} />
      </View>

      {q.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={retired}
          keyExtractor={b => b.id}
          contentContainerStyle={{ paddingBottom: 40 }}
          ListHeaderComponent={
            <View>
              <Text style={styles.sectionLabel}>Active burner</Text>
              {active ? (
                <View style={styles.activeCard}>
                  <View style={styles.activeHeader}>
                    <View style={styles.dotAnon}>
                      <Icon name="mask" size={14} color={colors.anon} />
                    </View>
                    <Text style={styles.activeHandle}>@{active.handle}</Text>
                  </View>
                  <Text style={styles.activeMeta}>
                    Created {relativeAgo(active.created_at)} · {active.stats.clustars} clustar
                    {active.stats.clustars === 1 ? "" : "s"} · {active.stats.replies} repl
                    {active.stats.replies === 1 ? "y" : "ies"}
                  </Text>
                  <Pressable
                    onPress={confirmRotate}
                    disabled={rotating}
                    style={[styles.rotateBtn, rotating && { opacity: 0.4 }]}
                  >
                    {rotating ? (
                      <ActivityIndicator color={colors.t1} size="small" />
                    ) : (
                      <>
                        <Icon name="repeat" size={14} color={colors.t1} />
                        <Text style={styles.rotateBtnText}>Rotate to new burner</Text>
                      </>
                    )}
                  </Pressable>
                </View>
              ) : null}

              <Text style={styles.explain}>
                Rotating creates a new random handle and retires your current one.
                You can't undo this. Any DM threads opened as the current burner
                will become read-only.
              </Text>

              {retired.length > 0 && (
                <Text style={[styles.sectionLabel, { marginTop: spacing.xxl }]}>
                  Retired burners
                </Text>
              )}
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.retiredRow}>
              <View style={[styles.dotAnon, { opacity: 0.5 }]}>
                <Icon name="mask" size={12} color={colors.anon} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.retiredHandle}>@{item.handle}</Text>
                <Text style={styles.retiredMeta}>
                  Retired {relativeAgo(item.retired_at!)} · {item.stats.clustars} clustar
                  {item.stats.clustars === 1 ? "" : "s"}
                </Text>
              </View>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

function relativeAgo(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  topBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.s2, borderWidth: 1, borderColor: colors.border,
    alignItems: "center", justifyContent: "center",
  },
  topTitle: { color: colors.t1, fontSize: 15, fontWeight: "600" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  sectionLabel: {
    color: colors.t3, fontSize: 11, fontWeight: "600",
    textTransform: "uppercase", letterSpacing: 0.5,
    paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: 8,
  },
  activeCard: {
    marginHorizontal: spacing.xl,
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.anonBg,
    backgroundColor: colors.anonBg,
  },
  activeHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 6 },
  dotAnon: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: "rgba(94,196,168,0.18)",
    alignItems: "center", justifyContent: "center",
  },
  activeHandle: { color: colors.anon, fontSize: 17, fontWeight: "700" },
  activeMeta: { color: colors.t2, fontSize: 12, marginTop: 2 },
  rotateBtn: {
    marginTop: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.s3,
    paddingVertical: 10,
    borderRadius: radius.md,
  },
  rotateBtnText: { color: colors.t1, fontSize: 13, fontWeight: "600" },
  explain: {
    color: colors.t2,
    fontSize: 12,
    lineHeight: 18,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
  retiredRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    opacity: 0.75,
  },
  retiredHandle: { color: colors.t2, fontSize: 14, fontWeight: "600" },
  retiredMeta: { color: colors.t3, fontSize: 11, marginTop: 2 },
});
