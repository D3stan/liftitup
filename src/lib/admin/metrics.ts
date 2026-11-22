import crypto from 'node:crypto';
import { hasActivePool, query, queryOne } from '@/lib/db/connection';
import { logger, redactSensitiveText } from '@/lib/logger';

interface BufferedMetricBucket {
  bucketStart: string;
  route: string;
  method: string;
  requestCount: number;
  error4xxCount: number;
  error5xxCount: number;
  totalDurationMs: number;
  maxDurationMs: number;
}

interface BufferedAppError {
  id: string;
  route: string;
  method: string;
  status: number;
  errorCode: string | null;
  message: string;
  requestId: string | null;
  createdAt: string;
}

interface MetricsStore {
  buckets: Map<string, BufferedMetricBucket>;
  errors: BufferedAppError[];
  flushTimer: ReturnType<typeof setInterval> | null;
  flushing: Promise<void> | null;
}

const METRICS_STORE_KEY = Symbol.for('liftitup.admin.metricsStore');
const FLUSH_INTERVAL_MS = 30_000;
const MAX_PENDING_ERRORS = 100;

function getMetricsStore(): MetricsStore {
  const g = globalThis as Record<symbol, MetricsStore | undefined>;
  if (!g[METRICS_STORE_KEY]) {
    g[METRICS_STORE_KEY] = {
      buckets: new Map(),
      errors: [],
      flushTimer: null,
      flushing: null,
    };
  }
  return g[METRICS_STORE_KEY]!;
}

function toHourBucketStart(date = new Date()): string {
  const iso = date.toISOString();
  return `${iso.slice(0, 13)}:00:00.000Z`;
}

