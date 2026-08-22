import AsyncStorage from "@react-native-async-storage/async-storage";

// ── Create-clustar draft store ──────────────────────────────────────────────
// Persists the in-progress compose state when a post fails, so the user can
// retry without retyping. Saved on onError, loaded on mount, cleared on
// success. Not saved on plain "cancel" (close the sheet) — that would be
// surprising the next time they open create fresh.
//
// Drafts expire after DRAFT_TTL_MS so an old stale draft doesn't populate
// when the user opens create days later.

const DRAFT_KEY = "clustar.createDraft";
const DRAFT_TTL_MS = 30 * 60 * 1000; // 30 minutes

export interface CreateDraft {
  body: string;
  radiusM: number;
  identity: "user" | "burner";
  visibility: "public" | "followers";
  anchorMode: "pinned" | "travelling";
  lifespanHours: number;
  pendingImage: { uri: string; contentType: string } | null;
  savedAt: number;
}

export async function saveDraft(draft: Omit<CreateDraft, "savedAt">): Promise<void> {
  try {
    const withStamp: CreateDraft = { ...draft, savedAt: Date.now() };
    await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(withStamp));
  } catch (err) {
    console.warn("[draftStore] save failed:", err);
  }
}

export async function loadDraft(): Promise<CreateDraft | null> {
  try {
    const raw = await AsyncStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CreateDraft;
    // Discard stale drafts — nobody wants a caption from three days ago
    // repopulating the composer.
    if (Date.now() - parsed.savedAt > DRAFT_TTL_MS) {
      await clearDraft();
      return null;
    }
    return parsed;
  } catch (err) {
    console.warn("[draftStore] load failed:", err);
    return null;
  }
}

export async function clearDraft(): Promise<void> {
  try {
    await AsyncStorage.removeItem(DRAFT_KEY);
  } catch (err) {
    console.warn("[draftStore] clear failed:", err);
  }
}
