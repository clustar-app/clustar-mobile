import Constants from "expo-constants";
import { authStore } from "./authStore";

// Base URL comes from app.json's extra.apiBaseUrl. On device, this must be
// your laptop's LAN IP (e.g. 192.168.1.100), NOT localhost — the phone can't
// reach your laptop's localhost even on the same Wi-Fi. See RUN.md.
const BASE_URL =
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ??
  "http://localhost:3000";

export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
  code?: string;
  details?: { field: string; message: string }[];
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string | undefined,
    message: string,
    public details?: { field: string; message: string }[]
  ) {
    super(message);
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  token?: string;
  query?: Record<string, string | number | undefined>;
}

export async function apiRequest<T>(
  path: string,
  opts: RequestOptions = {}
): Promise<T> {
  return doRequest(path, opts, /* isRetry */ false);
}

// Internal: does the actual fetch, handles 401 by silently refreshing the
// access token once and retrying. The `isRetry` flag prevents infinite loops
// if the refreshed token still comes back 401 (means the server truly
// disagrees; we surface the error).
async function doRequest<T>(
  path: string,
  opts: RequestOptions,
  isRetry: boolean
): Promise<T> {
  const { method = "GET", body, token: explicitToken, query } = opts;

  const url = new URL(path.startsWith("http") ? path : `${BASE_URL}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }

  // Prefer the caller's explicit token, fall back to whatever's currently in
  // authStore. Screens still pass accessToken from useAuth() — that's the
  // fresh in-memory value which matches the store, so both paths agree.
  const token = explicitToken ?? authStore.getAccess();

  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    // Network error — usually means the phone can't reach the API URL.
    throw new ApiError(
      0,
      "NETWORK",
      `Could not reach API at ${BASE_URL}. Check that your laptop's IP is set correctly in app.json.`
    );
  }

  // 304 handling — if a proxy/CDN or a mis-configured server hands us back
  // Not Modified, don't treat it as an error. React Query keeps the prior
  // successful data at the same query key; throwing here would surface as
  // "no data" on screen even though the semantic answer is "unchanged".
  if (res.status === 304 && !isRetry) {
    // Retry the request with a cache-busting query param. This is a
    // belt-and-suspenders workaround; the server now sets Cache-Control:
    // no-store so this branch should rarely fire.
    const bustedPath = path + (path.includes("?") ? "&" : "?") + `_cb=${Date.now()}`;
    return doRequest<T>(bustedPath, opts, true);
  }

  // Silent-refresh path: 401 while we have a refresh token, and this isn't
  // already a retry, and this isn't the refresh endpoint itself.
  if (
    res.status === 401 &&
    !isRetry &&
    !path.includes("/auth/refresh") &&
    !path.includes("/auth/otp/") &&
    !path.includes("/auth/login") &&
    !path.includes("/auth/signup") &&
    authStore.getRefresh()
  ) {
    const newAccess = await authStore.refresh();
    if (newAccess) {
      // Retry once with the fresh token. If it fails again, we surface the
      // error normally — probably means the server actually rejected us.
      return doRequest<T>(path, opts, /* isRetry */ true);
    }
    // Refresh failed — fall through to normal error handling. authStore
    // has already fired onAuthFailure so the UI will bounce to sign-in.
  }

  let payload: ApiResponse<T>;
  try {
    payload = await res.json();
  } catch {
    throw new ApiError(res.status, "PARSE", `Server returned non-JSON (status ${res.status})`);
  }

  if (!res.ok || payload.ok === false) {
    throw new ApiError(
      res.status,
      payload.code,
      payload.error ?? `Request failed with status ${res.status}`,
      payload.details
    );
  }

  return payload.data as T;
}

// ── Endpoint helpers (thin wrappers so screens don't hardcode paths) ─────────

