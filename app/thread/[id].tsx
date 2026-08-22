import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "expo-router";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Keyboard,
} from "react-native";
import { Alert } from "@/lib/alert";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useLocalSearchParams } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import { clustarApi, replyApi, mediaApi, likeApi, repostApi, safetyApi, ApiError, ReplyItem } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { getSocket } from "@/lib/realtime";
import { ImageViewer } from "@/components/ImageViewer";
import { Icon } from "@/components/Icon";
import { ActionSheet } from "@/components/ActionSheet";
import { TierBadge } from "@/components/TierBadge";
import { IdentityPicker } from "@/components/IdentityPicker";
import { useToast } from "@/lib/toast";
import { colors, radius, spacing } from "@/lib/theme";

// A reply plus its resolved children. Server returns replies flat with
// parent_reply_id; we tree them client-side. PRD 4.3 caps nesting at one
// level, so the tree is at most depth 2.
interface ReplyNode extends ReplyItem {
  children: ReplyNode[];
}

// Heat score for reply-sorting: likes weighted heaviest, child-thread depth
// second, freshness as a tiebreaker. Formula mirrors the feed-card heat but
// tuned per-item — a reply with many likes ranks above a fresh one with
// none, and a fresh one with none ranks above an old ignored one.
function replyHeat(node: ReplyNode): number {
  const ageMin = Math.max(1, (Date.now() - new Date(node.created_at).getTime()) / 60_000);
  return node.like_count * 3 + node.children.length * 2 + 20 / ageMin;
}

export type ReplySortMode = "top" | "newest" | "oldest";

function groupReplies(flat: ReplyItem[], sortMode: ReplySortMode = "top"): ReplyNode[] {
  const byId = new Map<string, ReplyNode>();
  const tops: ReplyNode[] = [];

  for (const r of flat) {
    byId.set(r.id, { ...r, children: [] });
  }

  for (const r of flat) {
    const node = byId.get(r.id)!;
    if (r.parent_reply_id && byId.has(r.parent_reply_id)) {
      byId.get(r.parent_reply_id)!.children.push(node);
    } else {
      tops.push(node);
    }
  }

  // Nested children always stay chronological — conversation flow inside a
  // subthread reads better than heat-sort. Only top-level responds to the
  // user's sort choice.
  switch (sortMode) {
    case "top":
      tops.sort((a, b) => replyHeat(b) - replyHeat(a));
      break;
    case "newest":
      tops.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      break;
    case "oldest":
      // Server already returns chronological ASC — keep the natural order.
      break;
  }
  return tops;
}

