export const DRAFT_PREFIX = 'liftitup_workout_draft_v2:';
export const WORKOUT_DRAFTS_CHANGED_EVENT = 'liftitup:workout-drafts-changed';
const USER_SCOPE_PREFIX = 'user:';

function notifyDraftsChanged(storage?: DraftStorageLike): void {
  if (typeof window === 'undefined') return;
  try {
    if (storage && storage !== window.localStorage) return;
    window.dispatchEvent(new Event(WORKOUT_DRAFTS_CHANGED_EVENT));
  } catch {
    // Ignore storage or window access errors
  }
}

export interface DraftStorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function resolveStorage(storage?: DraftStorageLike): DraftStorageLike | null {
  if (storage) return storage;
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function generateCid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `cid_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function buildUserDraftKey(userId: string, baseDraftKey: string): string {
  if (!userId || !userId.trim()) {
    throw new Error('userId is required for user-scoped draft keys');
  }
  return `${USER_SCOPE_PREFIX}${encodeURIComponent(userId)}:${baseDraftKey}`;
}

export function saveWorkoutDraft<T>(
  draftKey: string,
  draft: T | null,
  storage?: DraftStorageLike,
): void {
  const store = resolveStorage(storage);
  if (!store) return;
  const storageKey = `${DRAFT_PREFIX}${draftKey}`;
  try {
    if (draft === null) {
      store.removeItem(storageKey);
    } else {
      store.setItem(storageKey, JSON.stringify(draft));
    }
    notifyDraftsChanged(storage);
  } catch {
    // Ignore storage quota errors
  }
}

export function loadWorkoutDraft<T>(
  draftKey: string,
  storage?: DraftStorageLike,
): T | null {
  const store = resolveStorage(storage);
  if (!store) return null;
  try {
    const raw = store.getItem(`${DRAFT_PREFIX}${draftKey}`);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function clearWorkoutDraft(
  draftKey: string,
  storage?: DraftStorageLike,
): void {
  saveWorkoutDraft(draftKey, null, storage);
}

export function saveUserWorkoutDraft<T>(
  userId: string,
  baseDraftKey: string,
  draft: T | null,
  storage?: DraftStorageLike,
): void {
  saveWorkoutDraft(buildUserDraftKey(userId, baseDraftKey), draft, storage);
}

/**
 * Loads a user's workout draft. If a legacy un-scoped draft exists for `baseDraftKey`
 * and the user has no scoped draft yet, adopts it once under the user's key and
 * deletes the un-scoped key so a second user on the same device never sees it.
 */
export function loadUserWorkoutDraft<T>(
  userId: string,
  baseDraftKey: string,
  storage?: DraftStorageLike,
): T | null {
  const store = resolveStorage(storage);
  if (!store) return null;

  const scopedKey = buildUserDraftKey(userId, baseDraftKey);
  const existing = loadWorkoutDraft<T>(scopedKey, store);
  if (existing !== null) {
    return existing;
  }

  const legacyStorageKey = `${DRAFT_PREFIX}${baseDraftKey}`;
  try {
    const rawLegacy = store.getItem(legacyStorageKey);
    if (!rawLegacy) return null;
    const parsed = JSON.parse(rawLegacy) as T;
    saveWorkoutDraft(scopedKey, parsed, store);
    store.removeItem(legacyStorageKey);
    return parsed;
  } catch {
    try {
      store.removeItem(legacyStorageKey);
    } catch {
      // ignore
    }
    return null;
  }
}

export function clearUserWorkoutDraft(
  userId: string,
  baseDraftKey: string,
  storage?: DraftStorageLike,
): void {
  clearWorkoutDraft(buildUserDraftKey(userId, baseDraftKey), storage);
}

/**
 * One-time adoption of any legacy un-scoped workout drafts in storage to `userId`.
 * Moves each valid legacy draft to the user's scoped key (if not already present)
 * and removes the legacy un-scoped key. Returns the number of adopted drafts.
 */
export function adoptLegacyWorkoutDrafts(
  userId: string,
  storage?: DraftStorageLike,
): number {
  const store = resolveStorage(storage);
  if (!store || !userId || !userId.trim()) return 0;

  const legacyKeys: string[] = [];
  for (let i = 0; i < store.length; i += 1) {
    const key = store.key(i);
    if (
      key &&
      key.startsWith(DRAFT_PREFIX) &&
      !key.startsWith(`${DRAFT_PREFIX}${USER_SCOPE_PREFIX}`)
    ) {
      legacyKeys.push(key);
    }
  }

  let adopted = 0;
  for (const legacyKey of legacyKeys) {
    const baseDraftKey = legacyKey.slice(DRAFT_PREFIX.length);
    const scopedStorageKey = `${DRAFT_PREFIX}${buildUserDraftKey(userId, baseDraftKey)}`;
    try {
      const raw = store.getItem(legacyKey);
      if (raw && store.getItem(scopedStorageKey) === null) {
        JSON.parse(raw);
        store.setItem(scopedStorageKey, raw);
        adopted += 1;
      }
    } catch {
      // Drop corrupt legacy draft rather than leaving it un-scoped
    } finally {
      try {
        store.removeItem(legacyKey);
      } catch {
        // ignore
      }
    }
  }

  if (legacyKeys.length > 0) {
    notifyDraftsChanged(storage);
  }

  return adopted;
}

/**
 * Removes all workout drafts scoped to `userId`. Returns the number of removed keys.
 */
export function clearAllUserDrafts(
  userId: string,
  storage?: DraftStorageLike,
): number {
  const store = resolveStorage(storage);
  if (!store || !userId || !userId.trim()) return 0;

  const userPrefix = `${DRAFT_PREFIX}${USER_SCOPE_PREFIX}${encodeURIComponent(userId)}:`;
  const matchingKeys: string[] = [];
  for (let i = 0; i < store.length; i += 1) {
    const key = store.key(i);
    if (key && key.startsWith(userPrefix)) {
      matchingKeys.push(key);
    }
  }

  for (const key of matchingKeys) {
    try {
      store.removeItem(key);
    } catch {
      // ignore
    }
  }

  if (matchingKeys.length > 0) {
    notifyDraftsChanged(storage);
  }

  return matchingKeys.length;
}
