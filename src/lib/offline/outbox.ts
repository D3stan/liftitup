'use client';

/**
 * LiftItUp — Optimistic Offline-First Outbox Queue (`localStorage`)
 * Patterned after `myfood/src/web/outbox.ts`:
 * Every logged workout or variation swap generates a client idempotency UUID (`cid`),
 * persists to `localStorage` immediately so sets logged in a basement gym with spotty signal
 * are never lost, and flushes idempotently to the server when connectivity returns.
 */

import type { SessionDebriefImpact } from '@/types/domain';

const OUTBOX_STORAGE_KEY = 'liftitup_outbox_v1';
const ACTIVE_DRAFT_STORAGE_KEY = 'liftitup_active_session_draft_v1';

export type OutboxOpType = 'workout_log' | 'variation_swap' | 'schedule_update';

export interface OutboxOperation {
  cid: string;
  type: OutboxOpType;
  endpoint: string;
  method: 'POST' | 'PUT';
  payload: Record<string, unknown>;
  createdAt: string;
  attempts: number;
}

export function generateCid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `cid_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function getPendingOps(): OutboxOperation[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(OUTBOX_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePendingOps(ops: OutboxOperation[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify(ops));
  } catch {
    // Ignore storage quota errors
  }
}

export function enqueueOutboxOp(params: {
  cid?: string;
  type: OutboxOpType;
  endpoint: string;
  method?: 'POST' | 'PUT';
  payload: Record<string, unknown>;
}): OutboxOperation {
  const cid = params.cid || generateCid();
  const op: OutboxOperation = {
    cid,
    type: params.type,
    endpoint: params.endpoint,
    method: params.method || 'POST',
    payload: { ...params.payload, cid },
    createdAt: new Date().toISOString(),
    attempts: 0,
  };

  const existing = getPendingOps().filter((item) => item.cid !== cid);
  existing.push(op);
  savePendingOps(existing);
  return op;
}

export function removeOutboxOp(cid: string): void {
  const existing = getPendingOps();
  const next = existing.filter((item) => item.cid !== cid);
  savePendingOps(next);
}

export async function flushOutbox(): Promise<{
  flushedCount: number;
  remainingCount: number;
  lastImpact: SessionDebriefImpact | null;
}> {
  const queue = getPendingOps();
  if (queue.length === 0) {
    return { flushedCount: 0, remainingCount: 0, lastImpact: null };
  }

  let flushedCount = 0;
  let lastImpact: SessionDebriefImpact | null = null;
  const remaining: OutboxOperation[] = [];

  for (const op of queue) {
    try {
      const res = await fetch(op.endpoint, {
        method: op.method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(op.payload),
      });

      if (res.ok) {
        flushedCount += 1;
        const data = await res.json().catch(() => null);
        if (data && data.impact) {
          lastImpact = data.impact as SessionDebriefImpact;
        }
      } else if (res.status >= 400 && res.status < 500) {
        // Non-retriable client error: drop after 3 attempts
        if (op.attempts + 1 < 3) {
          remaining.push({ ...op, attempts: op.attempts + 1 });
        }
      } else {
        remaining.push({ ...op, attempts: op.attempts + 1 });
      }
    } catch {
      remaining.push({ ...op, attempts: op.attempts + 1 });
    }
  }

  savePendingOps(remaining);
  return {
    flushedCount,
    remainingCount: remaining.length,
    lastImpact,
  };
}

/**
 * Local storage helpers for persisting in-progress workout sets across accidental page reloads.
 */
export function saveActiveWorkoutDraft(draft: Record<string, unknown> | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (!draft) {
      window.localStorage.removeItem(ACTIVE_DRAFT_STORAGE_KEY);
    } else {
      window.localStorage.setItem(ACTIVE_DRAFT_STORAGE_KEY, JSON.stringify(draft));
    }
  } catch {
    // Ignore storage errors
  }
}

export function loadActiveWorkoutDraft<T = Record<string, unknown>>(): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(ACTIVE_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