export const authApi = {
  sendOtp: (phone: string) =>
    apiRequest<{ sent: boolean }>("/auth/otp/send", {
      method: "POST",
      body: { phone },
    }),

  verifyOtp: (phone: string, code: string) =>
    apiRequest<{
      isNew: boolean;
      user: { id: string; handle: string };
      accessToken: string;
      refreshToken: string;
    }>("/auth/otp/verify", {
      method: "POST",
      body: { phone, code },
    }),

  checkHandle: (handle: string) =>
    apiRequest<{ available: boolean }>(`/auth/handle/check`, {
      query: { handle },
    }),

  setHandle: (token: string, handle: string) =>
    apiRequest<{ user: { id: string; handle: string } }>("/auth/handle", {
      method: "PATCH",
      token,
      body: { handle },
    }),

  // Google OAuth — client sends the ID token from Google Sign-In, server
  // verifies it and returns our own token pair. Same shape as OTP verify.
  signInWithGoogle: (idToken: string) =>
    apiRequest<{
      isNew: boolean;
      user: { id: string; handle: string };
      accessToken: string;
      refreshToken: string;
    }>("/auth/oauth/google", {
      method: "POST",
      body: { idToken },
    }),

  sendEmailVerification: (email: string) =>
    apiRequest<{ sent: boolean }>("/auth/email/send-verification", {
      method: "POST",
      body: { email },
    }),

  verifyEmail: (email: string, code: string) =>
    apiRequest<{ verified: boolean }>("/auth/email/verify", {
      method: "POST",
      body: { email, code },
    }),

  requestPasswordReset: (email: string) =>
    apiRequest<{ sent: boolean }>("/auth/email/password/reset-request", {
      method: "POST",
      body: { email },
    }),

  resetPassword: (email: string, code: string, password: string) =>
    apiRequest<{ reset: boolean }>("/auth/email/password/reset", {
      method: "POST",
      body: { email, code, password },
    }),

  signupEmail: (email: string, password: string) =>
    apiRequest<{
      isNew: boolean;
      user: { id: string; handle: string };
      emailVerified: boolean;
      accessToken: string;
      refreshToken: string;
    }>("/auth/signup/email", {
      method: "POST",
      body: { email, password },
    }),

  loginEmail: (email: string, password: string) =>
    apiRequest<{
      isNew: boolean;
      user: { id: string; handle: string };
      emailVerified: boolean;
      accessToken: string;
      refreshToken: string;
    }>("/auth/login/email", {
      method: "POST",
      body: { email, password },
    }),
};

export interface FeedItem {
  id: string;
  body: string;
  tags: string[];
  anchor: { lat: number; lng: number };
  radius_m: number;
  anchor_mode: "pinned" | "travelling";
  location_label: string | null;
  visibility: string;
  status: string;
  created_at: string;
  expires_at: string;
  author: { id: string; type: "user" | "burner"; handle: string | null; tier: "free" | "plus" | "pro" | null };
  stats: { participants: number; replies: number; likes: number; reposts: number };
  liked_by_me: boolean;
  // If the current user has an active repost of this clustar, the repost's
  // id is here. null otherwise. Powers the "Reposted / Undo repost" UI.
  reposted_by_me?: string | null;
  // True if the current user authored this clustar (as themselves OR via
  // any of their burners). Used to block "repost your own clustar" client-
  // side BEFORE the modal opens.
  authored_by_me?: boolean;
  media_url: string | null;
  media_type: "image" | "video" | "voice" | null;
  distance_m?: number;
  // Repost-only: when present, this item wraps another clustar. Tapping
  // opens `original.id`'s thread; the reposter's body sits on top.
  is_repost?: boolean;
  original?: {
    id: string;
    body: string;
    tags: string[];
    media_url: string | null;
    media_type: "image" | "video" | "voice" | null;
    author: { id: string; type: "user" | "burner"; handle: string | null; tier: "free" | "plus" | "pro" | null };
  };
}

// ── Users / profiles / follows ───────────────────────────────────────────────
export interface Profile {
  id: string;
  handle: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  created_at: string;
  tier: "free" | "plus" | "pro";
  last_active_at: string | null;
  hide_last_seen: boolean;
  is_admin: boolean;
  is_me: boolean;
  is_blocked_by_me: boolean;
  is_following: boolean;
  is_followed_by: boolean;
  stats: {
    followers: number;
    following: number;
    clustars: number;
    total_likes: number;
  };
}

