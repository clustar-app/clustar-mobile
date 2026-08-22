import { ApiError } from "./api";

// ── Friendly error messages ────────────────────────────────────────────────
// Every callsite used to write its own "if ApiError then message else 'Try
// again'" boilerplate. That was fine for happy-path errors but produced
// meaningless "Try again" toasts when the network dropped or the server
// timed out. This helper turns any thrown value into a useful sentence.
//
// Usage:
//   catch (err) { toast.error(friendlyError(err, "Couldn't send message")); }

interface FriendlyOpts {
  /** Fallback message when nothing else is available. */
  fallback?: string;
}

export function friendlyError(err: unknown, fallback = "Something went wrong"): string {
  if (err instanceof ApiError) {
    // Check codes FIRST — they're more specific than the message text.
    // A server that returns "Too many requests" with code RATE_LIMIT should
    // become our friendly copy, not echo the raw HTTP status phrase.
    switch (err.code) {
      case "VALIDATION":
        return err.details?.[0]?.message ?? err.message ?? "Please check the fields and try again.";
      case "UNAUTHORIZED":
      case "AUTH_REQUIRED":
        return "Your session expired. Sign in again to continue.";
      case "FORBIDDEN":
        return "You don't have permission to do that.";
      case "NOT_FOUND":
        return "We couldn't find that anymore — it may have been removed.";
      case "RATE_LIMIT":
      case "RATE_LIMITED":
      case "TOO_MANY":
      case "TOO_MANY_REQUESTS":
        // Server sends a per-action message like "You've hit the create
        // clustar limit — 5 per hour. Try again in 42 minutes." — much
        // more useful than a generic breather line. Fall back only if
        // the server didn't include one.
        return err.message && !/^too many requests$/i.test(err.message.trim())
          ? err.message
          : "You're moving fast — take a short breather and try again in a minute.";
      case "SMS_DND":
        return "This number is on the DND registry and can't receive SMS.";
      case "SMS_INVALID_NUMBER":
        return "That phone number isn't a valid SMS destination.";
      case "OTP_EXPIRED":
        return "The code expired. Request a fresh one.";
      case "OTP_INVALID":
        return "That code isn't right. Double-check and try again.";
      case "ROTATE_TOO_SOON":
        return err.message || "You can only rotate your burner once a week.";
    }

    // Server-provided message is usually descriptive — use it unless
    // it's a known generic phrase we've written better copy for above.
    if (err.message && !isGeneric(err.message)) return err.message;

    // HTTP status fallbacks
    if (err.status === 429) {
      return "You're moving fast — take a short breather and try again in a minute.";
    }
    if (err.status === 502 || err.status === 503) {
      return "Our server is having trouble right now. Try again in a minute.";
    }
    if (err.status === 504) {
      return "That took too long. Check your connection and try again.";
    }
    if (err.status >= 500) {
      return "Something went wrong on our end. We're on it — try again shortly.";
    }

    return err.message || fallback;
  }

  // Network-level failures (fetch rejected, DNS, offline, etc.)
  if (err instanceof TypeError && /network|fetch/i.test(err.message)) {
    return "Can't reach the server — check your internet connection.";
  }

  if (err instanceof Error && err.message) {
    return err.message;
  }

  return fallback;
}

function isGeneric(msg: string): boolean {
  const m = msg.trim().toLowerCase();
  return (
    m === "validation error" ||
    m === "something went wrong" ||
    m === "internal server error" ||
    m === "unknown error" ||
    m === "error" ||
    m === "too many requests" ||
    m === "forbidden" ||
    m === "unauthorized" ||
    m === "not found"
  );
}
