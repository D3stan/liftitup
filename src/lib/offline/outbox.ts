'use client';

import { apiFetch, ApiClientError } from '@/components/ui';

const DRAFT_PREFIX = 'liftitup_workout_draft_v2:';
const OUTBOX_STORAGE_KEY = 'liftitup_offline_outbox_v2';

export interface OfflineWorkoutOp {
  cid: string;
  endpoint: string;
  method: 'POST' | 'PATCH';
  payload: Record<string, unknown>;
  createdAt: string;
}

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

export function getOfflineOps(): OfflineWorkoutOp[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(OUTBOX_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as OfflineWorkoutOp[]) : [];
  } catch {
    return [];
  }
}

function writeOfflineOps(ops: OfflineWorkoutOp[]): void {
  if (typeof window === 'undefined') return;
  try {
    if (ops.length === 0) {
      window.localStorage.removeItem(OUTBOX_STORAGE_KEY);
    } else {
      window.localStorage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify(ops));
    }
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Only for true network-offline errors (never 4xx/5xx HTTP responses).
 */
export function enqueueNetworkRetryOp(op: {
  cid: string;
  endpoint: string;
  method: 'POST' | 'PATCH';
  payload: Record<string, unknown>;
}): void {
  const next = getOfflineOps().filter((item) => item.cid !== op.cid);
  next.push({
    ...op,
    createdAt: new Date().toISOString(),
  });
  writeOfflineOps(next);
}

/**
 * Flushes queued network-offline ops. Any 4xx response is immediately dropped
 * (never retried in a silent loop) and reported in `droppedErrors`.
 */
export async function flushOfflineOps(): Promise<{
  flushedCount: number;
  remainingCount: number;
  droppedErrors: string[];
}> {
  const queue = getOfflineOps();
  if (queue.length === 0) {
    return { flushedCount: 0, remainingCount: 0, droppedErrors: [] };
  }

  let flushedCount = 0;
  const remaining: OfflineWorkoutOp[] = [];
  const droppedErrors: string[] = [];

  for (const op of queue) {
    try {
      await apiFetch(op.endpoint, {
        method: op.method,
        body: JSON.stringify(op.payload),
      });
      flushedCount += 1;
    } catch (err) {
      if (err instanceof ApiClientError && err.status >= 400 && err.status < 500) {
        // Non-retriable client error: drop immediately and surface message
        droppedErrors.push(err.message);
      } else {
        remaining.push(op);
      }
    }
  }

  writeOfflineOps(remaining);
  return {
    flushedCount,
    remainingCount: remaining.length,
    droppedErrors,
  };
}
