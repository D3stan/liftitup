import crypto from 'node:crypto';
import { query } from '@/lib/db/connection';
import { logger } from '@/lib/logger';

export type AuditSource = 'admin_web' | 'cli' | 'mcp';

export interface AdminEventRecord {
  id: string;
  userId: string;
  eventType: string;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

export interface AuditLogRecord {
  id: string;
  actorUserId: string | null;
  actorLabel: string;
  source: AuditSource;
  action: string;
  targetUserId: string | null;
  reason: string | null;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

export interface AdminActor {
  actorUserId?: string | null;
  actorLabel: string;
  source: AuditSource;
}

const ACTIVITY_THROTTLE_MS = 15 * 60 * 1000;
const ACTIVITY_CACHE_KEY = Symbol.for('liftitup.admin.activityThrottleMap');

function getActivityThrottleMap(): Map<string, number> {
  const g = globalThis as Record<symbol, Map<string, number> | undefined>;
  if (!g[ACTIVITY_CACHE_KEY]) {
    g[ACTIVITY_CACHE_KEY] = new Map<string, number>();
  }
  return g[ACTIVITY_CACHE_KEY]!;
}

export function resetActivityThrottleForTests(): void {
  getActivityThrottleMap().clear();
}

function parseJsonObject(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

export async function recordEvent(input: {
  userId: string;
  eventType: string;
  detail?: Record<string, unknown> | null;
  createdAt?: string;
}): Promise<AdminEventRecord> {
  const id = `evt_${crypto.randomUUID()}`;
  const createdAt = input.createdAt ?? new Date().toISOString();
  const detailJson = input.detail ? JSON.stringify(input.detail) : null;

  await query(
    `INSERT INTO events (id, user_id, event_type, detail_json, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, input.userId, input.eventType, detailJson, createdAt],
  );

  return {
    id,
    userId: input.userId,
    eventType: input.eventType,
    detail: input.detail ?? null,
    createdAt,
  };
}

/**
 * Best-effort event recorder used on user-facing routes so telemetry
 * never aborts or breaks user requests.
 */
export async function safeRecordEvent(input: {
  userId: string;
  eventType: string;
  detail?: Record<string, unknown> | null;
  createdAt?: string;
}): Promise<void> {
  try {
    await recordEvent(input);
  } catch (err) {
    logger.warn('failed to record analytics event', {
      eventType: input.eventType,
      err,
    });
  }
}

/**
 * Records throttled `app_active` (cookie session) or `api_key_active` (API key)
 * events at most once every 15 minutes per (user, authMethod).
 */
export async function recordThrottledActivityEvent(
  userId: string,
  authMethod: 'session' | 'api_key',
): Promise<void> {
  const map = getActivityThrottleMap();
  const key = `${userId}:${authMethod}`;
  const now = Date.now();
  const lastMs = map.get(key);
  if (lastMs !== undefined && now - lastMs < ACTIVITY_THROTTLE_MS) {
    return;
  }
  if (map.size > 10_000) {
    map.clear();
  }
  map.set(key, now);

  await safeRecordEvent({
    userId,
    eventType: authMethod === 'api_key' ? 'api_key_active' : 'app_active',
    detail: { authMethod },
  });
}

export async function listEventsForUser(
  userId: string,
  limit = 50,
): Promise<AdminEventRecord[]> {
  const safeLimit = Math.max(1, Math.min(200, Math.round(limit)));
  const res = await query<{
    id: string;
    user_id: string;
    event_type: string;
    detail_json: string | null;
    created_at: string;
  }>(
    `SELECT id, user_id, event_type, detail_json, created_at
     FROM events
     WHERE user_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT $2`,
    [userId, safeLimit],
  );

  return res.rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    eventType: r.event_type,
    detail: parseJsonObject(r.detail_json),
    createdAt: r.created_at,
  }));
}

export async function recordAuditLog(input: {
  actorUserId?: string | null;
  actorLabel: string;
  source: AuditSource;
  action: string;
  targetUserId?: string | null;
  reason?: string | null;
  detail?: Record<string, unknown> | null;
  createdAt?: string;
}): Promise<AuditLogRecord> {
  const id = `aud_${crypto.randomUUID()}`;
  const createdAt = input.createdAt ?? new Date().toISOString();
  const detailJson = input.detail ? JSON.stringify(input.detail) : null;
  const reason = input.reason ? input.reason.trim() : null;

  await query(
    `INSERT INTO audit_log (
       id, actor_user_id, actor_label, source, action,
       target_user_id, reason, detail_json, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      input.actorUserId ?? null,
      input.actorLabel,
      input.source,
      input.action,
      input.targetUserId ?? null,
      reason,
      detailJson,
      createdAt,
    ],
  );

  return {
    id,
    actorUserId: input.actorUserId ?? null,
    actorLabel: input.actorLabel,
    source: input.source,
    action: input.action,
    targetUserId: input.targetUserId ?? null,
    reason,
    detail: input.detail ?? null,
    createdAt,
  };
}

export async function listAuditLog(options?: {
  limit?: number;
  targetUserId?: string;
  action?: string;
}): Promise<AuditLogRecord[]> {
  const safeLimit = Math.max(1, Math.min(200, Math.round(options?.limit ?? 100)));
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (options?.targetUserId) {
    clauses.push(`target_user_id = $${params.length + 1}`);
    params.push(options.targetUserId);
  }
  if (options?.action) {
    clauses.push(`action = $${params.length + 1}`);
    params.push(options.action);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  params.push(safeLimit);

  const res = await query<{
    id: string;
    actor_user_id: string | null;
    actor_label: string;
    source: AuditSource;
    action: string;
    target_user_id: string | null;
    reason: string | null;
    detail_json: string | null;
    created_at: string;
  }>(
    `SELECT id, actor_user_id, actor_label, source, action,
            target_user_id, reason, detail_json, created_at
     FROM audit_log
     ${where}
     ORDER BY created_at DESC, id DESC
     LIMIT $${params.length}`,
    params,
  );

  return res.rows.map((r) => ({
    id: r.id,
    actorUserId: r.actor_user_id,
    actorLabel: r.actor_label,
    source: r.source,
    action: r.action,
    targetUserId: r.target_user_id,
    reason: r.reason,
    detail: parseJsonObject(r.detail_json),
    createdAt: r.created_at,
  }));
}
