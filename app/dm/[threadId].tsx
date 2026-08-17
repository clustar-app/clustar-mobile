import { useEffect, useMemo, useRef, useState } from "react";
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
  Alert,
  ActionSheetIOS,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as Clipboard from "expo-clipboard";
import { dmsApi, DmMessage, ApiError, mediaApi, safetyApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { getSocket } from "@/lib/realtime";
import { Icon } from "@/components/Icon";
import { TierBadge } from "@/components/TierBadge";
import { PresenceDot } from "@/components/PresenceDot";
import { formatLastSeen, computePresence } from "@/lib/presence";
import { colors, radius, spacing } from "@/lib/theme";

// DM thread view.
//
// Ticks (WhatsApp-style):
//   • Sent, not read → single grey check
//   • Read           → double blue checks
// The previous version always rendered two checks and only changed
// color, which looked identical whether read or not.
//
// Composer supports pending attachment: pick an image, see a preview
// row above the input, type an optional caption, then Send. Cancel
// clears the pending attachment without sending.
//
// Camera and library both available via a picker sheet — mirrors the
// create-clustar flow.

const READ_TICK_COLOR = "#4FC3F7"; // WhatsApp-ish blue, higher contrast than accent

// Append a message into the correct segment. Rules:
//   • If the LAST segment matches the message's thread_id → extend it.
//   • Otherwise start a NEW segment (contiguous-run grouping — matches
//     server's segmentation logic so the optimistic patch renders the
//     same as the eventual refetch).
// For a new canonical segment we know identity + no-header from the
// thread payload. For a new burner-child segment we can't reconstruct
// the header client-side — return the array unchanged so the incoming
// invalidateQueries can refetch fresh segments from the server.
function appendToSegments(segments: any[], msg: any, thread: any): any[] {
  const last = segments[segments.length - 1];
  if (last && last.thread_id === msg.thread_id) {
    return [
      ...segments.slice(0, -1),
      { ...last, messages: [...last.messages, msg] },
    ];
  }
  // New segment — only construct locally for the canonical thread (we
  // know its identity + it renders headerless). Anything else waits for
  // the server refetch.
  if (msg.thread_id === thread?.id) {
    return [
      ...segments,
      {
        thread_id: thread.id,
        header: null,
        my_identity_in_segment: thread.my_identity,
        messages: [msg],
      },
    ];
  }
  return segments;
}

function TickIcon({ color }: { color: string }) {
  return <Icon name="check" size={12} color={color} />;
}

function Ticks({ read }: { read: boolean }) {
  if (read) {
    return (
      <View style={styles.tickRow}>
        <TickIcon color={READ_TICK_COLOR} />
        <View style={{ marginLeft: -5 }}>
          <TickIcon color={READ_TICK_COLOR} />
        </View>
      </View>
    );
  }
  return (
    <View style={styles.tickRow}>
      <TickIcon color="#ffffffaa" />
    </View>
  );
}

export default function DmThreadScreen() {
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { accessToken, user } = useAuth();
  const [draft, setDraft] = useState("");
  const [pendingMedia, setPendingMedia] = useState<
    { url: string; type: string; width: number; height: number; localUri: string } | null
  >(null);
  const [uploading, setUploading] = useState(false);
  const [typingFrom, setTypingFrom] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const listRef = useRef<FlatList<any>>(null);
  const typingTimeout = useRef<any>(null);
  const lastTypingSent = useRef(0);

  const q = useQuery({
    queryKey: ["dm-messages", threadId],
    queryFn: () => dmsApi.getMessages(accessToken!, threadId!),
    enabled: !!accessToken && !!threadId,
  });

  const thread = q.data?.thread;
  const otherIsBurner = thread?.other.type === "burner";
  const iAmBurner = thread?.my_identity.type === "burner";
  const someoneIsBurner = otherIsBurner || iAmBurner;
  const revealed = !!thread?.revealed_at;
  const isPending = thread?.status === "requested";

  // Rendered-item list. When segments are present:
  //   • Each PRE-REVEAL segment renders as ONE list item — a translucent
  //     card wrapping the segment header + all its bubbles. This visually
  //     groups anon history so it reads as a distinct chapter.
  //   • The LIVE segment (canonical thread's own messages) renders as
  //     individual bubbles so composing feels normal.
  // Per-segment my_identity is used to compute isMe accurately — my
  // burner-side messages in an anon segment still right-align even
  // though I'm now @main in the canonical thread.
  type RowItem =
    | { kind: "message"; message: DmMessage; meIdentity: { type: string; id: string } }
    | {
        kind: "segment_card";
        id: string;
        myHandle: string; otherHandle: string;
        meIdentity: { type: string; id: string };
        messages: DmMessage[];
      };
  const rows: RowItem[] = useMemo(() => {
    if (!q.data) return [];
    const segments = q.data.segments;
    const currentIdentity = thread?.my_identity
      ? { type: thread.my_identity.type, id: thread.my_identity.id }
      : { type: "user", id: "" };
    if (!segments || segments.length === 0) {
      return (q.data.messages ?? []).map(m => ({
        kind: "message" as const,
        message: m,
        meIdentity: currentIdentity,
      }));
    }
    const out: RowItem[] = [];
    for (const seg of segments) {
      if (seg.header) {
        // Pre-reveal anon segment — one card
        out.push({
          kind: "segment_card",
          id: `card:${seg.thread_id}`,
          myHandle: seg.header.my_side,
          otherHandle: seg.header.other_side,
          meIdentity: seg.my_identity_in_segment ?? currentIdentity,
          messages: seg.messages,
        });
      } else {
        // Live segment — flatten to individual bubbles
        for (const m of seg.messages) {
          out.push({
            kind: "message",
            message: m,
            meIdentity: seg.my_identity_in_segment ?? currentIdentity,
          });
        }
      }
    }
    return out;
  }, [q.data, thread?.my_identity?.id, thread?.my_identity?.type]);

  // Am I the RECIPIENT of a pending request?
  // Definition: thread is 'requested' AND the first message was NOT sent
  // by my identity. In that case we render a preview UI: read-only
  // message list + Accept/Decline pills instead of the composer.
  const firstMsg = q.data?.messages[0];
  const iSentFirst =
    firstMsg &&
    firstMsg.sender_type === thread?.my_identity.type &&
    firstMsg.sender_id === thread?.my_identity.id;
  const isPreviewingRequest = isPending && firstMsg && !iSentFirst;

  // Mark read on open + on each new message. Skipped for pending threads
  // so the sender doesn't get a double-tick when the recipient just
  // previews their request — decline needs to stay silent.
  useEffect(() => {
    if (accessToken && threadId && q.data && thread?.status === "accepted") {
      dmsApi.markRead(accessToken, threadId).catch(() => {});
      queryClient.setQueryData<any[]>(["dm-threads", user?.id], prev =>
        prev
          ? prev.map(t => (t.id === threadId ? { ...t, unread_count: 0 } : t))
          : prev
      );
    }
  }, [accessToken, threadId, q.data?.messages.length, queryClient, user?.id, thread?.status]);

  // Realtime
  useEffect(() => {
    if (!threadId) return;
    const socket = getSocket();
    if (!socket) return;
    socket.emit("dm:join", threadId);

    const onMessage = (payload: { thread_id: string; message: DmMessage }) => {
      if (payload.thread_id !== threadId) return;
      // Clear any lingering typing bubble from this sender — receiving
      // a real message from them implies they've stopped typing. Kills
      // the "ghost bubble that shows for 3s after send" issue.
      setTypingFrom(prev => (prev === payload.message.sender_id ? null : prev));
      clearTimeout(typingTimeout.current);
      // Patch the thread-message cache. Append to a segment whose
      // thread_id MATCHES the incoming message — do NOT blindly push
      // into the last segment (that bug made main-sent messages land
      // inside burner cards after a segment revive).
      queryClient.setQueryData<any>(["dm-messages", threadId], (prev: any) => {
        if (!prev) return prev;
        const msg = { ...payload.message, thread_id: payload.thread_id };
        const already = (prev.messages ?? []).some((m: DmMessage) => m.id === msg.id);
        if (already) return prev;
        const nextMessages = [...(prev.messages ?? []), msg];
        let nextSegments = prev.segments;
        if (nextSegments) {
          nextSegments = appendToSegments(nextSegments, msg, prev.thread);
        }
        return { ...prev, messages: nextMessages, segments: nextSegments };
      });
      // ALSO patch the inbox thread row so the last-message preview
      // updates when the user leaves this screen. Prior version left
      // the inbox showing stale data until a manual refresh (issue #3).
      queryClient.setQueryData<any[]>(["dm-threads", user?.id], prev =>
        prev
          ? prev.map(t =>
              t.id === threadId
                ? {
                    ...t,
                    last_message: {
                      body: payload.message.body,
                      media_url: payload.message.media_url,
                      created_at: payload.message.created_at,
                      sender_id: payload.message.sender_id,
                      deleted_at: null,
                    },
                    // We're actively viewing, so unread stays 0.
                    unread_count: 0,
                  }
                : t
            )
          : prev
      );
      // Fire markRead IMMEDIATELY on incoming message. Prior version
      // waited for the useEffect on messages.length which had a small
      // render delay — sender's tick lagged by 200-500ms feeling stale.
      // Fire-and-forget: server-side markRead is idempotent + broadcasts
      // dm:message:read to the sender's socket.
      if (thread?.status === "accepted" && accessToken && threadId) {
        dmsApi.markRead(accessToken, threadId).catch(() => {});
      }
    };
    const onRead = (payload: { thread_id: string; message_ids: string[]; read_at: string }) => {
      if (payload.thread_id !== threadId) return;
      queryClient.setQueryData<any>(["dm-messages", threadId], (prev: any) => {
        if (!prev) return prev;
        const set = new Set(payload.message_ids);
        return {
          ...prev,
          messages: prev.messages.map((m: DmMessage) =>
            set.has(m.id) ? { ...m, read_at: payload.read_at } : m
          ),
        };
      });
    };
    const onUpdated = (payload: any) => {
      queryClient.setQueryData<any>(["dm-messages", threadId], (prev: any) => {
        if (!prev) return prev;
        const patched = (msgs: DmMessage[]) =>
          msgs.map(m => (m.id === payload.id ? { ...m, ...payload } : m));
        return {
          ...prev,
          messages: patched(prev.messages ?? []),
          segments: prev.segments
            ? prev.segments.map((s: any) => ({ ...s, messages: patched(s.messages) }))
            : prev.segments,
        };
      });
    };
    const onReveal = () => {
      queryClient.invalidateQueries({ queryKey: ["dm-messages", threadId] });
    };
    // If the thread I'm viewing was merged into a canonical main-to-main
    // thread by a bilateral reveal, redirect to the new thread id.
    const onMerged = (payload: { merged_thread_id: string; canonical_thread_id: string }) => {
      if (payload.merged_thread_id !== threadId) return;
      router.replace(`/dm/${payload.canonical_thread_id}`);
    };
    const onTyping = (payload: { thread_id: string; actor: { id: string; type: string } }) => {
      if (payload.thread_id !== threadId) return;
      // Ignore my own typing echoes.
      if (
        thread?.my_identity &&
        payload.actor.type === thread.my_identity.type &&
        payload.actor.id === thread.my_identity.id
      ) return;
      setTypingFrom(payload.actor.id);
      clearTimeout(typingTimeout.current);
      typingTimeout.current = setTimeout(() => setTypingFrom(null), 3500);
    };

    socket.on("dm:message:new", onMessage);
    socket.on("dm:message:read", onRead);
    socket.on("dm:message:updated", onUpdated);
    socket.on("dm:reveal", onReveal);
    socket.on("dm:merged", onMerged);
    socket.on("dm:typing", onTyping);
    return () => {
      socket.emit("dm:leave", threadId);
      socket.off("dm:message:new", onMessage);
      socket.off("dm:message:read", onRead);
      socket.off("dm:message:updated", onUpdated);
      socket.off("dm:reveal", onReveal);
      socket.off("dm:merged", onMerged);
      socket.off("dm:typing", onTyping);
    };
  }, [threadId, queryClient, thread?.my_identity?.id, thread?.my_identity?.type, router]);

  const sendMut = useMutation({
    mutationFn: (payload: { body?: string; media?: any }) =>
      dmsApi.sendInThread(accessToken!, threadId!, payload.body, payload.media),
    onSuccess: (res) => {
      // Blocked path — surface the reason instead of silent-failing.
      // Server returns { blocked: true, blocked_by_them: true } etc.
      if ((res as any).blocked) {
        Alert.alert(
          "Message not sent",
          (res as any).blocked_by_them
            ? "You've been blocked. Messages you send won't be delivered."
            : "You blocked this user. Unblock from their profile to chat."
        );
        // Force-refetch so the banner/composer state updates without
        // requiring the user to leave and come back.
        queryClient.invalidateQueries({ queryKey: ["dm-messages", threadId] });
        return;
      }
      if (res.message) {
        queryClient.setQueryData<any>(["dm-messages", threadId], (prev: any) => {
          if (!prev) return prev;
          const msg = {
            ...res.message,
            // sendInThread may not echo thread_id in the message object —
            // stamp it from the response envelope so the segment lookup
            // works correctly.
            thread_id: res.message.thread_id ?? res.thread_id ?? prev.thread.id,
          };
          if ((prev.messages ?? []).some((m: DmMessage) => m.id === msg.id)) return prev;
          return {
            ...prev,
            messages: [...(prev.messages ?? []), msg],
            segments: prev.segments ? appendToSegments(prev.segments, msg, prev.thread) : prev.segments,
          };
        });
        queryClient.invalidateQueries({ queryKey: ["dm-messages", threadId] });
      }
      setDraft("");
      setPendingMedia(null);
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : "Send failed";
      Alert.alert("Couldn't send", msg);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (messageId: string) => dmsApi.deleteMessage(accessToken!, threadId!, messageId),
    onSuccess: (_res, messageId) => {
      // Patch BOTH the flat messages array AND the segments array —
      // rendering pulls from segments, so patching only `messages` left
      // the bubble visible until reload (bug reported in test #4).
      const tombstone = { body: null, media_url: null, deleted_at: new Date().toISOString() };
      queryClient.setQueryData<any>(["dm-messages", threadId], (prev: any) => {
        if (!prev) return prev;
        const patched = (msgs: DmMessage[]) =>
          msgs.map(m => (m.id === messageId ? { ...m, ...tombstone } : m));
        return {
          ...prev,
          messages: patched(prev.messages ?? []),
          segments: prev.segments
            ? prev.segments.map((s: any) => ({ ...s, messages: patched(s.messages) }))
            : prev.segments,
        };
      });
      // And patch inbox row so the preview flips to "Message deleted"
      // without waiting for the realtime bump (which the messages
      // screen only sees when it's mounted).
      queryClient.setQueryData<any[]>(["dm-threads", user?.id], prev =>
        prev
          ? prev.map(t =>
              t.id === threadId && t.last_message
                ? { ...t, last_message: { ...t.last_message, ...tombstone } }
                : t
            )
          : prev
      );
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : "Delete failed";
      Alert.alert("Couldn't delete", msg);
    },
  });

  const revealMut = useMutation({
    mutationFn: () => dmsApi.revealMe(accessToken!, threadId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dm-messages", threadId] });
      queryClient.invalidateQueries({ queryKey: ["dm-threads"] });
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : "Reveal failed";
      Alert.alert("Couldn't reveal", msg);
    },
  });

  // Accept/decline mutations for the request-preview mode. On accept
  // the thread flips to 'accepted' and the composer replaces the
  // preview action bar; decline pops back to the messages screen.
  const acceptMut = useMutation({
    mutationFn: () => dmsApi.accept(accessToken!, threadId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dm-messages", threadId] });
      queryClient.invalidateQueries({ queryKey: ["dm-threads"] });
      queryClient.invalidateQueries({ queryKey: ["dm-requests"] });
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : "Couldn't accept";
      Alert.alert("Couldn't accept", msg);
    },
  });
  const declineMut = useMutation({
    mutationFn: () => dmsApi.decline(accessToken!, threadId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dm-requests"] });
      router.back();
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : "Couldn't decline";
      Alert.alert("Couldn't decline", msg);
    },
  });

  // ── Image attach flow ──
  // Picker sheet: Camera / Library / Cancel. Same as the create screen.
  const startAttach = async () => {
    const pick = async (source: "camera" | "library") => {
      const perm = source === "camera"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission needed", `Allow ${source === "camera" ? "camera" : "photo"} access.`);
        return;
      }
      const res = source === "camera"
        ? await ImagePicker.launchCameraAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            quality: 0.85,
            exif: false,
          })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            quality: 0.85,
            exif: false,
          });
      if (res.canceled || !res.assets[0]) return;
      const asset = res.assets[0];
      setUploading(true);
      try {
        const uploaded = await mediaApi.uploadImage(accessToken!, asset.uri, asset.mimeType ?? "image/jpeg");
        setPendingMedia({
          url: uploaded.url,
          type: asset.mimeType ?? "image/jpeg",
          width: asset.width,
          height: asset.height,
          localUri: asset.uri,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Upload failed";
        Alert.alert("Couldn't attach", msg);
      } finally {
        setUploading(false);
      }
    };

    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ["Cancel", "Take Photo", "Choose from Library"],
          cancelButtonIndex: 0,
        },
        (i) => {
          if (i === 1) pick("camera");
          if (i === 2) pick("library");
        }
      );
    } else {
      Alert.alert("Attach photo", undefined, [
        { text: "Camera", onPress: () => pick("camera") },
        { text: "Library", onPress: () => pick("library") },
        { text: "Cancel", style: "cancel" },
      ]);
    }
  };

  const onSend = () => {
    if (sendMut.isPending || uploading) return;
    const body = draft.trim() || undefined;
    if (!body && !pendingMedia) return;
    sendMut.mutate({
      body,
      media: pendingMedia
        ? {
            url: pendingMedia.url,
            type: pendingMedia.type,
            width: pendingMedia.width,
            height: pendingMedia.height,
          }
        : undefined,
    });
  };

  // Throttled typing pulse. Skipped in preview mode to avoid leaking a
  // typing signal before the recipient has accepted.
  //
  // TC-021 fix: the FIRST keystroke used to sometimes not emit because
  // (a) thread.my_identity wasn't loaded yet, or (b) dm:join hadn't
  // propagated so the receiver was still outside the room. We now
  // guard on socket-connected AND retry the first typing event once
  // ~200ms later if the socket wasn't ready, so it doesn't silently drop.
  const onChangeDraft = (t: string) => {
    setDraft(t);
    if (isPreviewingRequest) return;
    const now = Date.now();
    if (now - lastTypingSent.current < 2000) return;
    lastTypingSent.current = now;
    const sock = getSocket();
    const payload = { thread_id: threadId, as: thread?.my_identity };
    if (sock?.connected) {
      sock.emit("dm:typing", payload);
    } else if (sock) {
      // Socket exists but not ready — retry once shortly after.
      setTimeout(() => sock.emit("dm:typing", payload), 250);
    }
  };

  // Scroll to bottom on new messages OR when typing indicator toggles.
  // Note: initial-load scroll is handled by onContentSizeChange below
  // (FlatList content isn't laid out yet when this effect first fires,
  // so scrollToEnd here silently no-ops on mount). This effect handles
  // subsequent updates once content is measured.
  useEffect(() => {
    const t = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    return () => clearTimeout(t);
  }, [rows.length, typingFrom]);

  // First-content-size-change scroll for the "opening a thread with
  // 20 unread messages should land at the bottom" case. Fires once
  // when the FlatList's content is actually measured — reliably works
  // even for long threads where the useEffect above races the layout.
  const hasScrolledOnMount = useRef(false);
  const onListContentSizeChange = () => {
    if (hasScrolledOnMount.current) return;
    if (rows.length === 0) return;
    hasScrolledOnMount.current = true;
    listRef.current?.scrollToEnd({ animated: false });
  };

  const canSend = (draft.trim().length > 0 || !!pendingMedia) && !sendMut.isPending && !uploading;

  const otherHandle = thread?.other.handle;
  const otherRevealedHandle = thread?.other.revealed_main?.handle;
  const otherDisplay = otherRevealedHandle
    ? `@${otherRevealedHandle}`
    : otherHandle ? `@${otherHandle}` : "...";

  // Prompt for a report reason then submit. Used from thread kebab + msg long-press.
  const promptReport = (
    target_type: "dm_thread" | "dm_message" | "clustar" | "reply" | "user",
    target_id: string,
  ) => {
    const submit = async (reason: string) => {
      const r = reason?.trim();
      if (!r) return;
      try {
        await safetyApi.report(accessToken!, { target_type, target_id, reason: r });
        Alert.alert("Report submitted", "A moderator will review it. Thanks for helping keep Clustar safe.");
      } catch (err) {
        Alert.alert("Couldn't report", err instanceof ApiError ? err.message : "Try again");
      }
    };
    // iOS supports Alert.prompt for freeform text; Android needs a canned-reason picker.
    if (Platform.OS === "ios" && (Alert as any).prompt) {
      (Alert as any).prompt(
        "Report",
        "Briefly, what's wrong? A moderator reviews these.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Submit", onPress: submit },
        ],
        "plain-text"
      );
    } else {
      // Canned reasons for Android — reason text becomes the tag chosen.
      Alert.alert("Report", "Choose a reason:", [
        { text: "Cancel", style: "cancel" },
        { text: "Spam", onPress: () => submit("spam") },
        { text: "Harassment", onPress: () => submit("harassment") },
        { text: "Other", onPress: () => submit("other") },
      ]);
    }
  };

  const onLongPressMessage = (m: DmMessage) => {
    if (m.deleted_at) return;
    const isMine =
      m.sender_type === thread?.my_identity.type &&
      m.sender_id === thread?.my_identity.id;
    const actions: any[] = [];
    if (m.body) {
      actions.push({
        text: "Copy",
        onPress: async () => {
          try {
            await Clipboard.setStringAsync(m.body!);
          } catch (err) {
            Alert.alert("Couldn't copy", err instanceof Error ? err.message : "Try again");
          }
        },
      });
    }
    if (isMine) {
      actions.push({
        text: "Delete",
        style: "destructive",
        onPress: () =>
          Alert.alert("Delete this message?", "It'll show as \"Message deleted\" on both sides.", [
            { text: "Cancel", style: "cancel" },
            { text: "Delete", style: "destructive", onPress: () => deleteMut.mutate(m.id) },
          ]),
      });
    } else {
      // Report only shows for OTHER-person messages. Reporting your own
      // message doesn't make sense and just clutters the menu.
      actions.push({
        text: "Report",
        onPress: () => promptReport("dm_message", m.id),
      });
    }
    actions.push({ text: "Cancel", style: "cancel" });
    Alert.alert("Message", undefined, actions);
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.topBtn}>
          <Icon name="back" size={18} color={colors.t2} />
        </Pressable>
        <View style={{ alignItems: "center", flex: 1 }}>
          <Pressable
            onPress={() => {
              const target = otherRevealedHandle ?? (otherIsBurner ? null : otherHandle);
              if (target) router.push(`/user/${target}`);
            }}
            hitSlop={4}
            disabled={otherIsBurner && !otherRevealedHandle}
            style={{ flexDirection: "row", alignItems: "center" }}
          >
            <Text style={styles.topTitle}>{otherDisplay}</Text>
            {/* Tier badge only for main-account counterparts. Burners
                stay unmarked because tier is an account attribute — showing
                it on a burner handle would leak the underlying account.
                After reveal, revealed_main is present and the tier
                applies to that account. */}
            {(!otherIsBurner || otherRevealedHandle) && (
              <TierBadge tier={thread?.other.tier} size={13} />
            )}
          </Pressable>
          {someoneIsBurner && (
            <Text style={styles.topSub}>
              {revealed
                ? "Both revealed"
                : thread?.revealed_by_me
                  ? `Waiting for ${otherDisplay} to reveal`
                  : thread?.revealed_by_them
                    ? `${otherDisplay} revealed. Tap eye to link.`
                    : `Anonymous · you're @${thread?.my_identity.handle ?? user?.handle ?? "anon"}`}
            </Text>
          )}
          {/* Main-account counterpart → show last-seen row under handle.
              "online" state gets a green dot + green text for scannability;
              older states are muted grey. Nothing renders for null
              (hide_last_seen enabled OR never active since migration). */}
          {!someoneIsBurner && thread?.other.last_active_at && (() => {
            const state = computePresence(thread.other.last_active_at);
            const label = formatLastSeen(thread.other.last_active_at);
            const isOnline = state === "online";
            return (
              <View style={styles.presenceRow}>
                {isOnline && <View style={styles.presenceInlineDot} />}
                <Text style={[styles.topSub, isOnline && styles.topSubOnline]}>
                  {label}
                </Text>
              </View>
            );
          })()}
        </View>
        {/* Right-side action group. Wrapping in a View with gap keeps
            kebab + eye visually distinct (no fat-finger overlap) since
            the flex:1 center pushes them adjacent otherwise. */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        {/* Kebab (more) menu — always available. Report always; block only
            for main-account counterparts (blocks are account-level and we
            don't expose burner→user mapping). */}
        <Pressable
          onPress={() => {
            const canBlock = thread?.other.type === "user" || !!thread?.other.revealed_main?.handle;
            const blockHandle = thread?.other.revealed_main?.handle ?? thread?.other.handle;
            const options: any[] = [];
            if (canBlock && blockHandle) {
              options.push({
                text: `Block @${blockHandle}`,
                style: "destructive",
                onPress: () =>
                  Alert.alert(
                    `Block @${blockHandle}?`,
                    "You won't see each other's content anywhere. This is silent — they aren't notified.",
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Block",
                        style: "destructive",
                        onPress: async () => {
                          try {
                            await safetyApi.block(accessToken!, blockHandle);
                            queryClient.invalidateQueries();
                            router.back();
                          } catch (err) {
                            Alert.alert("Couldn't block", err instanceof ApiError ? err.message : "Try again");
                          }
                        },
                      },
                    ]
                  ),
              });
            }
            // Report options — always available. Menu order intentionally
            // puts "Report a specific message" first so the more precise
            // action reads before the broader one. Both explained in copy.
            options.push({
              text: "Report a specific message",
              onPress: () =>
                Alert.alert(
                  "Long-press a message",
                  "Reports are per-message so moderators see exactly which text or photo was reported. Long-press the message you want to report, then tap Report."
                ),
            });
            options.push({
              text: "Report the whole conversation",
              onPress: () => promptReport("dm_thread", threadId!),
            });
            options.push({ text: "Cancel", style: "cancel" });
            Alert.alert("Options", undefined, options);
          }}
          hitSlop={12}
          style={styles.kebabBtn}
        >
          <Icon name="more" size={18} color={colors.t2} />
        </Pressable>
        {someoneIsBurner && !revealed && iAmBurner && !thread?.revealed_by_me ? (
          <Pressable
            onPress={() =>
              Alert.alert(
                "Reveal your main account?",
                "They'll see your real handle. Once they also reveal, both sides show real names. This can't be undone.",
                [
                  { text: "Cancel", style: "cancel" },
                  { text: "Reveal", onPress: () => revealMut.mutate() },
                ]
              )
            }
            style={styles.revealPill}
          >
            <Icon name="eye" size={14} color={colors.accent} />
          </Pressable>
        ) : null}
        </View>
      </View>

      {isPending && !isPreviewingRequest && (
        <View style={styles.pendingBanner}>
          <Icon name="clock" size={12} color={colors.t2} />
          <Text style={styles.pendingText}>
            Waiting for {otherDisplay} to accept your request. They'll see this
            in their requests inbox.
          </Text>
        </View>
      )}
      {isPreviewingRequest && (
        <View style={[styles.pendingBanner, { borderColor: colors.accent }]}>
          <Icon name="mail" size={12} color={colors.accent} />
          <Text style={styles.pendingText}>
            Message request from {otherDisplay}. Read below, then accept to
            reply. Decline is silent — they won't know.
          </Text>
        </View>
      )}

      {/* Android: behavior="height" resizes the container to sit above
          the keyboard. Prior version passed undefined which relied on
          adjustResize alone — on some Android devices the composer
          slid under the keyboard. */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "android" ? 0 : 120}
      >
        {q.isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={rows}
            keyExtractor={row => row.kind === "segment_card" ? row.id : row.message.id}
            contentContainerStyle={{ paddingVertical: spacing.md, paddingBottom: spacing.xl + 24 }}
            onContentSizeChange={onListContentSizeChange}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              if (item.kind === "segment_card") {
                // Anon history segment — grouped card with header pill
                // and its own bubbles. Owner alignment uses the segment's
                // own me_identity, so my burner-sent messages still
                // right-align.
                return (
                  <View style={styles.segmentCard}>
                    <View style={styles.segmentCardHeader}>
                      <Icon name="mask" size={11} color={colors.t3} />
                      <Text style={styles.segmentCardHeaderText}>
                        {item.myHandle}   →   {item.otherHandle}
                      </Text>
                    </View>
                    {item.messages.map(m => {
                      const isMe =
                        m.sender_type === item.meIdentity.type &&
                        m.sender_id === item.meIdentity.id;
                      return (
                        <Bubble
                          key={m.id}
                          message={m}
                          isMe={isMe}
                          onLongPress={() => onLongPressMessage(m)}
                          onTapImage={(uri) => setPreviewImage(uri)}
                        />
                      );
                    })}
                  </View>
                );
              }
              const m = item.message;
              const isMe =
                m.sender_type === item.meIdentity.type &&
                m.sender_id === item.meIdentity.id;
              return (
                <Bubble
                  message={m}
                  isMe={isMe}
                  onLongPress={() => onLongPressMessage(m)}
                  onTapImage={(uri) => setPreviewImage(uri)}
                />
              );
            }}
            ListEmptyComponent={<Text style={styles.empty}>Say hi.</Text>}
            ListFooterComponent={
              typingFrom ? (
                <View style={[styles.msg, styles.msgThem]}>
                  <View style={[styles.bubble, styles.bubbleThem, { paddingVertical: 12 }]}>
                    <TypingDots />
                  </View>
                </View>
              ) : null
            }
          />
        )}

        {/* Preview-mode action bar replaces the composer entirely */}
        {isPreviewingRequest ? (
          <View style={styles.previewBar}>
            <Pressable
              onPress={() =>
                Alert.alert(
                  "Decline this request?",
                  "They won't be notified. They can't request again for 30 days.",
                  [
                    { text: "Cancel", style: "cancel" },
                    { text: "Decline", style: "destructive", onPress: () => declineMut.mutate() },
                  ]
                )
              }
              disabled={declineMut.isPending || acceptMut.isPending}
              style={[styles.declinePill, (declineMut.isPending || acceptMut.isPending) && { opacity: 0.4 }]}
            >
              <Text style={styles.declinePillText}>Decline</Text>
            </Pressable>
            <Pressable
              onPress={() => acceptMut.mutate()}
              disabled={declineMut.isPending || acceptMut.isPending}
              style={[styles.acceptPill, (declineMut.isPending || acceptMut.isPending) && { opacity: 0.4 }]}
            >
              {acceptMut.isPending ? (
                <ActivityIndicator size="small" color={colors.bg} />
              ) : (
                <Text style={styles.acceptPillText}>Accept</Text>
              )}
            </Pressable>
          </View>
        ) : null}

        {/* Pending attachment preview above composer — hidden in preview mode */}
        {!isPreviewingRequest && pendingMedia && (
          <View style={styles.attachStrip}>
            <Image source={{ uri: pendingMedia.localUri }} style={styles.attachThumb} contentFit="cover" />
            <View style={{ flex: 1 }}>
              <Text style={styles.attachLabel}>Photo attached</Text>
              <Text style={styles.attachHint}>Add a caption (optional)</Text>
            </View>
            <Pressable onPress={() => setPendingMedia(null)} hitSlop={8} style={styles.attachClose}>
              <Icon name="close" size={14} color={colors.t2} />
            </Pressable>
          </View>
        )}

        {/* Blocked banner — replaces composer entirely. User can still
            read history but can't send. If they mid-typed, the input
            is gone so the draft's just discarded. */}
        {thread?.is_blocked_by_them && (
          <View style={styles.blockedFooter}>
            <Icon name="close" size={14} color={colors.danger ?? "#ef4444"} />
            <Text style={styles.blockedFooterText}>
              You've been blocked. Messages you send won't be delivered.
            </Text>
          </View>
        )}
        {thread?.is_blocked_by_me && !thread?.is_blocked_by_them && (
          <View style={styles.blockedFooter}>
            <Text style={styles.blockedFooterText}>
              You blocked this user. Unblock from their profile to chat again.
            </Text>
          </View>
        )}
        {/* Composer hidden while previewing an incoming request OR while blocked */}
        {!isPreviewingRequest && !thread?.is_blocked_by_them && !thread?.is_blocked_by_me && (
        <View style={styles.composer}>
          <Pressable
            onPress={startAttach}
            disabled={sendMut.isPending || uploading}
            style={[styles.attachBtn, (sendMut.isPending || uploading) && { opacity: 0.5 }]}
            hitSlop={6}
          >
            {uploading ? (
              <ActivityIndicator size="small" color={colors.t2} />
            ) : (
              <Icon name="image" size={20} color={colors.t2} />
            )}
          </Pressable>
          <TextInput
            style={styles.input}
            placeholder={pendingMedia ? "Add a caption..." : "Message..."}
            placeholderTextColor={colors.t3}
            value={draft}
            onChangeText={onChangeDraft}
            multiline
            maxLength={2000}
            editable={!sendMut.isPending}
          />
          <Pressable
            style={[styles.sendBtn, !canSend && { opacity: 0.4 }]}
            onPress={onSend}
            disabled={!canSend}
          >
            {sendMut.isPending ? (
              <ActivityIndicator color={colors.bg} size="small" />
            ) : (
              <Icon name="send" size={16} color={colors.bg} />
            )}
          </Pressable>
        </View>
        )}
      </KeyboardAvoidingView>

      {/* Fullscreen image viewer (issue #4). Tap anywhere or X to dismiss. */}
      <Modal
        visible={!!previewImage}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewImage(null)}
      >
        <Pressable style={styles.previewBackdrop} onPress={() => setPreviewImage(null)}>
          {previewImage && (
            <Image
              source={{ uri: previewImage }}
              style={styles.previewImage}
              contentFit="contain"
            />
          )}
          <Pressable
            onPress={() => setPreviewImage(null)}
            style={styles.previewClose}
            hitSlop={12}
          >
            <Icon name="close" size={20} color="#fff" />
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function Bubble({
  message,
  isMe,
  onLongPress,
  onTapImage,
}: {
  message: DmMessage;
  isMe: boolean;
  onLongPress: () => void;
  onTapImage: (uri: string) => void;
}) {
  const tombstoned = !!message.deleted_at;
  return (
    <Pressable
      onLongPress={onLongPress}
      delayLongPress={300}
      style={[styles.msg, isMe ? styles.msgMe : styles.msgThem]}
    >
      <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem]}>
        {tombstoned ? (
          <Text style={[styles.bubbleText, { fontStyle: "italic", opacity: 0.6 }]}>
            Message deleted
          </Text>
        ) : (
          <>
            {message.media_url && (
              // Tap the image → fullscreen viewer (issue #4). Long-press
              // still triggers the message actions via the outer Pressable.
              <Pressable
                onPress={() => onTapImage(message.media_url!)}
                onLongPress={onLongPress}
                delayLongPress={300}
              >
                <MediaImage
                  uri={message.media_url}
                  width={message.media_width}
                  height={message.media_height}
                  dark={isMe}
                />
              </Pressable>
            )}
            {message.body && (
              <Text
                style={[
                  styles.bubbleText,
                  message.media_url ? { marginTop: 6 } : null,
                ]}
              >
                {message.body}
              </Text>
            )}
          </>
        )}
        {isMe && !tombstoned && (
          <View style={styles.metaRow}>
            <Text style={styles.metaTime}>{shortClock(message.created_at)}</Text>
            <Ticks read={!!message.read_at} />
          </View>
        )}
      </View>
    </Pressable>
  );
}