export interface FollowUser {
  id: string;
  handle: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  tier: "free" | "plus" | "pro" | null;
  last_active_at: string | null;
  is_following: boolean;
}

export const userApi = {
  getProfile: (token: string, handle: string) =>
    apiRequest<Profile>(`/users/${encodeURIComponent(handle)}`, { token }),

  getUserClustars: (token: string, handle: string) =>
    apiRequest<FeedItem[]>(`/users/${encodeURIComponent(handle)}/clustars`, { token }),

  getFollowers: (token: string, handle: string) =>
    apiRequest<FollowUser[]>(`/users/${encodeURIComponent(handle)}/followers`, { token }),

  getFollowing: (token: string, handle: string) =>
    apiRequest<FollowUser[]>(`/users/${encodeURIComponent(handle)}/following`, { token }),

  follow: (token: string, handle: string) =>
    apiRequest<{ is_following: true; followers: number }>(
      `/users/${encodeURIComponent(handle)}/follow`,
      { method: "POST", token }
    ),

  unfollow: (token: string, handle: string) =>
    apiRequest<{ is_following: false; followers: number }>(
      `/users/${encodeURIComponent(handle)}/follow`,
      { method: "DELETE", token }
    ),

  updateMe: (
    token: string,
    patch: { display_name?: string | null; bio?: string | null; avatar_url?: string | null }
  ) =>
    apiRequest<{ updated: boolean }>("/users/me", {
      method: "PATCH",
      token,
      body: patch,
    }),
};

// ── Identity (burners) ───────────────────────────────────────────────────────
export interface Burner {
  id: string;
  handle: string;
}

export interface BurnerRecord {
  id: string;
  handle: string;
  created_at: string;
  retired_at: string | null;
  active: boolean;
  stats: { clustars: number; replies: number };
}

// ── DMs ──────────────────────────────────────────────────────────────────────
export interface DmThreadSummary {
  id: string;
  status: "requested" | "accepted" | "declined";
  created_at: string;
  accepted_at: string | null;
  unlock_clustar_id: string | null;
  my_identity: { type: "user" | "burner"; id: string; handle: string | null };
  is_blocked_by_me?: boolean;
  is_blocked_by_them?: boolean;
  other: {
    id: string;
    handle: string;
    display_name: string | null;
    avatar_url: string | null;
    type: "user" | "burner";
    tier?: "free" | "plus" | "pro" | null;
    last_active_at?: string | null;
    revealed_main: { handle: string; display_name: string | null } | null;
  };
  revealed_at: string | null;
  revealed_by_a_at: string | null;
  revealed_by_b_at: string | null;
  revealed_by_me: boolean;
  revealed_by_them: boolean;
  last_message: {
    body: string | null;
    media_url: string | null;
    created_at: string;
    sender_id: string | null;
    deleted_at: string | null;
  } | null;
  unread_count: number;
}

export interface DmMessage {
  id: string;
  sender_id: string;
  sender_type: "user" | "burner";
  body: string | null;
  media_url: string | null;
  media_type: string | null;
  media_width: number | null;
  media_height: number | null;
  created_at: string;
  read_at: string | null;
  deleted_at: string | null;
}

export interface DmMedia {
  url: string;
  type: string;
  width?: number;
  height?: number;
}

