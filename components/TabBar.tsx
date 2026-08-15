import { useEffect } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, usePathname } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { dmsApi } from "@/lib/api";
import { getSocket } from "@/lib/realtime";
import { colors } from "@/lib/theme";

// Persistent bottom bar rendered on the app's "top-level" screens: feed,
// messages, own profile. Sub-screens (thread, create, settings) don't
// show it — same behavior as Twitter/Instagram where you drill-in and
// the tab bar hides.
//
// The center + button is styled like an accent FAB that "floats" above the
// tab bar per the mockup. Pressing it opens /create instead of routing to
// a tab-owned route (there IS no create route inside the tab structure).
//
// `activeKey` prop lets the parent screen tell the bar which tab is
// current. Fallback: infer from pathname.

type TabKey = "feed" | "messages" | "profile";

interface Props {
  activeKey?: TabKey;
}

export function TabBar({ activeKey }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { user, accessToken } = useAuth();
  const queryClient = useQueryClient();

  // Infer active tab from route if the caller didn't pass one explicitly.
  const derived: TabKey = activeKey ?? inferActive(pathname);

  // Prior implementation polled every 60s, which manifested as a visible
  // pull-to-refresh flicker on the messages inbox every time. Realtime
  // now covers this: dm:inbox:bump fires on any message to any of my
  // threads, dm:request:new on new requests. The queries are still
  // registered here so the badge draws instantly from cached data.
  const inboxQ = useQuery({
    queryKey: ["dm-threads", user?.id],
    queryFn: () => dmsApi.listThreads(accessToken!),
    enabled: !!accessToken && !!user?.id,
  });
  const requestsQ = useQuery({
    queryKey: ["dm-requests", user?.id],
    queryFn: () => dmsApi.listRequests(accessToken!),
    enabled: !!accessToken && !!user?.id,
  });

  // Realtime — invalidate cheap queries only on genuine change events.
  useEffect(() => {
    if (!accessToken) return;
    const socket = getSocket();
    if (!socket) return;
    const bumpInboxes = () => {
      queryClient.invalidateQueries({ queryKey: ["dm-threads"] });
      queryClient.invalidateQueries({ queryKey: ["dm-requests"] });
      queryClient.invalidateQueries({ queryKey: ["dm-sent-requests"] });
    };
    socket.on("dm:request:new", bumpInboxes);
    socket.on("dm:thread:accepted", bumpInboxes);
    socket.on("dm:merged", bumpInboxes);
    // Use dm:inbox:bump (user-room) NOT dm:message:new (thread-room),
    // because the latter never reaches sockets not currently in the
    // thread room. This was the root cause of "badge doesn't update
    // until I navigate" (issue #2).
    socket.on("dm:inbox:bump", bumpInboxes);
    return () => {
      socket.off("dm:request:new", bumpInboxes);
      socket.off("dm:thread:accepted", bumpInboxes);
      socket.off("dm:merged", bumpInboxes);
      socket.off("dm:inbox:bump", bumpInboxes);
    };
  }, [accessToken, queryClient]);

  // Badge = # of threads with any unread + # of pending requests.
  // Do NOT sum message-level unread counts — 5 messages from 1 person
  // would inflate the badge, and iOS/Android convention is per-thread.
  const badgeCount =
    (inboxQ.data?.filter(t => (t.unread_count ?? 0) > 0).length ?? 0) +
    (requestsQ.data?.length ?? 0);

  const goFeed = () => router.replace("/");
  const goCreate = () => router.push("/create");
  const goMessages = () => router.push("/messages");
  const goProfile = () => {
    if (user?.handle) router.push(`/user/${user.handle}`);
  };

  return (
    <View style={[styles.wrap, { paddingBottom: insets.bottom }]}>
      <View style={styles.row}>
        <TabButton
          icon="radio"
          label="Feed"
          active={derived === "feed"}
          onPress={goFeed}
        />
        <CenterButton onPress={goCreate} />
        <TabButton
          icon="message-circle"
          label="Messages"
          active={derived === "messages"}
          onPress={goMessages}
          badge={badgeCount}
        />
        <TabButton
          icon="user"
          label="Profile"
          active={derived === "profile"}
          onPress={goProfile}
        />
      </View>
    </View>
  );
}

function TabButton({
  icon,
  label,
  active,
  onPress,
  badge,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  active: boolean;
  onPress: () => void;
  badge?: number;
}) {
  const showBadge = typeof badge === "number" && badge > 0;
  return (
    <Pressable onPress={onPress} style={styles.tab} hitSlop={4}>
      <View>
        <Feather
          name={icon}
          size={22}
          color={active ? colors.accent : colors.t3}
        />
        {showBadge && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>
              {badge! > 99 ? "99+" : badge}
            </Text>
          </View>
        )}
      </View>
      <Text style={[styles.label, active && { color: colors.accent }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function CenterButton({ onPress }: { onPress: () => void }) {
  return (
    <View style={styles.centerSlot}>
      <Pressable onPress={onPress} style={styles.plus} hitSlop={6}>
        <Feather name="plus" size={26} color={colors.bg} />
      </Pressable>
    </View>
  );
}

function inferActive(pathname: string): TabKey {
  if (pathname.startsWith("/user")) return "profile";
  if (pathname.startsWith("/messages") || pathname.startsWith("/dm")) return "messages";
  return "feed";
}

const styles = StyleSheet.create({
  wrap: {
    // Sits ABOVE the safe-area bottom (inset added dynamically) so home-
    // indicator on modern iPhones doesn't cover the tab labels.
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    height: 60,
    paddingTop: 8,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  label: { color: colors.t3, fontSize: 10, fontWeight: "500" },
  centerSlot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-start",
  },
  plus: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    // Float slightly above the tab bar to match the mockup's raised look.
    marginTop: -12,
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  badge: {
    position: "absolute",
    top: -4,
    right: -8,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.bg,
  },
  badgeText: {
    color: colors.bg,
    fontSize: 10,
    fontWeight: "700",
  },
});
