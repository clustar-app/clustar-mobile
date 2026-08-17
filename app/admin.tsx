import { useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminApi, ReportRow, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Icon } from "@/components/Icon";
import { colors, radius, spacing } from "@/lib/theme";

// Moderation queue. Only accessible if users.is_admin. Server-side gate
// on /admin/* handles the actual security — this screen just avoids
// showing itself for non-admins (link is hidden in Settings).
//
// Each report is a card with:
//   • target type badge + reporter handle + reason
//   • content snapshot (JSON pretty-printed) so the moderator can review
//     the reported content even if it's been vanished/deleted since
//   • three actions: Dismiss / Delete content / Suspend user

type Tab = "open" | "resolved";

export default function AdminModerationScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { accessToken } = useAuth();
  const [tab, setTab] = useState<Tab>("open");

  const statsQ = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => adminApi.stats(accessToken!),
    enabled: !!accessToken,
    refetchInterval: 30_000,
  });

  const reportsQ = useQuery({
    queryKey: ["admin-reports", tab],
    queryFn: () => adminApi.listReports(accessToken!, tab),
    enabled: !!accessToken,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["admin-reports"] });
    queryClient.invalidateQueries({ queryKey: ["admin-stats"] });
  };

  const withNote = (title: string, ask: string, submit: (note: string) => void) => {
    if (Platform.OS === "ios" && (Alert as any).prompt) {
      (Alert as any).prompt(title, ask, [
        { text: "Cancel", style: "cancel" },
        { text: "Confirm", onPress: (v: string) => submit(v ?? "") },
      ], "plain-text");
    } else {
      Alert.alert(title, ask + " (Android — leaves note blank; use the dashboard for detailed notes.)", [
        { text: "Cancel", style: "cancel" },
        { text: "Confirm", onPress: () => submit("") },
      ]);
    }
  };

  const dismissMut = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => adminApi.dismiss(accessToken!, id, note),
    onSuccess: invalidate,
    onError: err => Alert.alert("Failed", err instanceof ApiError ? err.message : "Try again"),
  });
  const deleteMut = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => adminApi.deleteContent(accessToken!, id, note),
    onSuccess: invalidate,
    onError: err => Alert.alert("Failed", err instanceof ApiError ? err.message : "Try again"),
  });
  const suspendMut = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => adminApi.suspendUser(accessToken!, id, note),
    onSuccess: invalidate,
    onError: err => Alert.alert("Failed", err instanceof ApiError ? err.message : "Try again"),
  });

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.topBtn}>
          <Icon name="back" size={18} color={colors.t2} />
        </Pressable>
        <View style={{ alignItems: "center", flex: 1 }}>
          <Text style={styles.topTitle}>Moderation</Text>
          {statsQ.data && (
            <Text style={styles.topSub}>
              {statsQ.data.open} open · {statsQ.data.resolved_24h} resolved 24h
            </Text>
          )}
        </View>
        <View style={{ width: 36 }} />
      </View>

      <View style={styles.tabRow}>
        <TabPill label="Open" active={tab === "open"} onPress={() => setTab("open")} />
        <TabPill label="Resolved" active={tab === "resolved"} onPress={() => setTab("resolved")} />
      </View>

      {reportsQ.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={reportsQ.data ?? []}
          keyExtractor={r => r.id}
          contentContainerStyle={{ paddingBottom: spacing.xxl }}
          refreshControl={
            <RefreshControl
              refreshing={reportsQ.isFetching}
              onRefresh={() => reportsQ.refetch()}
              tintColor={colors.accent}
            />
          }
          renderItem={({ item }) => (
            <ReportCard
              report={item}
              busy={dismissMut.isPending || deleteMut.isPending || suspendMut.isPending}
              onDismiss={() => withNote("Dismiss report", "Reason:", note => dismissMut.mutate({ id: item.id, note }))}
              onDelete={() => withNote("Delete this content?", "Note (why):", note => deleteMut.mutate({ id: item.id, note }))}
              onSuspend={() => withNote("Suspend user?", "Note (why):", note => suspendMut.mutate({ id: item.id, note }))}
            />
          )}
          ListEmptyComponent={
            <View style={styles.emptyBlock}>
              <Text style={styles.emptyTitle}>{tab === "open" ? "No open reports" : "No resolved reports"}</Text>
              <Text style={styles.emptySub}>
                {tab === "open" ? "The queue is clear." : "Resolved reports will show here for audit."}
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

function TabPill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.tabPill, active && styles.tabPillActive]}>
      <Text style={[styles.tabPillText, active && { color: colors.accent }]}>{label}</Text>
    </Pressable>
  );
}