export const dmsApi = {
  sendToHandle: (
    token: string,
    recipient_handle: string,
    body?: string,
    media?: DmMedia,
    as_burner_id?: string,
  ) =>
    apiRequest<{
      sent: boolean;
      silent?: boolean;
      blocked?: boolean;
      blocked_by_me?: boolean;
      blocked_by_them?: boolean;
      thread_id?: string;
      requires_acceptance?: boolean;
      message?: DmMessage;
    }>("/dms/send", {
      method: "POST",
      token,
      body: { recipient_handle, body, media, as_burner_id },
    }),

  sendInThread: (
    token: string,
    threadId: string,
    body?: string,
    media?: DmMedia,
    as_burner_id?: string,
  ) =>
    apiRequest<{
      sent: boolean;
      silent?: boolean;
      blocked?: boolean;
      blocked_by_me?: boolean;
      blocked_by_them?: boolean;
      thread_id?: string;
      requires_acceptance?: boolean;
      message?: DmMessage;
    }>(`/dms/threads/${threadId}/send`, {
      method: "POST",
      token,
      body: { body, media, as_burner_id },
    }),

  revealMe: (token: string, threadId: string) =>
    apiRequest<{ revealed_at: string | null; my_side_revealed?: boolean }>(
      `/dms/threads/${threadId}/reveal`,
      { method: "POST", token }
    ),

  deleteMessage: (token: string, threadId: string, messageId: string) =>
    apiRequest<{ deleted: boolean }>(
      `/dms/threads/${threadId}/messages/${messageId}`,
      { method: "DELETE", token }
    ),

  listThreads: (token: string) =>
    apiRequest<DmThreadSummary[]>("/dms/threads", { token }),

  listRequests: (token: string) =>
    apiRequest<DmThreadSummary[]>("/dms/requests", { token }),

  listSentRequests: (token: string) =>
    apiRequest<DmThreadSummary[]>("/dms/sent-requests", { token }),

  // Validate a handle exists (and whether it's a user or burner) before
  // sending. Used by compose to show inline hints/errors.
  resolveHandle: (token: string, handle: string) =>
    apiRequest<{ type: "user" | "burner"; handle: string }>(
      `/dms/resolve/${encodeURIComponent(handle.replace(/^@/, ""))}`,
      { token }
    ),

  accept: (token: string, threadId: string) =>
    apiRequest<{ accepted: boolean }>(`/dms/threads/${threadId}/accept`, {
      method: "POST",
      token,
    }),

  decline: (token: string, threadId: string) =>
    apiRequest<{ declined: boolean }>(`/dms/threads/${threadId}/decline`, {
      method: "POST",
      token,
    }),

  getMessages: (token: string, threadId: string) =>
    apiRequest<{
      thread: DmThreadSummary;
      messages: DmMessage[];
      segments?: Array<{
        thread_id: string;
        header: null | { my_side: string; other_side: string; kind: "anon_history" };
        my_identity_in_segment: { type: "user" | "burner"; id: string };
        messages: DmMessage[];
      }>;
    }>(`/dms/threads/${threadId}/messages`, { token }),

  markRead: (token: string, threadId: string) =>
    apiRequest<{ ok: boolean }>(`/dms/threads/${threadId}/read`, {
      method: "POST",
      token,
    }),
};

// ── Safety (blocks + reports) ──────────────────────────────────────────────
export interface BlockedRow {
  id: string;
  handle: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
}

// ── Admin (moderation queue) ──────────────────────────────────────────────
export interface ReportRow {
  id: string;
  target_type: "clustar" | "reply" | "dm_thread" | "dm_message" | "user";
  target_id: string;
  reporter_id: string;
  reporter_type: "user" | "burner";
  reason: string;
  content_snapshot: any;
  created_at: string;
  resolved_at: string | null;
  resolution: string | null;
  moderator_id: string | null;
  reporter_handle: string | null;
  author_handle: string | null;
  is_open: boolean;
}

export const adminApi = {
  listReports: (token: string, status: "open" | "resolved" | "all" = "open") =>
    apiRequest<ReportRow[]>(`/admin/reports?status=${status}`, { token }),
  stats: (token: string) =>
    apiRequest<{ open: number; resolved_24h: number }>("/admin/stats", { token }),
  dismiss: (token: string, id: string, note = "") =>
    apiRequest<{ resolved: boolean; action: string }>(`/admin/reports/${id}/dismiss`, {
      method: "POST", token, body: { note },
    }),
  deleteContent: (token: string, id: string, note = "") =>
    apiRequest<any>(`/admin/reports/${id}/delete-content`, {
      method: "POST", token, body: { note },
    }),
  suspendUser: (token: string, id: string, note = "") =>
    apiRequest<any>(`/admin/reports/${id}/suspend-user`, {
      method: "POST", token, body: { note },
    }),
};