export default function ThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  // Header height so KeyboardAvoidingView lifts the composer exactly above
  // the keyboard on both platforms. Without this, Android's adjustResize
  // sometimes leaves the input under the keyboard.
  const headerHeight = useHeaderHeight();
  // Drop SafeAreaView bottom edge — apply it manually via insets.bottom on
  // the composer only when the keyboard is closed. Otherwise iOS
  // double-counts the home-indicator area over the keyboard.
  const insets = useSafeAreaInsets();
  const [keyboardShown, setKeyboardShown] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      () => setKeyboardShown(true)
    );
    const hide = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => setKeyboardShown(false)
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  // Composer bottom padding. With the keyboard open the system inset area
  // (home indicator / gesture bar) is covered by the keyboard, so we drop
  // insets.bottom and keep a small 8px gutter. Closed, we re-add the inset
  // so the composer clears the gesture bar. Same rule on both platforms
  // now that Android is also edge-to-edge.
  const composerBottomPad = keyboardShown ? 8 : 8 + insets.bottom;

  // ── Composer state ─────────────────────────────────────────────────────
  const [draft, setDraft] = useState("");
  const [pendingImage, setPendingImage] = useState<{ uri: string; contentType: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  // If set, next send is a reply to this specific reply. Cleared on send.
  const [replyingTo, setReplyingTo] = useState<ReplyItem | null>(null);

  // Image viewer modal — URL of the currently-open image, null when closed.
  const [viewerUri, setViewerUri] = useState<string | null>(null);

  // Like state now comes from server (`liked_by_me` on each reply and the
  // clustar itself). We mutate the cached items directly for optimistic UX;
  // no separate Record/Set to keep in sync.
  const router = useRouter();
  const toast = useToast();

  // User-selectable sort mode for top-level replies. Persists per-mount only
  // (session state), so opening a fresh thread starts on "Top" — the same
  // default sort every social app uses.
  const [replySort, setReplySort] = useState<import("./[id]").ReplySortMode>("top");

  // Identity toggle for the reply composer. If the user has already posted
  // in this thread, `my_identity_in_thread` (from the clustar payload) tells
  // us which identity they used; the picker locks to that.
  const [identity, setIdentity] = useState<"user" | "burner">("user");
  const [identityInitialized, setIdentityInitialized] = useState(false);

  // IDs of replies whose children are hidden. Session-only. Users typically
  // want to collapse deep threads to skim, then re-expand — mirroring the
  // Reddit / Twitter "N more replies" pattern.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCollapse = (replyId: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(replyId)) next.delete(replyId);
      else next.add(replyId);
      return next;
    });
  };

  // ── Data ───────────────────────────────────────────────────────────────
  const clustarQuery = useQuery({
    queryKey: ["clustar", id],
    queryFn: () => clustarApi.get(accessToken!, id!),
    enabled: !!accessToken && !!id,
  });

  const repliesQuery = useQuery({
    queryKey: ["replies", id],
    queryFn: () => replyApi.list(accessToken!, id!),
    enabled: !!accessToken && !!id,
  });

  const tree = useMemo(
    () => groupReplies(repliesQuery.data ?? [], replySort),
    [repliesQuery.data, replySort]
  );

  // Sync the composer identity with whatever the user has already used in
  // this thread. Runs once when clustar data loads — after that the user
  // owns the state (well, they can't change it if locked, but for pristine
  // threads they can pick freely).
  useEffect(() => {
    if (identityInitialized || !clustarQuery.data) return;
    const locked = (clustarQuery.data as any).my_identity_in_thread as
      | "user" | "burner" | null;
    if (locked) setIdentity(locked);
    setIdentityInitialized(true);
  }, [clustarQuery.data, identityInitialized]);

  const identityLocked =
    !!clustarQuery.data && !!(clustarQuery.data as any).my_identity_in_thread;
  const lockedIdentity =
    (clustarQuery.data as any)?.my_identity_in_thread as "user" | "burner" | null;

  // On first render of a non-empty tree, auto-collapse every node at depth
  // >= 1 that has children. Effect: direct children of top-level comments
  // are visible, but their sub-threads (depth 2+) start collapsed. Users
  // tap ▼ to drill deeper. Only seeds ONCE per screen mount — subsequent
  // realtime updates don't re-collapse things the user has expanded.
  const seededCollapse = useRef(false);
  useEffect(() => {
    if (seededCollapse.current) return;
    if (tree.length === 0) return;

    const toCollapse = new Set<string>();
    const walk = (nodes: ReplyNode[], depth: number) => {
      for (const n of nodes) {
        if (depth >= 1 && n.children.length > 0) toCollapse.add(n.id);
        walk(n.children, depth + 1);
      }
    };
    walk(tree, 0);

    setCollapsed(toCollapse);
    seededCollapse.current = true;
  }, [tree]);

  // ── Realtime ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!id) return;
    const socket = getSocket();
    if (!socket) return;

    socket.emit("clustar:join", id);

    const handleNewReply = (reply: ReplyItem) => {
      queryClient.setQueryData<ReplyItem[]>(["replies", id], prev => {
        if (!prev) return [reply];
        if (prev.some(r => r.id === reply.id)) return prev;
        return [...prev, reply];
      });
    };

    // Stats updates for THIS clustar's card — bump the participant count in
    // the cached single-clustar record so the header re-renders.
    const handleStats = (payload: { id: string; stats: { participants?: number; likes?: number; reposts?: number } }) => {
      if (payload.id !== id) return;
      queryClient.setQueryData<any>(["clustar", id], (prev: any) =>
        prev ? { ...prev, stats: { ...prev.stats, ...payload.stats } } : prev
      );
    };

    // Reply stats (like count changed) — patch the specific reply's count
    // in the cached list.
    const handleReplyStats = (payload: { id: string; stats: { likes?: number } }) => {
      if (payload.stats.likes === undefined) return;
      queryClient.setQueryData<ReplyItem[]>(["replies", id], prev =>
        prev
          ? prev.map(r =>
              r.id === payload.id ? { ...r, like_count: payload.stats.likes! } : r
            )
          : prev
      );
    };

    socket.on("reply:new", handleNewReply);
    socket.on("clustar:stats", handleStats);
    socket.on("reply:stats", handleReplyStats);

    return () => {
      socket.emit("clustar:leave", id);
      socket.off("reply:new", handleNewReply);
      socket.off("clustar:stats", handleStats);
      socket.off("reply:stats", handleReplyStats);
    };
  }, [id, queryClient]);

  // ── Mutations ──────────────────────────────────────────────────────────
  const sendReply = useMutation({
    mutationFn: async () => {
      // Upload image first if queued, then post the reply pointing at the
      // resulting public URL. Server rejects reply with neither body nor media.
      let mediaUrl: string | undefined;
      if (pendingImage) {
        setUploading(true);
        try {
          const signed = await mediaApi.sign(accessToken!, pendingImage.contentType);
          await mediaApi.uploadBinary(signed.upload_url, pendingImage.uri, pendingImage.contentType);
          mediaUrl = signed.public_url;
        } finally {
          setUploading(false);
        }
      }
      return replyApi.create(accessToken!, id!, {
        body: draft.trim() || undefined as any,
        as_burner: identity === "burner",
        ...(mediaUrl ? { media_url: mediaUrl, media_type: "image" as const } : {}),
        ...(replyingTo ? { parent_reply_id: replyingTo.id } : {}),
      });
    },
    onSuccess: () => {
      setDraft("");
      setPendingImage(null);
      setReplyingTo(null);
      queryClient.invalidateQueries({ queryKey: ["replies", id] });
    },
    onError: err => {
      const msg = err instanceof ApiError ? err.message : "Failed to reply";
      toast.error(msg);
    },
  });

  // ── Image picking ──────────────────────────────────────────────────────
  // Prompts Camera / Library / Cancel, matching the create-clustar and
  // DM composer flows. Consistency across the app: any image-attach
  // entrypoint offers both camera capture and library selection.
  // Custom cross-platform ActionSheet — same UX on iOS + Android. Uses the
  // ActionSheet component mounted below; opening only flips visible state.
  const pickFromSource = async (source: "camera" | "library") => {
    const perm = source === "camera"
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      toast.error(`${source === "camera" ? "Camera" : "Photo"} access denied — enable it in Settings to attach.`);
      return;
    }
    const result = source === "camera"
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ["images"] as any,
          quality: 0.7,
          allowsEditing: false,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"] as any,
          quality: 0.7,
          allowsEditing: false,
        });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    const inferred = asset.mimeType ?? (
      /\.gif$/i.test(asset.uri) ? "image/gif" :
      /\.png$/i.test(asset.uri) ? "image/png" :
      /\.webp$/i.test(asset.uri) ? "image/webp" :
      "image/jpeg"
    );
    setPendingImage({ uri: asset.uri, contentType: inferred });
  };
  const pickImage = () => setPickerOpen(true);

  // ── Like handlers ──────────────────────────────────────────────────────
  // Optimistic: patch the cached item's liked_by_me + like_count, roll back
  // on server error. Server broadcasts truth via reply:stats / clustar:stats
  // which reconciles any drift automatically.
  const toggleReplyLike = async (reply: ReplyItem) => {
    const wasLiked = reply.liked_by_me;
    const delta = wasLiked ? -1 : 1;
    queryClient.setQueryData<ReplyItem[]>(["replies", id], prev =>
      prev
        ? prev.map(r =>
            r.id === reply.id
              ? { ...r, liked_by_me: !wasLiked, like_count: Math.max(0, r.like_count + delta) }
              : r
          )
        : prev
    );
    try {
      const res = await likeApi.toggleReply(accessToken!, reply.id);
      queryClient.setQueryData<ReplyItem[]>(["replies", id], prev =>
        prev
          ? prev.map(r =>
              r.id === reply.id ? { ...r, liked_by_me: res.liked, like_count: res.count } : r
            )
          : prev
      );
    } catch {
      queryClient.setQueryData<ReplyItem[]>(["replies", id], prev =>
        prev
          ? prev.map(r =>
              r.id === reply.id
                ? { ...r, liked_by_me: wasLiked, like_count: Math.max(0, r.like_count - delta) }
                : r
            )
          : prev
      );
    }
  };

  const toggleClustarLike = async () => {
    if (!id) return;
    const current = clustarQuery.data;
    if (!current) return;
    const wasLiked = current.liked_by_me;
    const delta = wasLiked ? -1 : 1;
    queryClient.setQueryData<any>(["clustar", id], (prev: any) =>
      prev
        ? {
            ...prev,
            liked_by_me: !wasLiked,
            stats: { ...prev.stats, likes: Math.max(0, (prev.stats.likes ?? 0) + delta) },
          }
        : prev
    );
    try {
      const res = await likeApi.toggleClustar(accessToken!, id);
      queryClient.setQueryData<any>(["clustar", id], (prev: any) =>
        prev ? { ...prev, liked_by_me: res.liked, stats: { ...prev.stats, likes: res.count } } : prev
      );
    } catch {
      queryClient.setQueryData<any>(["clustar", id], (prev: any) =>
        prev
          ? {
              ...prev,
              liked_by_me: wasLiked,
              stats: { ...prev.stats, likes: Math.max(0, (prev.stats.likes ?? 0) - delta) },
            }
          : prev
      );
    }
  };

  const canSend = (draft.trim().length > 0 || !!pendingImage) && !sendReply.isPending && !uploading;
  const clustar = clustarQuery.data;

  return (
    <SafeAreaView style={styles.safe} edges={[]}>
      {/* Padding on both platforms lifts the composer above the keyboard.
          Offset = actual stack header height so we don't overshoot. On
          Android this pairs with softwareKeyboardLayoutMode: "resize"
          (in app.config.js) — behavior="height" caused double-adjust and
          hid the input on some devices. */}
      {/* Expo SDK 54 turns on edge-to-edge for Android by default, which
          makes softwareKeyboardLayoutMode:"resize" a no-op — the window no
          longer shrinks when the keyboard opens. So BOTH platforms need
          KeyboardAvoidingView with "padding".
          Offset: iOS needs the stack header height subtracted; Android's
          KAV measures from the window top (which already excludes the
          header under edge-to-edge), so offset 0. */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior="padding"
        keyboardVerticalOffset={Platform.OS === "ios" ? headerHeight : 0}
      >
        <FlatList
          data={tree}
          keyExtractor={r => r.id}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={styles.header}>
              {clustar ? (
                <>
                  {clustar.body ? <Text style={styles.body}>{clustar.body}</Text> : null}
                  {clustar.media_url && clustar.media_type === "image" && (
                    <Pressable onPress={() => setViewerUri(clustar.media_url!)}>
                      <Image
                        source={{ uri: clustar.media_url }}
                        style={styles.headerImage}
                        contentFit="cover"
                        transition={100}
                      />
                    </Pressable>
                  )}
                  <View style={styles.tagRow}>
                    {clustar.tags.map(t => (
                      <View key={t} style={styles.tag}>
                        <Text style={styles.tagText}>#{t}</Text>
                      </View>
                    ))}
                  </View>
                  <View style={styles.metaRow}>
                    <View style={styles.statItem}>
                      <Icon name="comment" size={13} color={colors.t2} />
                      <Text style={styles.metaText}>{clustar.stats.replies ?? 0}</Text>
                    </View>
                    <Pressable onPress={toggleClustarLike} hitSlop={8} style={styles.statItem}>
                      <Icon
                        name={clustar.liked_by_me ? "heart-fill" : "heart"}
                        size={13}
                        color={clustar.liked_by_me ? colors.danger : colors.t2}
                      />
                      <Text style={[styles.metaText, clustar.liked_by_me && { color: colors.danger }]}>
                        {clustar.stats.likes}
                      </Text>
                    </Pressable>
                    <View style={styles.statItem}>
                      <Icon name="users" size={13} color={colors.t2} />
                      <Text style={styles.metaText}>{clustar.stats.participants}</Text>
                    </View>
                    {/* Repost/Undo — toggles based on whether the current user
                        has an active repost of this clustar. `reposted_by_me`
                        is the repost id (or null); when set, we DELETE it. */}
                    <Pressable
                      onPress={() => {
                        if (clustar.reposted_by_me) {
                          Alert.alert(
                            "Remove your repost?",
                            "Your repost of this clustar will disappear from other people's feeds.",
                            [
                              { text: "Cancel", style: "cancel" },
                              {
                                text: "Remove",
                                style: "destructive",
                                onPress: async () => {
                                  const repostId = clustar.reposted_by_me!;
                                  // Optimistic: patch BOTH the thread's
                                  // clustar cache AND any feed lists that
                                  // hold this clustar. Also drop the
                                  // reposter's card (the repost itself)
                                  // from any feed cache — it's about to
                                  // disappear from other users' feeds too.
                                  const patchRemoved = (c: any) =>
                                    c.id === id
                                      ? {
                                          ...c,
                                          reposted_by_me: null,
                                          stats: {
                                            ...c.stats,
                                            reposts: Math.max(0, (c.stats.reposts ?? 0) - 1),
                                          },
                                        }
                                      : c;
                                  queryClient.setQueryData<any>(["clustar", id], (prev: any) =>
                                    prev ? patchRemoved(prev) : prev
                                  );
                                  queryClient.setQueriesData<any[]>(
                                    { queryKey: ["feed"] },
                                    (prev: any[] | undefined) =>
                                      prev
                                        ? prev
                                            .filter((c: any) => c.id !== repostId)
                                            .map(patchRemoved)
                                        : prev
                                  );
                                  try {
                                    await repostApi.remove(accessToken!, repostId);
                                  } catch (err) {
                                    // Roll back the flag + count on error.
                                    // We don't restore the removed repost card
                                    // because we didn't have the original in
                                    // memory to re-insert; a refetch handles it.
                                    queryClient.setQueryData<any>(["clustar", id], (prev: any) =>
                                      prev
                                        ? {
                                            ...prev,
                                            reposted_by_me: repostId,
                                            stats: {
                                              ...prev.stats,
                                              reposts: (prev.stats.reposts ?? 0) + 1,
                                            },
                                          }
                                        : prev
                                    );
                                    queryClient.invalidateQueries({ queryKey: ["feed"] });
                                    const msg = err instanceof ApiError ? err.message : "Couldn't remove";
                                    toast.error(msg);
                                  }
                                },
                              },
                            ]
                          );
                        } else if (clustar.authored_by_me) {
                          // Block self-repost client-side too — server will
                          // reject anyway, but showing the error BEFORE the
                          // repost modal opens feels a lot cleaner.
                          Alert.alert(
                            "Can't repost",
                            "You can't repost your own clustar."
                          );
                        } else {
                          router.push({ pathname: "/repost", params: { id: clustar.id } });
                        }
                      }}
                      hitSlop={8}
                      style={styles.statItem}
                    >
                      <Icon
                        name="repeat"
                        size={13}
                        color={clustar.reposted_by_me ? colors.accent : colors.t2}
                      />
                      <Text
                        style={[
                          styles.metaText,
                          clustar.reposted_by_me && { color: colors.accent, fontWeight: "600" },
                        ]}
                      >
                        {clustar.stats.reposts ?? 0}
                      </Text>
                    </Pressable>
                    <View style={[styles.statItem, { marginLeft: "auto" }]}>
                      <Icon name="clock" size={12} color={colors.accentDim} />
                      <Text style={[styles.metaText, { color: colors.accentDim }]}>
                        {formatRemaining(clustar.expires_at)}
                      </Text>
                    </View>
                    {/* Owner-only delete — shown as a small trash button.
                        authored_by_me is server-computed and burner-aware. */}
                    {clustar.authored_by_me && (
                      <Pressable
                        onPress={() => {
                          Alert.alert(
                            "Delete this clustar?",
                            "This can't be undone. Replies, likes, reposts and attached media will be removed.",
                            [
                              { text: "Cancel", style: "cancel" },
                              {
                                text: "Delete",
                                style: "destructive",
                                onPress: async () => {
                                  try {
                                    await clustarApi.remove(accessToken!, id!);

                                    // Cache surfaces that hold this clustar
                                    // and need to drop it immediately:
                                    //   1. Feed lists (all coord keys)
                                    //   2. Profile grids (all handle keys)
                                    //   3. Thread's own clustar cache
                                    //   4. Thread's replies cache
                                    // Also invalidate profile stats so the
                                    // "N clustars" count re-fetches with
                                    // the new total.
                                    const filterCard = (c: any) =>
                                      c.id !== id &&
                                      (!c.is_repost || c.original?.id !== id);

                                    queryClient.setQueriesData<any[]>(
                                      { queryKey: ["feed"] },
                                      (prev) => (prev ? prev.filter(filterCard) : prev)
                                    );
                                    queryClient.setQueriesData<any[]>(
                                      { queryKey: ["profile-clustars"] },
                                      (prev) => (prev ? prev.filter(filterCard) : prev)
                                    );
                                    queryClient.removeQueries({ queryKey: ["clustar", id] });
                                    queryClient.removeQueries({ queryKey: ["replies", id] });
                                    // Force a re-count of the author's
                                    // profile stats (clustars, total_likes).
                                    queryClient.invalidateQueries({ queryKey: ["profile"] });

                                    router.back();
                                  } catch (err) {
                                    const msg =
                                      err instanceof ApiError ? err.message : "Delete failed";
                                    Alert.alert("Couldn't delete", msg);
                                  }
                                },
                              },
                            ]
                          );
                        }}
                        hitSlop={8}
                        style={styles.statItem}
                      >
                        <Icon name="close" size={13} color={colors.danger} />
                      </Pressable>
                    )}
                    {/* Report clustar — non-owners only. Sits in the same
                        stats row so both actions live near the content. */}
                    {!clustar.authored_by_me && (
                      <Pressable
                        onPress={() => {
                          const submit = async (reason: string) => {
                            const r = reason?.trim();
                            if (!r) return;
                            try {
                              await safetyApi.report(accessToken!, {
                                target_type: "clustar", target_id: id!, reason: r,
                              });
                              Alert.alert("Report submitted", "A moderator will review it.");
                            } catch (err) {
                              Alert.alert("Couldn't report", err instanceof ApiError ? err.message : "Try again");
                            }
                          };
                          if (Platform.OS === "ios" && (Alert as any).prompt) {
                            (Alert as any).prompt("Report clustar", "What's the issue?", [
                              { text: "Cancel", style: "cancel" },
                              { text: "Submit", onPress: submit },
                            ], "plain-text");
                          } else {
                            Alert.alert("Report clustar", "Choose a reason:", [
                              { text: "Cancel", style: "cancel" },
                              { text: "Spam", onPress: () => submit("spam") },
                              { text: "Harassment", onPress: () => submit("harassment") },
                              { text: "Inappropriate", onPress: () => submit("inappropriate") },
                              { text: "Other", onPress: () => submit("other") },
                            ]);
                          }
                        }}
                        hitSlop={8}
                        style={styles.statItem}
                      >
                        <Icon name="more" size={13} color={colors.t3} />
                      </Pressable>
                    )}
                  </View>
                  {clustar.author.handle && clustar.author.type === "user" && (
                    <Pressable
                      onPress={() => router.push(`/user/${clustar.author.handle}`)}
                      hitSlop={6}
                      style={{ flexDirection: "row", alignItems: "center" }}
                    >
                      <Text style={styles.threadAuthor}>@{clustar.author.handle}</Text>
                      <TierBadge tier={clustar.author.tier} size={12} />
                    </Pressable>
                  )}
                  {clustar.author.handle && clustar.author.type === "burner" && (
                    // Burners have no public profile — tap opens DM compose
                    // pre-filled with the burner handle. Compose screen
                    // shows an "anon" tag next to the recipient.
                    <Pressable
                      onPress={() => router.push({
                        pathname: "/dm-compose",
                        params: { handle: clustar.author.handle },
                      })}
                      hitSlop={6}
                    >
                      <Text style={styles.threadAuthor}>@{clustar.author.handle}</Text>
                    </Pressable>
                  )}
                  {/* Sort control for top-level replies — kept in the header
                      so it's near the content it affects and doesn't add a
                      floating bar that fights the composer at the bottom. */}
                  <View style={styles.sortRow}>
                    {(["top", "newest", "oldest"] as const).map(opt => {
                      const label = opt === "top" ? "Top" : opt === "newest" ? "Newest" : "Oldest";
                      const active = replySort === opt;
                      return (
                        <Pressable
                          key={opt}
                          onPress={() => setReplySort(opt)}
                          hitSlop={6}
                          style={[styles.sortChip, active && styles.sortChipActive]}
                        >
                          <Text
                            style={[
                              styles.sortChipText,
                              active && { color: colors.accent, fontWeight: "600" },
                            ]}
                          >
                            {label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              ) : (
                <ActivityIndicator color={colors.accent} />
              )}
            </View>
          }
          renderItem={({ item }) => (
            <ReplyNodeRow
              node={item}
              depth={0}
              onReply={setReplyingTo}
              onImagePress={setViewerUri}
              onLike={toggleReplyLike}
              collapsed={collapsed}
              onToggleCollapse={toggleCollapse}
            />
          )}
          ListEmptyComponent={
            !repliesQuery.isLoading ? (
              <Text style={styles.empty}>No replies yet — be the first.</Text>
            ) : null
          }
          contentContainerStyle={{ paddingBottom: spacing.xl + 24 }}
        />

        {/* "Replying to" chip — visible when nested reply mode is armed */}
        {replyingTo && (
          <View style={styles.replyingChip}>
            <Text style={{ color: colors.t2, fontSize: 12 }} numberOfLines={1}>
              Replying to <Text style={{ color: colors.accent }}>
                {replyingTo.author.type === "burner" ? "anon" : "user"}
              </Text>
              {replyingTo.body ? ` — "${replyingTo.body.slice(0, 40)}${replyingTo.body.length > 40 ? "…" : ""}"` : ""}
            </Text>
            <Pressable onPress={() => setReplyingTo(null)} hitSlop={8}>
              <Icon name="close" size={14} color={colors.t2} />
            </Pressable>
          </View>
        )}

        {/* Identity picker for the composer. Locked to whichever identity
            the user already used in this thread (server-enforced too). */}
        <View style={styles.identityWrap}>
          <IdentityPicker
            value={identity}
            onChange={setIdentity}
            locked={identityLocked}
            lockedReason={
              identityLocked
                ? lockedIdentity === "burner"
                  ? "You're anonymous in this thread"
                  : "You're posting as yourself in this thread"
                : undefined
            }
          />
        </View>

        {pendingImage && (
          <View style={styles.previewRow}>
            <Image source={{ uri: pendingImage.uri }} style={styles.previewImg} contentFit="cover" />
            <Pressable onPress={() => setPendingImage(null)} style={styles.previewRemove} hitSlop={10}>
              <Text style={{ color: colors.t1, fontSize: 12 }}>Remove</Text>
            </Pressable>
          </View>
        )}

        <View style={[styles.composer, { paddingBottom: composerBottomPad }]}>
          <Pressable
            onPress={pickImage}
            style={styles.imgBtn}
            disabled={sendReply.isPending || uploading}
            hitSlop={8}
          >
            <Icon name="image" size={18} color={colors.t2} />
          </Pressable>
          <TextInput
            style={styles.input}
            placeholder={replyingTo ? "Write your reply..." : "Reply..."}
            placeholderTextColor={colors.t3}
            value={draft}
            onChangeText={setDraft}
            multiline
            maxLength={500}
            editable={!sendReply.isPending && !uploading}
          />
          <Pressable
            style={[styles.sendBtn, !canSend && { opacity: 0.4 }]}
            onPress={() => canSend && sendReply.mutate()}
            disabled={!canSend}
          >
            {sendReply.isPending || uploading ? (
              <ActivityIndicator color={colors.bg} size="small" />
            ) : (
              <Icon name="send" size={16} color={colors.bg} />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <ImageViewer uri={viewerUri} onClose={() => setViewerUri(null)} />

      <ActionSheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Add a photo"
        actions={[
          { label: "Take photo", icon: "camera", onPress: () => pickFromSource("camera") },
          { label: "Choose from library", icon: "image", onPress: () => pickFromSource("library") },
          ...(pendingImage
            ? [
                {
                  label: "Remove photo",
                  icon: "trash" as const,
                  onPress: () => setPendingImage(null),
                  destructive: true,
                },
              ]
            : []),
        ]}
      />
    </SafeAreaView>
  );
}

// ── Reply row (recursive) ─────────────────────────────────────────────────
// Nesting caps at MAX_DEPTH (server enforces the same). At depth === MAX_DEPTH
// the Reply button is hidden — deeper replies must be posted against the
// parent. Children can be collapsed individually (Reddit-style) — the
// caller passes a Set of collapsed reply IDs and a toggle callback.
const MAX_DEPTH = 3;

function ReplyNodeRow({
  node,
  depth,
  onReply,
  onImagePress,
  onLike,
  collapsed,
  onToggleCollapse,
}: {
  node: ReplyNode | ReplyItem;
  depth: number;
  onReply: (r: ReplyItem) => void;
  onImagePress: (uri: string) => void;
  onLike: (r: ReplyItem) => void;
  collapsed: Set<string>;
  onToggleCollapse: (id: string) => void;
}) {
  const router = useRouter();
  const isBurner = node.author.type === "burner";
  const children = "children" in node ? node.children : [];
  const isLiked = node.liked_by_me;
  const likeCount = node.like_count;
  const isCollapsed = collapsed.has(node.id);
  const canReply = depth < MAX_DEPTH;
  const hasChildren = children.length > 0;
  const displayName = isBurner
    ? node.author.handle ?? "anon"
    : node.author.handle ?? "user";

  return (
    <View style={styles.replyBlock}>
      <View style={styles.reply}>
        <View style={[styles.avatar, { backgroundColor: isBurner ? colors.anonBg : colors.accentBg }]}>
          <Text style={{ color: isBurner ? colors.anon : colors.accent, fontSize: 11, fontWeight: "600" }}>
            {(node.author.handle ?? node.author.id).slice(0, 2).toUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.replyHeader}>
            {isBurner ? (
              <Text style={{ color: colors.t1, fontSize: 13, fontWeight: "500" }}>
                @{displayName}
              </Text>
            ) : (
              <Pressable
                onPress={() => node.author.handle && router.push(`/user/${node.author.handle}`)}
                hitSlop={4}
                style={{ flexDirection: "row", alignItems: "center" }}
              >
                <Text style={{ color: colors.t1, fontSize: 13, fontWeight: "500" }}>
                  @{displayName}
                </Text>
                <TierBadge tier={(node.author as any).tier} size={10} />
              </Pressable>
            )}
            <Text style={{ color: colors.t3, fontSize: 11 }}>{timeAgo(node.created_at)}</Text>
          </View>
          {node.body && (
            <Text style={{ color: colors.t1, fontSize: 14, lineHeight: 21 }}>{node.body}</Text>
          )}
          {node.media_url && node.media_type === "image" && (
            <Pressable onPress={() => onImagePress(node.media_url!)}>
              <Image
                source={{ uri: node.media_url }}
                style={styles.replyImage}
                contentFit="cover"
                transition={80}
              />
            </Pressable>
          )}

          {/* Action row: like + reply (if allowed at this depth) + collapse toggle. */}
          <View style={styles.actionRow}>
            <Pressable onPress={() => onLike(node)} hitSlop={8} style={styles.actionItem}>
              <Icon
                name={isLiked ? "heart-fill" : "heart"}
                size={15}
                color={isLiked ? colors.danger : colors.t2}
              />
              <Text style={[styles.actionText, isLiked && { color: colors.danger }]}>
                {likeCount}
              </Text>
            </Pressable>

            {canReply ? (
              <Pressable onPress={() => onReply(node)} hitSlop={8} style={styles.actionItem}>
                <Icon name="comment" size={15} color={colors.t2} />
                <Text style={styles.actionText}>{children.length}</Text>
                <Text style={[styles.actionText, { marginLeft: 4, color: colors.t2 }]}>Reply</Text>
              </Pressable>
            ) : (
              <View style={styles.actionItem}>
                <Icon name="comment" size={15} color={colors.t2} />
                <Text style={styles.actionText}>{children.length}</Text>
              </View>
            )}

            {hasChildren && (
              <Pressable onPress={() => onToggleCollapse(node.id)} hitSlop={8} style={styles.actionItem}>
                <Icon
                  name={isCollapsed ? "chevron-down" : "chevron-up"}
                  size={14}
                  color={colors.accent}
                />
                <Text style={[styles.actionText, { color: colors.accent }]}>
                  {isCollapsed ? `Show ${children.length}` : `Hide`}
                </Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>

      {/* Children — rendered only when not collapsed. Indent visually caps
          at MAX_DEPTH so deep threads don't crush the right edge, but since
          server enforces MAX_DEPTH already, this only handles the visual. */}
      {hasChildren && !isCollapsed && (
        <View style={depth < MAX_DEPTH ? styles.childrenWrap : styles.childrenFlush}>
          {children.map(child => (
            <ReplyNodeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              onReply={onReply}
              onImagePress={onImagePress}
              onLike={onLike}
              collapsed={collapsed}
              onToggleCollapse={onToggleCollapse}
            />
          ))}
        </View>
      )}
    </View>
  );
}

// ── Formatting helpers ────────────────────────────────────────────────────
function formatRemaining(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m left`;
  return `${Math.floor(m / 60)}h ${m % 60}m left`;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

// ── Styles ────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    padding: spacing.xl,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  body: { color: colors.t1, fontSize: 17, lineHeight: 24, marginBottom: spacing.md },
  headerImage: {
    width: "100%",
    height: 240,
    borderRadius: radius.md,
    backgroundColor: colors.s2,
    marginBottom: spacing.md,
  },
  tagRow: { flexDirection: "row", gap: 6, flexWrap: "wrap", marginBottom: spacing.md },
  tag: { backgroundColor: colors.accentBg, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 8 },
  tagText: { color: colors.accent, fontSize: 11, fontWeight: "500" },
  metaRow: { flexDirection: "row", gap: spacing.md, alignItems: "center" },
  metaText: { color: colors.t2, fontSize: 12 },
  threadAuthor: { color: colors.t3, fontSize: 12, marginTop: 8 },
  sortRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: spacing.md,
  },
  sortChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: colors.s2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sortChipActive: { backgroundColor: colors.accentBg, borderColor: colors.accent },
  sortChipText: { color: colors.t2, fontSize: 12 },
  threadAuthor: { color: colors.t3, fontSize: 12, marginTop: 8, fontWeight: "500" },

  replyBlock: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  reply: {
    flexDirection: "row",
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  replyHeader: { flexDirection: "row", alignItems: "baseline", gap: 8, marginBottom: 2 },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    marginTop: spacing.sm,
  },
  actionItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  actionIcon: { color: colors.t2, fontSize: 15 },
  actionText: { color: colors.t2, fontSize: 12, fontWeight: "500" },
  statItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  statIcon: { color: colors.t2, fontSize: 13 },
  childrenWrap: {
    // Indent nested replies under the parent's avatar
    paddingLeft: spacing.md,
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
    marginLeft: spacing.xl + 16,
  },
  childrenFlush: {
    // Past MAX_INDENT_DEPTH we stop indenting but keep the border so it's
    // still visually clear that we're still in a thread.
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
    marginLeft: spacing.xl + 16,
  },
  empty: { color: colors.t3, textAlign: "center", padding: spacing.xxl, fontSize: 13 },

  replyingChip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: 8,
    backgroundColor: colors.s1,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },

  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  input: {
    flex: 1,
    backgroundColor: colors.s2,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: colors.t1,
    fontSize: 14,
    maxHeight: 120,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  imgBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.s2,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  identityWrap: {
    paddingHorizontal: spacing.lg,
    paddingTop: 8,
  },
  previewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  previewImg: {
    width: 60,
    height: 60,
    borderRadius: 8,
    backgroundColor: colors.s2,
  },
  previewRemove: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: colors.s2,
    borderRadius: 6,
  },
  replyImage: {
    marginTop: 8,
    width: "100%",
    height: 200,
    borderRadius: 12,
    backgroundColor: colors.s2,
  },
});
