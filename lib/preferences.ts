import { useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Client-side user preferences persisted to AsyncStorage. Server also
// stores some of these (hide_last_seen, nearby_alerts) — this module
// mirrors them locally + hosts pure-display prefs like the discovery
// range slider setting.
//
// Read via usePreferences() in components. Write via setPreference().
// A lightweight observer pattern (useSyncExternalStore) keeps every
// consumer in sync without pulling in Zustand for one small thing.

export interface Preferences {
  // Discovery range in meters — feed filters clustars to this radius.
  // Server hard-caps at 2km; UI restricts to 20m-1km per PRD.
  discovery_range_m: number;
}

const DEFAULTS: Preferences = {
  discovery_range_m: 500,
};

const STORAGE_KEY = "clustar:preferences:v1";

let current: Preferences = { ...DEFAULTS };
const listeners = new Set<() => void>();

// Hydrate from storage on module load.
(async () => {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      current = { ...DEFAULTS, ...parsed };
      listeners.forEach(l => l());
    }
  } catch {
    // First-run or corrupt — defaults are fine.
  }
})();

export function getPreferences(): Preferences {
  return current;
}

export async function setPreference<K extends keyof Preferences>(
  key: K,
  value: Preferences[K]
): Promise<void> {
  current = { ...current, [key]: value };
  listeners.forEach(l => l());
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch (err) {
    console.warn("[preferences] persist failed:", err);
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function usePreferences(): Preferences {
  return useSyncExternalStore(subscribe, getPreferences, getPreferences);
}

// Range slider constants — exported so screens can share the bounds.
export const RANGE_MIN_M = 20;
export const RANGE_MAX_M = 1000;