export function sanitizeErrorMessage(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : 'Internal server error';

  return redactSensitiveText(raw)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

function ensureFlushTimer(): void {
  const store = getMetricsStore();
  if (store.flushTimer || process.env.NODE_ENV === 'test') {
    return;
  }
  const timer = setInterval(() => {
    if (hasActivePool()) {
      void flushRequestMetrics().catch(() => {});
    }
  }, FLUSH_INTERVAL_MS);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
  store.flushTimer = timer;
}

/**
 * Buffers per-route request count, status error counts, and latency in memory.
 * Never performs a DB write on individual HTTP requests.
 */
export function recordRequestMetric(input: {
  route: string;
  method: string;
  status: number;
  durationMs: number;
  requestId?: string;
  errorCode?: string | null;
  errorMessage?: string | null;
}): void {
  const store = getMetricsStore();
  const bucketStart = toHourBucketStart();
  const method = input.method.toUpperCase();
  const key = `${bucketStart}|${input.route}|${method}`;
  const duration = Math.max(0, Number.isFinite(input.durationMs) ? input.durationMs : 0);

  let bucket = store.buckets.get(key);
  if (!bucket) {
    bucket = {
      bucketStart,
      route: input.route,
      method,
      requestCount: 0,
      error4xxCount: 0,
      error5xxCount: 0,
      totalDurationMs: 0,
      maxDurationMs: 0,
    };
    store.buckets.set(key, bucket);
  }

  bucket.requestCount += 1;
  if (input.status >= 400 && input.status < 500) {
    bucket.error4xxCount += 1;
  } else if (input.status >= 500) {
    bucket.error5xxCount += 1;
  }
  bucket.totalDurationMs += duration;
  if (duration > bucket.maxDurationMs) {
    bucket.maxDurationMs = duration;
  }

  if (input.status >= 500) {
    store.errors.push({
      id: `err_${crypto.randomUUID()}`,
      route: input.route,
      method,
      status: input.status,
      errorCode: input.errorCode ?? null,
      message: sanitizeErrorMessage(input.errorMessage ?? `HTTP ${input.status}`),
      requestId: input.requestId ?? null,
      createdAt: new Date().toISOString(),
    });
    if (store.errors.length > MAX_PENDING_ERRORS) {
      store.errors.shift();
    }
  }

  ensureFlushTimer();
}

export function getBufferedMetricsCount(): { buckets: number; errors: number } {
  const store = getMetricsStore();
  return {
    buckets: store.buckets.size,
    errors: store.errors.length,
  };
}

export function resetMetricsBufferForTests(): void {
  const store = getMetricsStore();
  store.buckets.clear();
  store.errors.length = 0;
  if (store.flushTimer) {
    clearInterval(store.flushTimer);
    store.flushTimer = null;
  }
}

/**
 * Flushes all buffered in-memory request metric buckets and recent 5xx errors
 * to Postgres. Safe to call periodically or on-demand from System Health / tests.
 */
export async function flushRequestMetrics(): Promise<{
  flushedBuckets: number;
  flushedErrors: number;
}> {
  if (!hasActivePool()) {
    return { flushedBuckets: 0, flushedErrors: 0 };
  }

  const store = getMetricsStore();
  if (store.flushing) {
    await store.flushing;
  }

  const bucketsToFlush = Array.from(store.buckets.values());
  const errorsToFlush = store.errors.splice(0, store.errors.length);
  store.buckets.clear();

  if (bucketsToFlush.length === 0 && errorsToFlush.length === 0) {
    return { flushedBuckets: 0, flushedErrors: 0 };
  }

  const run = async () => {
    const now = new Date().toISOString();
    try {
      for (const b of bucketsToFlush) {
        await query(
          `INSERT INTO request_metric_buckets (
             bucket_start, route, method, request_count,
             error_4xx_count, error_5xx_count,
             total_duration_ms, max_duration_ms, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (bucket_start, route, method) DO UPDATE SET
             request_count = request_metric_buckets.request_count + EXCLUDED.request_count,
             error_4xx_count = request_metric_buckets.error_4xx_count + EXCLUDED.error_4xx_count,
             error_5xx_count = request_metric_buckets.error_5xx_count + EXCLUDED.error_5xx_count,
             total_duration_ms = request_metric_buckets.total_duration_ms + EXCLUDED.total_duration_ms,
             max_duration_ms = GREATEST(request_metric_buckets.max_duration_ms, EXCLUDED.max_duration_ms),
             updated_at = EXCLUDED.updated_at`,
          [
            b.bucketStart,
            b.route,
            b.method,
            b.requestCount,
            b.error4xxCount,
            b.error5xxCount,
            b.totalDurationMs,
            b.maxDurationMs,
            now,
          ],
        );
      }

      for (const e of errorsToFlush) {
        await query(
          `INSERT INTO app_errors (
             id, route, method, status, error_code, message, request_id, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            e.id,
            e.route,
            e.method,
            e.status,
            e.errorCode,
            e.message,
            e.requestId,
            e.createdAt,
          ],
        );
      }
    } catch (err) {
      // Restore un-flushed buckets/errors so they are not lost on transient failures
      for (const b of bucketsToFlush) {
        const key = `${b.bucketStart}|${b.route}|${b.method}`;
        const existing = store.buckets.get(key);
        if (existing) {
          existing.requestCount += b.requestCount;
          existing.error4xxCount += b.error4xxCount;
          existing.error5xxCount += b.error5xxCount;
          existing.totalDurationMs += b.totalDurationMs;
          existing.maxDurationMs = Math.max(existing.maxDurationMs, b.maxDurationMs);
        } else {
          store.buckets.set(key, b);
        }
      }
      store.errors.unshift(...errorsToFlush);
      if (store.errors.length > MAX_PENDING_ERRORS) {
        store.errors.length = MAX_PENDING_ERRORS;
      }
      logger.warn('failed to flush request metrics buffer', { err });
    }
  };

  store.flushing = run().finally(() => {
    store.flushing = null;
  });
  await store.flushing;

  return {
    flushedBuckets: bucketsToFlush.length,
    flushedErrors: errorsToFlush.length,
  };
}

export async function getSystemState<T>(
  key: string,
): Promise<{ value: T; updatedAt: string } | null> {
  const row = await queryOne<{ value_json: string; updated_at: string }>(
    'SELECT value_json, updated_at FROM system_state WHERE key = $1',
    [key],
  );
  if (!row) return null;
  try {
    return {
      value: JSON.parse(row.value_json) as T,
      updatedAt: row.updated_at,
    };
  } catch {
    return null;
  }
}

export async function setSystemState(key: string, value: unknown): Promise<void> {
  const now = new Date().toISOString();
  await query(
    `INSERT INTO system_state (key, value_json, updated_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET
       value_json = EXCLUDED.value_json,
       updated_at = EXCLUDED.updated_at`,
    [key, JSON.stringify(value), now],
  );
}

export interface GuestPurgeState {
  lastRunAt: string | null;
  lastPurgedCount: number;
  totalPurgedCount: number;
}

export async function recordGuestPurgeRun(purgedCount: number): Promise<void> {
  const now = new Date().toISOString();
  const prev = await getSystemState<GuestPurgeState>('guest_purge');
  const next: GuestPurgeState = {
    lastRunAt: now,
    lastPurgedCount: purgedCount,
    totalPurgedCount: (prev?.value.totalPurgedCount ?? 0) + purgedCount,
  };
  await setSystemState('guest_purge', next);
}

export interface AppleHealthIngestState {
  receivedCount: number;
  rejectedCount: number;
  lastReceivedAt: string | null;
  lastRejectedAt: string | null;
}

export async function recordAppleHealthIngestOutcome(
  outcome: 'received' | 'rejected',
): Promise<void> {
  try {
    const now = new Date().toISOString();
    const prev = await getSystemState<AppleHealthIngestState>(
      'apple_health_ingest',
    );
    const current = prev?.value ?? {
      receivedCount: 0,
      rejectedCount: 0,
      lastReceivedAt: null,
      lastRejectedAt: null,
    };
    const next: AppleHealthIngestState = {
      receivedCount:
        current.receivedCount + (outcome === 'received' ? 1 : 0),
      rejectedCount:
        current.rejectedCount + (outcome === 'rejected' ? 1 : 0),
      lastReceivedAt: outcome === 'received' ? now : current.lastReceivedAt,
      lastRejectedAt: outcome === 'rejected' ? now : current.lastRejectedAt,
    };
    await setSystemState('apple_health_ingest', next);
  } catch (err) {
    logger.warn('failed to update apple health ingest counters', { err });
  }
}
