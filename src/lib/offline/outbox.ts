'use client';

const DRAFT_PREFIX = 'liftitup_workout_draft_v2:';

export function generateCid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `cid_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function saveWorkoutDraft<T>(draftKey: string, draft: T | null): void {
  if (typeof window === 'undefined') return;
  const storageKey = `${DRAFT_PREFIX}${draftKey}`;
  try {
    if (draft === null) {
      window.localStorage.removeItem(storageKey);
    } else {
      window.localStorage.setItem(storageKey, JSON.stringify(draft));
    }
  } catch {
    // Ignore storage quota errors
  }
}

export function loadWorkoutDraft<T>(draftKey: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`${DRAFT_PREFIX}${draftKey}`);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function clearWorkoutDraft(draftKey: string): void {
  saveWorkoutDraft(draftKey, null);
}