function ReportCard({
  report, busy, onDismiss, onDelete, onSuspend,
}: {
  report: ReportRow;
  busy: boolean;
  onDismiss: () => void;
  onDelete: () => void;
  onSuspend: () => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={styles.typeBadge}>
          <Text style={styles.typeBadgeText}>{report.target_type.replace("dm_", "").toUpperCase()}</Text>
        </View>
        <Text style={styles.reporterText} numberOfLines={1}>
          reported by @{report.reporter_handle ?? report.reporter_id.slice(0, 8)}
          {report.reporter_type === "burner" && " (anon)"}
        </Text>
        <Text style={styles.timeText}>{shortDate(report.created_at)}</Text>
      </View>

      <Text style={styles.reason}>{report.reason}</Text>

      {report.author_handle && (
        <Text style={styles.authorText}>author: @{report.author_handle}</Text>
      )}

      {/* Content snapshot — pretty JSON, small font. Enough for a
          quick moderator judgement without a separate detail view. */}
      <View style={styles.snapshot}>
        <Text style={styles.snapshotText} numberOfLines={12}>
          {formatSnapshot(report.content_snapshot)}
        </Text>
      </View>

      {report.is_open ? (
        <View style={styles.actionRow}>
          <Pressable
            onPress={onDismiss}
            disabled={busy}
            style={[styles.actionBtn, { backgroundColor: colors.s3 }, busy && { opacity: 0.4 }]}
          >
            <Text style={{ color: colors.t1, fontWeight: "600", fontSize: 12 }}>Dismiss</Text>
          </Pressable>
          <Pressable
            onPress={onDelete}
            disabled={busy}
            style={[styles.actionBtn, { backgroundColor: "#f97316" }, busy && { opacity: 0.4 }]}
          >
            <Text style={{ color: "#fff", fontWeight: "600", fontSize: 12 }}>Delete content</Text>
          </Pressable>
          <Pressable
            onPress={onSuspend}
            disabled={busy}
            style={[styles.actionBtn, { backgroundColor: "#dc2626" }, busy && { opacity: 0.4 }]}
          >
            <Text style={{ color: "#fff", fontWeight: "600", fontSize: 12 }}>Suspend user</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.resolvedRow}>
          <Icon name="check" size={12} color={colors.t3} />
          <Text style={styles.resolvedText} numberOfLines={2}>
            {report.resolution ?? "resolved"}
          </Text>
        </View>
      )}
    </View>
  );
}

function formatSnapshot(s: any): string {
  if (!s) return "(no snapshot)";
  try {
    return JSON.stringify(s, null, 2);
  } catch {
    return String(s);
  }
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return d.toLocaleDateString();
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.xl, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  topBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.s2, borderWidth: 1, borderColor: colors.border,
    alignItems: "center", justifyContent: "center",
  },
  topTitle: { color: colors.t1, fontSize: 15, fontWeight: "600" },
  topSub: { color: colors.t3, fontSize: 11, marginTop: 2 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  tabRow: {
    flexDirection: "row", paddingHorizontal: spacing.xl, paddingTop: spacing.md, gap: 24,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  tabPill: { paddingBottom: 10, borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabPillActive: { borderBottomColor: colors.accent },
  tabPillText: { color: colors.t2, fontSize: 13, fontWeight: "600" },

  card: {
    marginHorizontal: spacing.xl, marginTop: spacing.md,
    padding: spacing.lg, borderRadius: radius.md,
    backgroundColor: colors.s1, borderWidth: 1, borderColor: colors.border,
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  typeBadge: {
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
    backgroundColor: colors.s3,
  },
  typeBadgeText: { color: colors.t2, fontSize: 9, fontWeight: "700", letterSpacing: 0.5 },
  reporterText: { color: colors.t3, fontSize: 11, flex: 1 },
  timeText: { color: colors.t3, fontSize: 11 },

  reason: { color: colors.t1, fontSize: 14, fontWeight: "500", marginBottom: 6 },
  authorText: { color: colors.t2, fontSize: 12, marginBottom: 8 },

  snapshot: {
    backgroundColor: "rgba(0,0,0,0.4)",
    borderWidth: 1, borderColor: colors.border,
    borderRadius: 6, padding: 8, marginBottom: spacing.md,
  },
  snapshotText: { color: colors.t3, fontSize: 10, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },

  actionRow: { flexDirection: "row", gap: 6 },
  actionBtn: {
    flex: 1, paddingVertical: 9, borderRadius: 8,
    alignItems: "center", justifyContent: "center",
  },
  resolvedRow: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 8, paddingVertical: 6, borderRadius: 6,
    backgroundColor: colors.s2,
  },
  resolvedText: { color: colors.t2, fontSize: 11, flex: 1 },

  emptyBlock: { padding: spacing.xxl, alignItems: "center" },
  emptyTitle: { color: colors.t1, fontSize: 15, fontWeight: "600", marginBottom: 6 },
  emptySub: { color: colors.t2, fontSize: 13, textAlign: "center", lineHeight: 19 },
});