export const safetyApi = {
  listBlocks: (token: string) =>
    apiRequest<BlockedRow[]>("/blocks", { token }),

  block: (token: string, handle: string) =>
    apiRequest<{ blocked: boolean; target_id: string }>("/blocks", {
      method: "POST", token, body: { handle },
    }),

  unblock: (token: string, handle: string) =>
    apiRequest<{ unblocked: boolean }>(`/blocks/${encodeURIComponent(handle.replace(/^@/, ""))}`, {
      method: "DELETE", token,
    }),

  report: (
    token: string,
    input: {
      target_type: "clustar" | "reply" | "dm_thread" | "dm_message" | "user";
      target_id: string;
      reason: string;
      as_burner_id?: string;
    },
  ) =>
    apiRequest<{ report_id: string; submitted: boolean }>("/reports", {
      method: "POST", token, body: input,
    }),
};

// ── Notifications ──────────────────────────────────────────────────────────
// ── Travelling anchors ────────────────────────────────────────────────────
export const travellingApi = {
  // Bulk update — pushes one fix to every active travelling clustar.
  updateAnchors: (token: string, lat: number, lng: number) =>
    apiRequest<{ updated: number; ids: string[] }>("/clustars/anchors", {
      method: "PATCH", token, body: { lat, lng },
    }),

  // Does the caller have any active travelling clustars?
  // Client uses this on foreground to decide whether to keep the
  // background location task running or stop it.
  hasMine: (token: string) =>
    apiRequest<{ has_active: boolean }>("/clustars/travelling/mine", { token }),
};

// ── Search + trending ─────────────────────────────────────────────────────
export interface SearchUserResult {
  id: string;
  handle: string;
  display_name: string | null;
  avatar_url: string | null;
  tier: "free" | "plus" | "pro";
  last_active_at: string | null;
  score: number;
}

export const searchApi = {
  users: (token: string, q: string) =>
    apiRequest<SearchUserResult[]>(`/search/users?q=${encodeURIComponent(q)}`, { token }),
  clustars: (token: string, q: string, lat: number, lng: number, range_m: number) =>
    apiRequest<any[]>(`/search/clustars`, {
      token,
      query: { q, lat, lng, range_m },
    }),
};

export const trendingApi = {
  list: (token: string, limit = 20) =>
    apiRequest<FeedItem[]>(`/trending?limit=${limit}`, { token }),
};

export const nearbyApi = {
  activeCount: (token: string, lat: number, lng: number, range_m: number) =>
    apiRequest<{ count: number }>("/nearby/active-count", {
      token,
      query: { lat, lng, range_m },
    }),
};

export const preferencesApi = {
  get: (token: string) =>
    apiRequest<{ hide_last_seen: boolean; nearby_alerts_enabled: boolean }>(
      "/me/preferences",
      { token }
    ),
  patch: (
    token: string,
    patch: { hide_last_seen?: boolean; nearby_alerts_enabled?: boolean },
  ) =>
    apiRequest<{ updated: boolean }>("/me/preferences", {
      method: "PATCH", token, body: patch,
    }),
};

export const notificationsApi = {
  register: (token: string, expoPushToken: string, platform?: "ios" | "android" | "web") =>
    apiRequest<{ registered: boolean }>("/notifications/register", {
      method: "POST", token, body: { token: expoPushToken, platform },
    }),

  unregister: (token: string, expoPushToken: string) =>
    apiRequest<{ unregistered: boolean }>("/notifications/register", {
      method: "DELETE", token, body: { token: expoPushToken },
    }),
};

export const identityApi = {
  getBurner: (token: string) =>
    apiRequest<Burner>("/identity/burner", { token }),

  rotateBurner: (token: string) =>
    apiRequest<Burner>("/identity/burner/rotate", { method: "POST", token }),

  listBurners: (token: string) =>
    apiRequest<BurnerRecord[]>("/identity/burners", { token }),
};

export const repostApi = {
  create: (
    token: string,
    clustarId: string,
    input: {
      lat: number;
      lng: number;
      radius_m: number;
      anchor_mode: "pinned" | "travelling";
      visibility?: "public" | "followers";
      comment?: string;
      as_burner?: boolean;
    }
  ) =>
    apiRequest<FeedItem>(`/clustars/${clustarId}/repost`, {
      method: "POST",
      token,
      body: input,
    }),

  remove: (token: string, repostId: string) =>
    apiRequest<{ deleted: boolean; original_clustar_id: string }>(
      `/reposts/${repostId}`,
      { method: "DELETE", token }
    ),
};

