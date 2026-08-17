import { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  FlatList,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { searchApi, SearchUserResult } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { getCurrentLocation } from "@/lib/location";
import { usePreferences } from "@/lib/preferences";
import { Icon } from "@/components/Icon";
import { TierBadge } from "@/components/TierBadge";
import { PresenceDot } from "@/components/PresenceDot";
import { colors, radius, spacing } from "@/lib/theme";

// Search — two axes:
//   • Users (global): handle + display_name fuzzy match, ranked by
//     similarity. Tap → profile.
//   • Clustars (in-range): body + tag match within your discovery
//     radius. Tap → thread.
// Query is debounced 300ms so we're not hammering the API on every
// keystroke. Empty query = friendly empty state.

type Tab = "users" | "clustars";

export default function SearchScreen() {
  const router = useRouter();
  const { accessToken } = useAuth();
  const { discovery_range_m } = usePreferences();
  const [tab, setTab] = useState<Tab>("users");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");

  // Debounce — 300ms is a reasonable compromise between snappiness
  // and not spamming the API when someone's typing.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  // Location for clustar-scoped search. Lazy — we only need it when
  // the user picks the Clustars tab AND types something.
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    if (tab !== "clustars" || coords) return;
    getCurrentLocation().then(setCoords).catch(() => {});
  }, [tab, coords]);

  const usersQ = useQuery({
    queryKey: ["search-users", debouncedQ],
    queryFn: () => searchApi.users(accessToken!, debouncedQ),
    enabled: !!accessToken && !!debouncedQ && tab === "users",
  });
  const clustarsQ = useQuery({
    queryKey: ["search-clustars", debouncedQ, coords?.lat, coords?.lng, discovery_range_m],
    queryFn: () => searchApi.clustars(accessToken!, debouncedQ, coords!.lat, coords!.lng, discovery_range_m),
    enabled: !!accessToken && !!debouncedQ && tab === "clustars" && !!coords,
  });

  const activeQ = tab === "users" ? usersQ : clustarsQ;
  const results = activeQ.data ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.topBtn}>
          <Icon name="back" size={18} color={colors.t2} />
        </Pressable>
        <View style={styles.searchBox}>
          <Icon name="search" size={16} color={colors.t3} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder={tab === "users" ? "@handle or name" : "words or #tag"}
            placeholderTextColor={colors.t3}
            style={styles.searchInput}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {q.length > 0 && (
            <Pressable onPress={() => setQ("")} hitSlop={8}>
              <Icon name="close" size={14} color={colors.t3} />
            </Pressable>
          )}
        </View>
      </View>

      <View style={styles.tabRow}>
        <TabPill label="Users" active={tab === "users"} onPress={() => setTab("users")} />
        <TabPill label="Clustars" active={tab === "clustars"} onPress={() => setTab("clustars")} />
      </View>

      {!debouncedQ ? (
        <View style={styles.emptyBlock}>
          <Icon name="search" size={32} color={colors.t3} />
          <Text style={styles.emptyTitle}>
            {tab === "users" ? "Find people" : "Find clustars"}
          </Text>
          <Text style={styles.emptySub}>
            {tab === "users"
              ? "Search by handle or display name"
              : "Search the words or #tag of clustars near you"}
          </Text>
        </View>
      ) : activeQ.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : results.length === 0 ? (
        <View style={styles.emptyBlock}>
          <Text style={styles.emptyTitle}>Nothing here</Text>
          <Text style={styles.emptySub}>
            {tab === "users"
              ? "No one matches that. Check the spelling?"
              : "No matching clustars in range. Try widening your Feed radius in Settings."}
          </Text>
        </View>
      ) : tab === "users" ? (
        <FlatList
          data={results as SearchUserResult[]}
          keyExtractor={u => u.id}
          renderItem={({ item }) => (
            <Pressable onPress={() => router.push(`/user/${item.handle}`)} style={styles.userRow}>
              <View style={styles.avatarWrap}>
                {item.avatar_url ? (
                  <Image source={{ uri: item.avatar_url }} style={styles.avatar} contentFit="cover" />
                ) : (
                  <View style={[styles.avatar, styles.avatarPlaceholder]}>
                    <Text style={styles.avatarText}>{item.handle.slice(0, 2).toUpperCase()}</Text>
                  </View>
                )}
                <View style={styles.presenceAnchor}>
                  <PresenceDot lastActiveAt={item.last_active_at} size={12} />
                </View>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <Text style={styles.userHandle} numberOfLines={1}>
                    {item.display_name ?? `@${item.handle}`}
                  </Text>
                  <TierBadge tier={item.tier} size={11} />
                </View>
                <Text style={styles.userSub}>@{item.handle}</Text>
              </View>
            </Pressable>
          )}
        />
      ) : (
        <FlatList
          data={results}
          keyExtractor={(c: any) => c.id}
          renderItem={({ item }: { item: any }) => (
            <Pressable onPress={() => router.push(`/thread/${item.id}`)} style={styles.clustarRow}>
              <Text style={styles.clustarBody} numberOfLines={3}>{item.body}</Text>
              <View style={styles.clustarMeta}>
                {item.author_handle && (
                  <Text style={styles.clustarMetaText}>
                    @{item.author_handle}
                  </Text>
                )}
                <Text style={styles.clustarMetaText}>
                  {item.participant_count} in · {Math.round(item.distance_m)}m
                </Text>
              </View>
              {item.tags?.length > 0 && (
                <View style={styles.tagRow}>
                  {item.tags.slice(0, 3).map((t: string) => (
                    <Text key={t} style={styles.tag}>#{t}</Text>
                  ))}
                </View>
              )}
            </Pressable>
          )}
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    paddingHorizontal: spacing.xl, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  topBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.s2, borderWidth: 1, borderColor: colors.border,
    alignItems: "center", justifyContent: "center",
  },
  searchBox: {
    flex: 1, flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 20, backgroundColor: colors.s2,
    borderWidth: 1, borderColor: colors.border,
  },
  searchInput: { flex: 1, color: colors.t1, fontSize: 14 },
  tabRow: {
    flexDirection: "row", paddingHorizontal: spacing.xl, paddingTop: spacing.md, gap: 24,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  tabPill: { paddingBottom: 10, borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabPillActive: { borderBottomColor: colors.accent },
  tabPillText: { color: colors.t2, fontSize: 13, fontWeight: "600" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  userRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.xl, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  avatarWrap: { width: 44, height: 44, position: "relative" },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.s2 },
  avatarPlaceholder: {
    backgroundColor: colors.accentBg,
    alignItems: "center", justifyContent: "center",
  },
  avatarText: { color: colors.accent, fontSize: 14, fontWeight: "600" },
  presenceAnchor: {
    position: "absolute", bottom: 1, right: 1, marginLeft: 0,
  },
  userHandle: { color: colors.t1, fontSize: 14, fontWeight: "600" },
  userSub: { color: colors.t3, fontSize: 12, marginTop: 2 },

  clustarRow: {
    paddingHorizontal: spacing.xl, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  clustarBody: { color: colors.t1, fontSize: 14, lineHeight: 20, marginBottom: 6 },
  clustarMeta: { flexDirection: "row", gap: 10, marginBottom: 4 },
  clustarMetaText: { color: colors.t3, fontSize: 11 },
  tagRow: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  tag: { color: colors.accent, fontSize: 11, fontWeight: "500" },

  emptyBlock: { padding: spacing.xxl, alignItems: "center", gap: spacing.md },
  emptyTitle: { color: colors.t1, fontSize: 16, fontWeight: "600" },
  emptySub: { color: colors.t2, fontSize: 13, textAlign: "center", lineHeight: 19, marginTop: 2 },
});
