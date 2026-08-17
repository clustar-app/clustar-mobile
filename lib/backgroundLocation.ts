import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { authStore } from "./authStore";

// Background location for travelling clustars.
//
// Model: as long as the user has ANY active travelling clustar, the OS
// wakes the app periodically with a fresh fix and we push it to the
// server (bulk endpoint updates every travelling clustar the user owns
// in one call). When no active travelling clustars remain, we stop
// the task so we're not draining battery for nothing.
//
// The task is defined at module scope (required by expo-task-manager
// — task handlers must be registered synchronously on module load, not
// inside components). It's a no-op if not started.

export const TRAVELLING_ANCHOR_TASK = "clustar-travelling-anchor-v1";

// Storage key for the last-pushed coordinate — used to skip network
// calls when the user hasn't moved much. Small on-disk state so the
// task can dedupe across OS wake-ups without a database round-trip.
const LAST_PUSHED_KEY = "clustar:travelling:lastPushed:v1";
const MIN_MOVE_METERS = 25;        // don't push if we moved < this
const MIN_PUSH_INTERVAL_MS = 60_000; // don't push more than 1×/min

TaskManager.defineTask(TRAVELLING_ANCHOR_TASK, async ({ data, error }) => {
  if (error) {
    console.warn("[travelling] task error:", error);
    return;
  }
  const locations = (data as any)?.locations as Location.LocationObject[] | undefined;
  const fix = locations?.[locations.length - 1];
  if (!fix) return;

  // Auth check — user might have signed out while the task was still
  // registered. Bail so we don't push with a stale token.
  const token = authStore.getAccess();
  if (!token) return;

  // Throttle + move-distance filter so we're not hammering the API
  // every couple meters (Android especially fires often on some devices).
  try {
    const rawLast = await AsyncStorage.getItem(LAST_PUSHED_KEY);
    if (rawLast) {
      const last = JSON.parse(rawLast) as { lat: number; lng: number; at: number };
      const dt = Date.now() - last.at;
      const dm = haversineMeters(last, { lat: fix.coords.latitude, lng: fix.coords.longitude });
      if (dt < MIN_PUSH_INTERVAL_MS && dm < MIN_MOVE_METERS) return;
    }
  } catch { /* first run or corrupt storage — proceed */ }

  const base = getApiBase();
  try {
    const res = await fetch(`${base}/clustars/anchors`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ lat: fix.coords.latitude, lng: fix.coords.longitude }),
    });
    if (!res.ok) {
      console.warn("[travelling] bulk update failed:", res.status);
      return;
    }
    const json = await res.json();
    const updated = json?.data?.updated ?? 0;
    if (updated === 0) {
      // Zero updated → user has no more active travelling clustars.
      // Kill the task so we stop burning battery for no reason.
      await stopTravellingAnchorTask();
      return;
    }
    await AsyncStorage.setItem(LAST_PUSHED_KEY, JSON.stringify({
      lat: fix.coords.latitude,
      lng: fix.coords.longitude,
      at: Date.now(),
    }));
  } catch (err) {
    console.warn("[travelling] network error:", err);
  }
});

// ── Public API ───────────────────────────────────────────────────────

export async function startTravellingAnchorTask(): Promise<{ started: boolean; reason?: string }> {
  // Check "Always" permission — required for background location. Foreground
  // permission we assume already granted (asked at onboarding).
  const fg = await Location.getForegroundPermissionsAsync();
  if (!fg.granted) {
    const req = await Location.requestForegroundPermissionsAsync();
    if (!req.granted) return { started: false, reason: "foreground_denied" };
  }
  const bg = await Location.getBackgroundPermissionsAsync();
  if (!bg.granted) {
    const req = await Location.requestBackgroundPermissionsAsync();
    if (!req.granted) return { started: false, reason: "background_denied" };
  }

  const already = await Location.hasStartedLocationUpdatesAsync(TRAVELLING_ANCHOR_TASK);
  if (already) return { started: true, reason: "already_running" };

  await Location.startLocationUpdatesAsync(TRAVELLING_ANCHOR_TASK, {
    // Battery-friendly: OS picks its own cadence based on significant
    // movement. distanceInterval:50 = don't wake us for < 50m moves.
    accuracy: Location.Accuracy.Balanced,
    distanceInterval: 50,
    timeInterval: 60_000,
    // Android needs a persistent-notification foreground service so the
    // OS won't kill our task. iOS handles this via the "Always" perm.
    foregroundService: {
      notificationTitle: "Travelling clustar active",
      notificationBody: "Your clustar's location follows you until it expires.",
      notificationColor: "#F59E0B",
    },
    // pausesUpdatesAutomatically: iOS-only — the OS pauses updates when
    // it thinks the user is stationary; resumes on movement. Great for
    // battery, and travelling-anchor accuracy doesn't need every step.
    pausesUpdatesAutomatically: true,
    activityType: Location.LocationActivityType.OtherNavigation,
    showsBackgroundLocationIndicator: false,
  });
  return { started: true };
}

export async function stopTravellingAnchorTask(): Promise<void> {
  const running = await Location.hasStartedLocationUpdatesAsync(TRAVELLING_ANCHOR_TASK);
  if (!running) return;
  await Location.stopLocationUpdatesAsync(TRAVELLING_ANCHOR_TASK);
}

export async function isTravellingAnchorTaskRunning(): Promise<boolean> {
  return Location.hasStartedLocationUpdatesAsync(TRAVELLING_ANCHOR_TASK);
}

// ── helpers ──────────────────────────────────────────────────────────

function getApiBase(): string {
  return (Constants.expoConfig?.extra?.apiBaseUrl as string) ?? "http://localhost:3000";
}

function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(x));
}