export const clustarApi = {
  discover: (token: string, lat: number, lng: number, rangeM: number) =>
    apiRequest<FeedItem[]>("/clustars/discover", {
      token,
      query: { lat, lng, range_m: rangeM },
    }),

  get: (token: string, id: string) =>
    apiRequest<FeedItem>(`/clustars/${id}`, { token }),

  create: (
    token: string,
    input: {
      body: string;
      tags: string[];
      lat: number;
      lng: number;
      radius_m: number;
      anchor_mode: "pinned" | "travelling";
      lifespan_hours: number;
      media_url?: string;
      media_type?: "image" | "video" | "voice";
      as_burner?: boolean;
      visibility?: "public" | "followers";
    }
  ) =>
    apiRequest<FeedItem>("/clustars", {
      method: "POST",
      token,
      body: input,
    }),

  remove: (token: string, clustarId: string) =>
    apiRequest<{ deleted: boolean }>(`/clustars/${clustarId}`, {
      method: "DELETE",
      token,
    }),
};

export interface ReplyItem {
  id: string;
  clustar_id: string;
  parent_reply_id: string | null;
  body: string | null;
  media_url: string | null;
  media_type: "image" | "video" | "voice" | null;
  author: { id: string; type: "user" | "burner"; handle: string | null; tier: "free" | "plus" | "pro" | null };
  created_at: string;
  like_count: number;
  liked_by_me: boolean;
}

export const replyApi = {
  list: (token: string, clustarId: string) =>
    apiRequest<ReplyItem[]>(`/clustars/${clustarId}/replies`, { token }),

  create: (
    token: string,
    clustarId: string,
    input: {
      body: string;
      media_url?: string;
      media_type?: "image" | "video" | "voice";
      parent_reply_id?: string;
      as_burner?: boolean;
    }
  ) =>
    apiRequest<ReplyItem>(`/clustars/${clustarId}/replies`, {
      method: "POST",
      token,
      body: input,
    }),
};

// ── Media ────────────────────────────────────────────────────────────────────

export interface SignedUpload {
  upload_url: string;
  public_url: string;
  object_key: string;
  kind: string;
  expires_in: number;
}

// ── Reactions (likes) ────────────────────────────────────────────────────────
export const likeApi = {
  toggleClustar: (token: string, clustarId: string) =>
    apiRequest<{ liked: boolean; count: number }>(`/clustars/${clustarId}/like`, {
      method: "POST",
      token,
    }),

  toggleReply: (token: string, replyId: string) =>
    apiRequest<{ liked: boolean; count: number }>(`/replies/${replyId}/like`, {
      method: "POST",
      token,
    }),
};

export const mediaApi = {
  sign: (token: string, contentType: string) =>
    apiRequest<SignedUpload>("/media/sign", {
      method: "POST",
      token,
      body: { content_type: contentType },
    }),

  // Convenience: sign + upload in one call. Returns the public URL to
  // paste into a create-clustar / send-DM request. Callers that need
  // the signed URL separately can still use sign + uploadBinary.
  uploadImage: async (token: string, uri: string, contentType: string) => {
    const signed = await apiRequest<SignedUpload>("/media/sign", {
      method: "POST",
      token,
      body: { content_type: contentType },
    });
    const fileResponse = await fetch(uri);
    const blob = await fileResponse.blob();
    const res = await fetch(signed.upload_url, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: blob,
    });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    return { url: signed.public_url };
  },

  // Upload raw file bytes to the presigned PUT URL. Not routed through
  // apiRequest because it's not a JSON API call — it targets the object
  // store directly, and expects an empty/opaque response.
  uploadBinary: async (uploadUrl: string, uri: string, contentType: string) => {
    // On React Native, fetch() can take a Blob or a form-data file. Simplest
    // path: read the local file to a Blob via fetch(uri).
    const fileResponse = await fetch(uri);
    const blob = await fileResponse.blob();
    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: blob,
    });
    if (!res.ok) {
      throw new Error(`Upload failed: ${res.status}`);
    }
  },
};