function MediaImage({
  uri,
  width,
  height,
  dark,
}: {
  uri: string;
  width: number | null;
  height: number | null;
  dark: boolean;
}) {
  const w = 220;
  const h = width && height ? Math.round((height / width) * w) : 220;
  return (
    <Image
      source={{ uri }}
      style={{
        width: w,
        height: h,
        borderRadius: 12,
        backgroundColor: dark ? "#00000030" : colors.s3,
      }}
      contentFit="cover"
    />
  );
}

function TypingDots() {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setPhase(p => (p + 1) % 3), 350);
    return () => clearInterval(t);
  }, []);
  return (
    <View style={{ flexDirection: "row", gap: 4, paddingHorizontal: 4, paddingVertical: 2 }}>
      {[0, 1, 2].map(i => (
        <View
          key={i}
          style={{
            width: 6, height: 6, borderRadius: 3,
            backgroundColor: colors.t2,
            opacity: phase === i ? 1 : 0.35,
          }}
        />
      ))}
    </View>
  );
}

function shortClock(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
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
  // Bumped from 10px to 11px so the last-seen row reads clearly under
  // the handle. Was blending into the background before.
  topSub: { color: colors.t3, fontSize: 11, marginTop: 3, fontWeight: "500" },
  topSubOnline: { color: "#22c55e" },
  presenceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 3,
  },
  presenceInlineDot: {
    width: 6, height: 6, borderRadius: 3, backgroundColor: "#22c55e",
  },
  revealPill: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.accentBg, borderWidth: 1, borderColor: colors.accent,
    alignItems: "center", justifyContent: "center",
  },
  kebabBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.s2, borderWidth: 1, borderColor: colors.border,
    alignItems: "center", justifyContent: "center",
  },
  pendingBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: spacing.xl,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.s1,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pendingText: { color: colors.t2, fontSize: 12, flex: 1, lineHeight: 17 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { color: colors.t3, textAlign: "center", paddingTop: spacing.xxl, fontSize: 13 },

  msg: { paddingHorizontal: spacing.md, paddingVertical: 3 },
  msgMe: { alignItems: "flex-end" },
  msgThem: { alignItems: "flex-start" },
  bubble: {
    maxWidth: "78%",
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 18,
  },
  bubbleMe: { backgroundColor: colors.accent, borderBottomRightRadius: 4 },
  bubbleThem: { backgroundColor: colors.s2, borderBottomLeftRadius: 4 },
  bubbleText: { color: colors.t1, fontSize: 14, lineHeight: 19 },
  metaRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    marginTop: 3,
  },
  metaTime: { color: "#ffffffaa", fontSize: 10 },
  tickRow: { flexDirection: "row", alignItems: "center", marginLeft: 4 },

  attachStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.s1,
  },
  attachThumb: { width: 44, height: 44, borderRadius: 8 },
  attachLabel: { color: colors.t1, fontSize: 13, fontWeight: "600" },
  attachHint: { color: colors.t3, fontSize: 11, marginTop: 1 },
  attachClose: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: colors.s2,
    alignItems: "center", justifyContent: "center",
  },

  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 6,
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  attachBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.s2,
    alignItems: "center", justifyContent: "center",
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
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.accent,
    alignItems: "center", justifyContent: "center",
  },
  previewBar: {
    flexDirection: "row",
    gap: 8,
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  declinePill: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: colors.s3,
    alignItems: "center",
  },
  declinePillText: { color: colors.t1, fontWeight: "600", fontSize: 14 },
  acceptPill: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: "center",
  },
  acceptPillText: { color: colors.bg, fontWeight: "700", fontSize: 14 },
  blockedFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: "rgba(239,68,68,0.08)",
  },
  blockedFooterText: { color: colors.t2, fontSize: 12, flex: 1, lineHeight: 17 },

  // Pre-reveal anon segment — visually grouped card so users read the
  // history as a discrete "chapter" separate from live main-account
  // messages. Faint translucent background + soft border, no borders
  // between individual bubbles inside.
  segmentCard: {
    marginHorizontal: spacing.md,
    marginVertical: spacing.md,
    paddingHorizontal: 4,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  segmentCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingBottom: 8,
    marginBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  segmentCardHeaderText: { color: colors.t3, fontSize: 10, fontWeight: "600", letterSpacing: 0.2 },

  // Fullscreen image preview modal.
  previewBackdrop: {
    flex: 1,
    backgroundColor: "#000000ee",
    alignItems: "center",
    justifyContent: "center",
  },
  previewImage: { width: "100%", height: "100%" },
  previewClose: {
    position: "absolute",
    top: 50,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#00000088",
    alignItems: "center",
    justifyContent: "center",
  },
});
