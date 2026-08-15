// Presence: convert a server-side last_active_at timestamp into
// a display state. Three tiers:
//   • online    — active within the last ONLINE_WINDOW_MS (5 min)
//   • recent    — active within the last RECENT_WINDOW_MS (60 min)
//   • offline   — anything older, or null (opted out / never active)

const ONLINE_WINDOW_MS = 5 * 60_000;
const RECENT_WINDOW_MS = 60 * 60_000;

export type PresenceState = "online" | "recent" | "offline";

export function computePresence(lastActiveAt: string | null | undefined): PresenceState {
  if (!lastActiveAt) return "offline";
  const ms = Date.now() - new Date(lastActiveAt).getTime();
  if (ms < ONLINE_WINDOW_MS) return "online";
  if (ms < RECENT_WINDOW_MS) return "recent";
  return "offline";
}

// Short, WhatsApp-style relative label. "online" for very fresh, then
// "active Nm ago" for recent, coarser buckets after that. Null when
// the user has opted to hide (or never been seen).
export function formatLastSeen(lastActiveAt: string | null | undefined): string | null {
  if (!lastActiveAt) return null;
  const ms = Date.now() - new Date(lastActiveAt).getTime();
  if (ms < ONLINE_WINDOW_MS) return "online";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `active ${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `active ${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `active ${d}d ago`;
  return `active ${Math.floor(d / 7)}w ago`;
}
