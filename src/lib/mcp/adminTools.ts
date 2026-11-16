import type { UserProfile } from '@/types/domain';
import {
  adjustUserPhotoQuota,
  adminDeleteUser,
  adminExportUserData,
  adminPurgeExpiredGuests,
  adminRefreshDailySnapshot,
  forceLogoutUser,
  getAdminAdoptionReport,
  getAdminOverview,
  getAdminStorageReport,
  getAdminSystemHealth,
  getAdminUserDetail,
  getLatestDailySnapshot,
  getLiveCatalogUsage,
  getSystemState,
  listAuditLog,
  listSnapshotTrends,
  recordAuditLog,
  resetUserPassword,
  revokeUserApiKey,
  setUserDisabledState,
  type AdminActor,
  type AppleHealthIngestState,
  type GuestPurgeState,
} from '@/lib/admin';
import { query, queryOne } from '@/lib/db/connection';
import { getUserById, getUserByUsername } from '@/lib/db/users';
import {
  ANNOTATIONS_DESTRUCTIVE,
  ANNOTATIONS_READ_ONLY,
  ANNOTATIONS_READ_SIDE_EFFECT,
  ANNOTATIONS_WRITE_IDEMPOTENT,
} from './annotations';
import { requireTwoStepConfirmation } from './confirmations';
import {
  listReportingViewsMetadata,
  MAX_REPORTING_VIEW_ROWS,
  queryReportingView,
  REPORTING_VIEW_NAMES,
} from './reportingViews';
import {
  wrapToolResult,
  type McpToolDefinition,
  type McpToolResult,
  type ResolvedMcpCaller,
} from './types';

export const ADMIN_MCP_TOOLS_DEFINITIONS: McpToolDefinition[] = [
  {
    name: 'admin_get_overview',
    description:
      'Admin read: returns instance overview metrics (user counts, active users DAU/WAU/MAU, app vs API-key activity, guest conversion, retention cohorts, churn watch, daily volume, and DB storage summary). Contains no user workout notes, body weights, or photos.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    annotations: ANNOTATIONS_READ_ONLY,
  },
  {
    name: 'admin_get_storage',
    description:
      'Admin read: returns database size, per-table sizes, per-user storage/photo quota usage, near-quota users, and guest footprint.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    annotations: ANNOTATIONS_READ_ONLY,
  },
  {
    name: 'admin_get_user_detail',
    description:
      'Admin read: returns privacy-safe account, training streak/adherence, logging behaviour, feature usage, and event timeline for one user (no notes, body weights, photos, or secrets). Audited.',
    inputSchema: {
      type: 'object',
      properties: {
        targetUserId: { type: 'string' },
        username: { type: 'string' },
      },
      additionalProperties: false,
    },
    annotations: ANNOTATIONS_READ_SIDE_EFFECT,
  },
  {
    name: 'admin_get_adoption',
    description:
      'Admin read: returns feature adoption rates, theme/clock/focus distributions, exercise catalog usage, and split shapes across registered users.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    annotations: ANNOTATIONS_READ_ONLY,
  },
  {
    name: 'admin_get_health',
    description:
      'Admin read: returns HTTP route request/error/latency metrics, recent 5xx errors, DB pool/slow-query health, Apple Health ingest stats, and guest purge status.',
    inputSchema: {
      type: 'object',
      properties: {
        windowHours: {
          type: 'integer',
          minimum: 1,
          maximum: 720,
          description: 'Lookback window in hours (default 24).',
        },
      },
      additionalProperties: false,
    },
    annotations: ANNOTATIONS_READ_ONLY,
  },
  {
    name: 'admin_get_audit_log',
    description:
      'Admin read: lists immutable audit_log entries, optionally filtered by targetUserId or action.',
    inputSchema: {
      type: 'object',
      properties: {
        targetUserId: { type: 'string' },
        action: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 200 },
      },
      additionalProperties: false,
    },
    annotations: ANNOTATIONS_READ_ONLY,
  },
  {
    name: 'admin_get_events_timeline',
    description:
      'Admin read: lists sanitized telemetry events across the instance or for one user, filterable by targetUserId, eventType, and ISO timestamp range.',
    inputSchema: {
      type: 'object',
      properties: {
        targetUserId: { type: 'string' },
        eventType: { type: 'string' },
        from: { type: 'string', description: 'Inclusive ISO timestamp or YYYY-MM-DD' },
        to: { type: 'string', description: 'Inclusive ISO timestamp or YYYY-MM-DD' },
        limit: { type: 'integer', minimum: 1, maximum: 200 },
      },
      additionalProperties: false,
    },
    annotations: ANNOTATIONS_READ_ONLY,
  },
  {
    name: 'admin_list_snapshots',
    description:
      'Admin read: lists daily_snapshots trends over time (DB size, user counts, DAU/WAU/MAU) and optionally includes the latest full snapshot payload.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 365 },
        includeLatestFull: { type: 'boolean' },
      },
      additionalProperties: false,
    },
    annotations: ANNOTATIONS_READ_ONLY,
  },
  {
    name: 'admin_disable_user',
    description:
      'Admin action: disables a user account and revokes all active cookie sessions (API key calls are also rejected while disabled). Requires two-step confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        targetUserId: { type: 'string' },
        reason: { type: 'string' },
        confirmationToken: { type: 'string' },
      },
      required: ['targetUserId'],
      additionalProperties: false,
    },
    annotations: ANNOTATIONS_DESTRUCTIVE,
  },
  {
    name: 'admin_enable_user',
    description: 'Admin action: re-enables a previously disabled user account. Audited.',
    inputSchema: {
      type: 'object',
      properties: {
        targetUserId: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['targetUserId'],
      additionalProperties: false,
    },
    annotations: ANNOTATIONS_WRITE_IDEMPOTENT,
  },
  {
    name: 'admin_force_logout',
    description:
      'Admin action: revokes all active browser session cookies for a user. Audited.',
    inputSchema: {
      type: 'object',
      properties: {
        targetUserId: { type: 'string' },
      },
      required: ['targetUserId'],
      additionalProperties: false,
    },
    annotations: ANNOTATIONS_DESTRUCTIVE,
  },
  {
    name: 'admin_revoke_api_key',
    description:
      'Admin action: revokes a user personal API key (used by both MCP and Apple Health Shortcut). Requires two-step confirmation. Audited.',
    inputSchema: {
      type: 'object',
      properties: {
        targetUserId: { type: 'string' },
        confirmationToken: { type: 'string' },
      },
      required: ['targetUserId'],
      additionalProperties: false,
    },
    annotations: ANNOTATIONS_DESTRUCTIVE,
  },
  {
    name: 'admin_reset_password',
    description:
      'Admin action: resets a non-guest user password via two-step confirmation, revoking active sessions and returning a one-time temporary password. WARNING: the temporary password appears in this tool result, enters the agent conversation, and is sent to your AI provider. For resets that must not pass through an agent, run `node scripts/reset-password.mjs <username>` in the container terminal instead.',
    inputSchema: {
      type: 'object',
      properties: {
        targetUserId: { type: 'string' },
        username: { type: 'string' },
        reason: { type: 'string' },
        confirmationToken: { type: 'string' },
      },
      additionalProperties: false,
    },
    annotations: ANNOTATIONS_DESTRUCTIVE,
  },
  {
    name: 'admin_adjust_photo_quota',
    description:
      'Admin action: overrides or resets (null -> default 300) a user progress-photo quota. Audited.',
    inputSchema: {
      type: 'object',
      properties: {
        targetUserId: { type: 'string' },
        photoQuota: { type: ['integer', 'null'], minimum: 0, maximum: 10000 },
      },
      required: ['targetUserId', 'photoQuota'],
      additionalProperties: false,
    },
    annotations: ANNOTATIONS_WRITE_IDEMPOTENT,
  },
  {
    name: 'admin_delete_user',
    description:
      'Admin action: permanently deletes a user account and all owned data in explicit child-to-parent order (preserving audit_log and events). Requires two-step confirmation. Audited.',
    inputSchema: {
      type: 'object',
      properties: {
        targetUserId: { type: 'string' },
        confirmationToken: { type: 'string' },
      },
      required: ['targetUserId'],
      additionalProperties: false,
    },
    annotations: ANNOTATIONS_DESTRUCTIVE,
  },
  {
    name: 'admin_export_user_data',
    description:
      'Admin exception action: exports one user full JSON data (excluding progress photos and admin tables). Requires a typed reason (3..500 chars) and records both an audit_log entry and a user event.',
    inputSchema: {
      type: 'object',
      properties: {
        targetUserId: { type: 'string' },
        reason: { type: 'string', minLength: 3, maxLength: 500 },
      },
      required: ['targetUserId', 'reason'],
      additionalProperties: false,
    },
    annotations: ANNOTATIONS_READ_SIDE_EFFECT,
  },
  {
    name: 'admin_query_reporting_view',
    description:
      `Read-only structured query tool over fixed, privacy-safe SQL reporting views (${REPORTING_VIEW_NAMES.join(', ')}). Exposes only counts, sizes, timestamps, settings flags, and identifiers—never password hashes, API-key hashes, session tokens, photo blobs, notes, or body weights. Enforces strict column allowlists, read-only execution, 3s statement timeout, and row limit <= ${MAX_REPORTING_VIEW_ROWS}. Never accepts raw SQL. Pass action="list_views" to inspect view schemas.`,
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['query', 'list_views'] },
        view: { type: 'string', enum: [...REPORTING_VIEW_NAMES] },
        columns: { type: 'array', items: { type: 'string' }, minItems: 1 },
        filters: {
          type: 'array',
          maxItems: 10,
          items: {
            type: 'object',
            properties: {
              column: { type: 'string' },
              op: { type: 'string', enum: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like'] },
              value: { type: ['string', 'number', 'boolean', 'null'] },
            },
            required: ['column', 'op', 'value'],
            additionalProperties: false,
          },
        },
        orderBy: {
          type: 'object',
          properties: {
            column: { type: 'string' },
            direction: { type: 'string', enum: ['asc', 'desc'] },
          },
          required: ['column'],
          additionalProperties: false,
        },
        limit: { type: 'integer', minimum: 1, maximum: MAX_REPORTING_VIEW_ROWS },
        offset: { type: 'integer', minimum: 0, maximum: 10000 },
      },
      additionalProperties: false,
    },
    annotations: ANNOTATIONS_READ_ONLY,
  },
  {
    name: 'admin_get_digest',
    description:
      'Returns a compact period health-and-usage digest with period-over-period deltas (signups, active users, workout sessions, sets, photos, Apple Health ingest, route errors, DB bytes), ideal for scheduled checks.',
    inputSchema: {
      type: 'object',
      properties: {
        periodDays: {
          type: 'integer',
          minimum: 1,
          maximum: 90,
          description: 'Comparison window length in days (default 7).',
        },
      },
      additionalProperties: false,
    },
    annotations: ANNOTATIONS_READ_ONLY,
  },
  {
    name: 'admin_get_anomaly_hints',
    description:
      'Checks instance health and returns structured anomaly hints for: users near photo quota, route error spikes, Apple Health payload rejections, stale/missing guest purge, and unusual DB storage growth.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    annotations: ANNOTATIONS_READ_ONLY,
  },
  {
    name: 'admin_get_catalog_suggestions',
    description:
      'Read-only catalog insights: returns common user-created custom exercise candidates and unused built-in catalog exercises as structured data fields (never embedded in prose).',
    inputSchema: {
      type: 'object',
      properties: {
        minUsers: {
          type: 'integer',
          minimum: 1,
          maximum: 1000,
          description: 'Minimum distinct registered users for custom candidates (default 1).',
        },
      },
      additionalProperties: false,
    },
    annotations: ANNOTATIONS_READ_ONLY,
  },
  {
    name: 'admin_run_maintenance',
    description:
      'Runs admin maintenance tasks on demand: daily_snapshot, guest_purge, or both. Audited.',
    inputSchema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          enum: ['daily_snapshot', 'guest_purge', 'both'],
        },
      },
      required: ['task'],
      additionalProperties: false,
    },
    annotations: ANNOTATIONS_WRITE_IDEMPOTENT,
  },
];

function buildMcpAdminActor(caller: ResolvedMcpCaller, mcpTool: string): AdminActor {
  return {
    actorUserId: caller.user.id,
    actorLabel: caller.user.username,
    source: 'mcp',
    auditDetail: {
      apiKeyId: caller.apiKeyId,
      apiKeyPrefix: caller.apiKeyPrefix,
      mcpTool,
    },
  };
}

async function auditAdminMcpRead(
  caller: ResolvedMcpCaller,
  action: string,
  extra?: Record<string, unknown>,
  targetUserId?: string | null,
): Promise<void> {
  await recordAuditLog({
    actorUserId: caller.user.id,
    actorLabel: caller.user.username,
    source: 'mcp',
    action,
    targetUserId: targetUserId ?? null,
    detail: {
      apiKeyId: caller.apiKeyId,
      apiKeyPrefix: caller.apiKeyPrefix,
      ...(extra ?? {}),
    },
  });
}

async function resolveTargetUser(args: Record<string, unknown>): Promise<UserProfile | null> {
  const id = typeof args.targetUserId === 'string' ? args.targetUserId.trim() : '';
  if (id) {
    return await getUserById(id);
  }
  const username = typeof args.username === 'string' ? args.username.trim() : '';
  if (username) {
    return await getUserByUsername(username);
  }
  return null;
}

async function computeAdminDigest(periodDays: number) {
  const nowMs = Date.now();
  const currentStartIso = new Date(nowMs - periodDays * 86_400_000).toISOString();
  const prevStartIso = new Date(nowMs - 2 * periodDays * 86_400_000).toISOString();
  const currentStartDate = currentStartIso.slice(0, 10);
  const prevStartDate = prevStartIso.slice(0, 10);
  const nowIso = new Date(nowMs).toISOString();
  const todayDate = nowIso.slice(0, 10);

  const [
    userCounts,
    signupsCounts,
    activeCounts,
    sessionCounts,
    setCounts,
    photoCounts,
    ahCounts,
    reqCounts,
    ingestState,
    latestSnapshot,
  ] = await Promise.all([
    queryOne<{
      total: number;
      registered: number;
      guest: number;
      disabled: number;
    }>(
      `SELECT
         COUNT(*)::int AS total,
         COALESCE(SUM(CASE WHEN is_guest = 0 THEN 1 ELSE 0 END), 0)::int AS registered,
         COALESCE(SUM(CASE WHEN is_guest = 1 THEN 1 ELSE 0 END), 0)::int AS guest,
         COALESCE(SUM(CASE WHEN is_disabled = 1 THEN 1 ELSE 0 END), 0)::int AS disabled
       FROM users`,
    ),
    queryOne<{ curr: number; prev: number }>(
      `SELECT
         COALESCE(SUM(CASE WHEN created_at >= $1 THEN 1 ELSE 0 END), 0)::int AS curr,
         COALESCE(SUM(CASE WHEN created_at >= $2 AND created_at < $1 THEN 1 ELSE 0 END), 0)::int AS prev
       FROM users
       WHERE is_guest = 0 AND created_at >= $2`,
      [currentStartIso, prevStartIso],
    ),
    queryOne<{ curr: number; prev: number }>(
      `SELECT
         COUNT(DISTINCT CASE WHEN created_at >= $1 THEN user_id END)::int AS curr,
         COUNT(DISTINCT CASE WHEN created_at >= $2 AND created_at < $1 THEN user_id END)::int AS prev
       FROM events
       WHERE event_type IN ('app_active', 'api_key_active') AND created_at >= $2`,
      [currentStartIso, prevStartIso],
    ),
    queryOne<{ curr: number; prev: number }>(
      `SELECT
         COALESCE(SUM(CASE WHEN session_date >= $1 THEN 1 ELSE 0 END), 0)::int AS curr,
         COALESCE(SUM(CASE WHEN session_date >= $2 AND session_date < $1 THEN 1 ELSE 0 END), 0)::int AS prev
       FROM workout_sessions
       WHERE session_date >= $2`,
      [currentStartDate, prevStartDate],
    ),
    queryOne<{ curr: number; prev: number }>(
      `SELECT
         COALESCE(SUM(CASE WHEN ws.session_date >= $1 THEN 1 ELSE 0 END), 0)::int AS curr,
         COALESCE(SUM(CASE WHEN ws.session_date >= $2 AND ws.session_date < $1 THEN 1 ELSE 0 END), 0)::int AS prev
       FROM workout_sets wset
       JOIN workout_exercises we ON we.id = wset.workout_exercise_id
       JOIN workout_sessions ws ON ws.id = we.session_id
       WHERE ws.session_date >= $2 AND wset.is_completed = 1`,
      [currentStartDate, prevStartDate],
    ),
    queryOne<{
      curr: number;
      prev: number;
      total_photos: number;
      total_bytes: string | number;
    }>(
      `SELECT
         COALESCE(SUM(CASE WHEN created_at >= $1 THEN 1 ELSE 0 END), 0)::int AS curr,
         COALESCE(SUM(CASE WHEN created_at >= $2 AND created_at < $1 THEN 1 ELSE 0 END), 0)::int AS prev,
         COUNT(*)::int AS total_photos,
         COALESCE(SUM(byte_size + thumb_byte_size), 0)::bigint AS total_bytes
       FROM progress_photos`,
      [currentStartIso, prevStartIso],
    ),
    queryOne<{ curr: number; prev: number }>(
      `SELECT
         COALESCE(SUM(CASE WHEN created_at >= $1 THEN 1 ELSE 0 END), 0)::int AS curr,
         COALESCE(SUM(CASE WHEN created_at >= $2 AND created_at < $1 THEN 1 ELSE 0 END), 0)::int AS prev
       FROM apple_health_workouts
       WHERE created_at >= $2`,
      [currentStartIso, prevStartIso],
    ),
    queryOne<{
      reqs: number;
      e4: number;
      e5: number;
    }>(
      `SELECT
         COALESCE(SUM(request_count), 0)::int AS reqs,
         COALESCE(SUM(error_4xx_count), 0)::int AS e4,
         COALESCE(SUM(error_5xx_count), 0)::int AS e5
       FROM request_metric_buckets
       WHERE bucket_start >= $1`,
      [currentStartIso],
    ),
    getSystemState<AppleHealthIngestState>('apple_health_ingest'),
    getLatestDailySnapshot(),
  ]);

  const newSignupsCurr = Number(signupsCounts?.curr ?? 0);
  const newSignupsPrev = Number(signupsCounts?.prev ?? 0);
  const activeCurr = Number(activeCounts?.curr ?? 0);
  const activePrev = Number(activeCounts?.prev ?? 0);
  const sessCurr = Number(sessionCounts?.curr ?? 0);
  const sessPrev = Number(sessionCounts?.prev ?? 0);
  const setsCurr = Number(setCounts?.curr ?? 0);
  const setsPrev = Number(setCounts?.prev ?? 0);
  const photosCurr = Number(photoCounts?.curr ?? 0);
  const photosPrev = Number(photoCounts?.prev ?? 0);
  const ahCurr = Number(ahCounts?.curr ?? 0);
  const ahPrev = Number(ahCounts?.prev ?? 0);
  const totalReqs = Number(reqCounts?.reqs ?? 0);
  const total4xx = Number(reqCounts?.e4 ?? 0);
  const total5xx = Number(reqCounts?.e5 ?? 0);

  return {
    generatedAt: nowIso,
    periodDays,
    currentWindow: { start: currentStartIso, end: nowIso, startDate: currentStartDate, endDate: todayDate },
    previousWindow: { start: prevStartIso, end: currentStartIso, startDate: prevStartDate, endDate: currentStartDate },
    users: {
      total: Number(userCounts?.total ?? 0),
      registered: Number(userCounts?.registered ?? 0),
      guest: Number(userCounts?.guest ?? 0),
      disabled: Number(userCounts?.disabled ?? 0),
      newSignupsCurrent: newSignupsCurr,
      newSignupsPrevious: newSignupsPrev,
      newSignupsDelta: newSignupsCurr - newSignupsPrev,
      activeUsersCurrent: activeCurr,
      activeUsersPrevious: activePrev,
      activeUsersDelta: activeCurr - activePrev,
    },
    workouts: {
      sessionsCurrent: sessCurr,
      sessionsPrevious: sessPrev,
      sessionsDelta: sessCurr - sessPrev,
      setsCurrent: setsCurr,
      setsPrevious: setsPrev,
      setsDelta: setsCurr - setsPrev,
    },
    photos: {
      uploadedCurrent: photosCurr,
      uploadedPrevious: photosPrev,
      uploadedDelta: photosCurr - photosPrev,
      totalPhotos: Number(photoCounts?.total_photos ?? 0),
      totalPhotoBytes: Number(photoCounts?.total_bytes ?? 0),
    },
    appleHealth: {
      workoutsIngestedCurrent: ahCurr,
      workoutsIngestedPrevious: ahPrev,
      workoutsIngestedDelta: ahCurr - ahPrev,
      ingestReceivedTotal: ingestState?.value.receivedCount ?? 0,
      ingestRejectedTotal: ingestState?.value.rejectedCount ?? 0,
    },
    health: {
      requestsInWindow: totalReqs,
      error4xxInWindow: total4xx,
      error5xxInWindow: total5xx,
      errorRatePct:
        totalReqs > 0
          ? Math.round(((total4xx + total5xx) / totalReqs) * 1000) / 10
          : 0,
    },
    storage: {
      latestSnapshotDate: latestSnapshot?.snapshotDate ?? null,
      totalDbBytes: latestSnapshot?.totalDbBytes ?? null,
    },
  };
}

interface AnomalyHint {
  category:
    | 'photo_quota'
    | 'route_errors'
    | 'apple_health_rejections'
    | 'guest_purge'
    | 'storage_growth';
  severity: 'info' | 'warning' | 'critical';
  code: string;
  summary: string;
  metrics: Record<string, unknown>;
}

async function computeAnomalyHints() {
  const [storage, health, trends, purgeState, photoRowsRes] = await Promise.all([
    getAdminStorageReport(),
    getAdminSystemHealth(24),
    listSnapshotTrends(14),
    getSystemState<GuestPurgeState>('guest_purge'),
    query<{
      user_id: string;
      username: string;
      effective_quota: number;
      photo_count: number;
    }>(
      `SELECT user_id, username, effective_quota, photo_count
       FROM v_admin_photo_storage
       WHERE is_guest = 0 AND photo_count > 0`,
    ),
  ]);

  const hints: AnomalyHint[] = [];

  // 1. Users near photo quota (computed live from v_admin_photo_storage; never embed usernames in prose!)
  const nearQuotaEntries = photoRowsRes.rows
    .map((r) => {
      const count = Number(r.photo_count);
      const quota = Number(r.effective_quota);
      const quotaUsedPct =
        quota === 0 ? 100 : Math.round((count / quota) * 1000) / 10;
      return {
        userId: r.user_id,
        username: r.username,
        count,
        quota,
        quotaUsedPct,
      };
    })
    .filter((entry) => entry.quotaUsedPct >= 80)
    .sort((a, b) => b.quotaUsedPct - a.quotaUsedPct || b.count - a.count);

  for (const entry of nearQuotaEntries) {
    hints.push({
      category: 'photo_quota',
      severity: entry.quotaUsedPct >= 95 ? 'critical' : 'warning',
      code:
        entry.quotaUsedPct >= 100
          ? 'PHOTO_QUOTA_EXHAUSTED'
          : 'PHOTO_QUOTA_NEAR_LIMIT',
      summary: 'A user account is near or at its progress photo quota.',
      metrics: {
        userId: entry.userId,
        username: entry.username,
        count: entry.count,
        quota: entry.quota,
        quotaUsedPct: entry.quotaUsedPct,
      },
    });
  }

  // 2. Route error spikes
  for (const r of health.requests.routes) {
    const has5xx = r.error5xxCount > 0;
    const high4xxSpike = r.requestCount >= 5 && r.errorRatePct >= 20;
    if (has5xx || high4xxSpike) {
      hints.push({
        category: 'route_errors',
        severity: has5xx ? 'critical' : 'warning',
        code: has5xx ? 'ROUTE_5XX_ERRORS' : 'ROUTE_HIGH_ERROR_RATE',
        summary: 'Elevated HTTP error count or rate detected on an API route.',
        metrics: {
          route: r.route,
          method: r.method,
          requestCount: r.requestCount,
          error4xxCount: r.error4xxCount,
          error5xxCount: r.error5xxCount,
          errorRatePct: r.errorRatePct,
        },
      });
    }
  }

  // 3. Apple Health payload rejections
  const totalIngest = health.ingest.receivedCount + health.ingest.rejectedCount;
  if (health.ingest.rejectedCount > 0) {
    const rejectionRatePct =
      totalIngest > 0
        ? Math.round((health.ingest.rejectedCount / totalIngest) * 1000) / 10
        : 0;
    const isHigh = health.ingest.rejectedCount >= 3 || rejectionRatePct >= 20;
    if (isHigh || health.ingest.lastRejectedAt) {
      hints.push({
        category: 'apple_health_rejections',
        severity: isHigh ? 'warning' : 'info',
        code: 'APPLE_HEALTH_PAYLOAD_REJECTIONS',
        summary: 'Rejected Apple Health webhook payloads have been recorded.',
        metrics: {
          receivedCount: health.ingest.receivedCount,
          rejectedCount: health.ingest.rejectedCount,
          rejectionRatePct,
          lastReceivedAt: health.ingest.lastReceivedAt,
          lastRejectedAt: health.ingest.lastRejectedAt,
        },
      });
    }
  }

  // 4. Stale / missing guest purge
  const expiredCount = health.guestPurge.currentlyExpiredCount;
  const lastRunAt = purgeState?.value.lastRunAt ?? health.guestPurge.lastRunAt;
  const lastRunMs = lastRunAt ? Date.parse(lastRunAt) : Number.NaN;
  const stalePurge =
    !Number.isFinite(lastRunMs) || Date.now() - lastRunMs > 2 * 3600_000;
  if (expiredCount > 0 && stalePurge) {
    hints.push({
      category: 'guest_purge',
      severity: expiredCount >= 20 ? 'warning' : 'info',
      code: lastRunAt ? 'GUEST_PURGE_STALE' : 'GUEST_PURGE_NEVER_RUN',
      summary: 'Expired guest sandbox accounts are awaiting purge.',
      metrics: {
        currentlyExpiredCount: expiredCount,
        lastRunAt: lastRunAt ?? null,
        reclaimableBytes: storage.guestFootprint.reclaimableBytes,
      },
    });
  }

  // 5. Unusual DB storage growth across latest snapshots
  if (trends.length >= 2) {
    const prev = trends[trends.length - 2];
    const curr = trends[trends.length - 1];
    const deltaBytes = curr.totalDbBytes - prev.totalDbBytes;
    const growthPct =
      prev.totalDbBytes > 0
        ? Math.round((deltaBytes / prev.totalDbBytes) * 1000) / 10
        : deltaBytes > 0
          ? 100
          : 0;
    if (
      (growthPct >= 25 && deltaBytes >= 1024 * 1024) ||
      deltaBytes >= 50 * 1024 * 1024
    ) {
      hints.push({
        category: 'storage_growth',
        severity: growthPct >= 50 ? 'warning' : 'info',
        code: 'UNUSUAL_STORAGE_GROWTH',
        summary: 'Database footprint increased sharply between consecutive snapshots.',
        metrics: {
          previousSnapshotDate: prev.snapshotDate,
          currentSnapshotDate: curr.snapshotDate,
          previousBytes: prev.totalDbBytes,
          currentBytes: curr.totalDbBytes,
          deltaBytes,
          growthPct,
        },
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    anomalyCount: hints.length,
    hints,
  };
}

export async function executeAdminToolCall(
  caller: ResolvedMcpCaller,
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolResult | null> {
  const { user, apiKeyId, apiKeyPrefix } = caller;
  const actor = buildMcpAdminActor(caller, name);

  switch (name) {
    case 'admin_get_overview': {
      const overview = await getAdminOverview();
      await auditAdminMcpRead(caller, 'admin_get_overview');
      return wrapToolResult(overview);
    }

    case 'admin_get_storage': {
      const storage = await getAdminStorageReport();
      await auditAdminMcpRead(caller, 'admin_get_storage');
      return wrapToolResult(storage);
    }

    case 'admin_get_user_detail': {
      const target = await resolveTargetUser(args);
      if (!target) {
        return wrapToolResult({ error: 'User not found' }, true);
      }
      const detail = await getAdminUserDetail(target.id, actor);
      return wrapToolResult(detail);
    }

    case 'admin_get_adoption': {
      const adoption = await getAdminAdoptionReport();
      await auditAdminMcpRead(caller, 'admin_get_adoption');
      return wrapToolResult(adoption);
    }

    case 'admin_get_health': {
      const windowHours =
        args.windowHours === undefined ? 24 : Number(args.windowHours);
      if (
        !Number.isInteger(windowHours) ||
        windowHours < 1 ||
        windowHours > 720
      ) {
        return wrapToolResult(
          { error: 'windowHours must be an integer between 1 and 720' },
          true,
        );
      }
      const health = await getAdminSystemHealth(windowHours);
      await auditAdminMcpRead(caller, 'admin_get_health', { windowHours });
      return wrapToolResult(health);
    }

    case 'admin_get_audit_log': {
      const targetUserId =
        typeof args.targetUserId === 'string' && args.targetUserId.trim()
          ? args.targetUserId.trim()
          : undefined;
      const action =
        typeof args.action === 'string' && args.action.trim()
          ? args.action.trim()
          : undefined;
      const limit = args.limit === undefined ? 100 : Number(args.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
        return wrapToolResult(
          { error: 'limit must be an integer between 1 and 200' },
          true,
        );
      }
      const entries = await listAuditLog({ targetUserId, action, limit });
      await auditAdminMcpRead(
        caller,
        'admin_get_audit_log',
        { filterAction: action ?? null, limit },
        targetUserId ?? null,
      );
      return wrapToolResult({ count: entries.length, entries });
    }

    case 'admin_get_events_timeline': {
      const targetUserId =
        typeof args.targetUserId === 'string' && args.targetUserId.trim()
          ? args.targetUserId.trim()
          : undefined;
      const eventType =
        typeof args.eventType === 'string' && args.eventType.trim()
          ? args.eventType.trim()
          : undefined;
      const from =
        typeof args.from === 'string' && args.from.trim()
          ? args.from.trim()
          : undefined;
      const to =
        typeof args.to === 'string' && args.to.trim()
          ? args.to.trim()
          : undefined;
      const limit = args.limit === undefined ? 50 : Number(args.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
        return wrapToolResult(
          { error: 'limit must be an integer between 1 and 200' },
          true,
        );
      }

      const clauses: string[] = [];
      const params: unknown[] = [];
      if (targetUserId) {
        params.push(targetUserId);
        clauses.push(`user_id = $${params.length}`);
      }
      if (eventType) {
        params.push(eventType);
        clauses.push(`event_type = $${params.length}`);
      }
      if (from) {
        params.push(from);
        clauses.push(`created_at >= $${params.length}`);
      }
      if (to) {
        const toBound = /^\d{4}-\d{2}-\d{2}$/.test(to) ? `${to}T23:59:59.999Z` : to;
        params.push(toBound);
        clauses.push(`created_at <= $${params.length}`);
      }
      params.push(limit);
      const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
      const res = await query<{
        id: string;
        user_id: string;
        event_type: string;
        detail_json: string | null;
        created_at: string;
      }>(
        `SELECT id, user_id, event_type, detail_json, created_at
         FROM events
         ${whereSql}
         ORDER BY created_at DESC, id DESC
         LIMIT $${params.length}`,
        params,
      );

      const events = res.rows.map((r) => {
        let detail: Record<string, unknown> | null = null;
        if (r.detail_json) {
          try {
            const parsed = JSON.parse(r.detail_json) as unknown;
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              detail = parsed as Record<string, unknown>;
            }
          } catch {
            detail = null;
          }
        }
        return {
          id: r.id,
          userId: r.user_id,
          eventType: r.event_type,
          detail,
          createdAt: r.created_at,
        };
      });

      await auditAdminMcpRead(
        caller,
        'admin_get_events_timeline',
        { eventType: eventType ?? null, limit },
        targetUserId ?? null,
      );

      return wrapToolResult({ count: events.length, events });
    }

    case 'admin_list_snapshots': {
      const limit = args.limit === undefined ? 30 : Number(args.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 365) {
        return wrapToolResult(
          { error: 'limit must be an integer between 1 and 365' },
          true,
        );
      }
      const includeLatestFull = Boolean(args.includeLatestFull);
      const trends = await listSnapshotTrends(limit);
      const latestFull = includeLatestFull
        ? await getLatestDailySnapshot()
        : undefined;
      await auditAdminMcpRead(caller, 'admin_list_snapshots', {
        limit,
        includeLatestFull,
      });
      return wrapToolResult({
        count: trends.length,
        snapshots: trends,
        ...(includeLatestFull ? { latestFull } : {}),
      });
    }

    case 'admin_disable_user': {
      const targetUserId =
        typeof args.targetUserId === 'string' ? args.targetUserId.trim() : '';
      if (!targetUserId) {
        return wrapToolResult({ error: 'targetUserId is required' }, true);
      }
      if (targetUserId === user.id) {
        return wrapToolResult(
          { error: 'Cannot disable your own admin account' },
          true,
        );
      }
      const targetUser = await getUserById(targetUserId);
      if (!targetUser) {
        return wrapToolResult({ error: 'User not found' }, true);
      }
      const reason = typeof args.reason === 'string' ? args.reason.trim() : null;

      const gate = await requireTwoStepConfirmation({
        userId: user.id,
        apiKeyId,
        action: 'admin_disable_user',
        target: targetUserId,
        payload: { targetUserId, reason },
        confirmationToken: args.confirmationToken,
        description:
          'Disable the target user account and revoke all active session cookies.',
        summary: {
          targetUserId,
          username: targetUser.username,
          reason,
        },
      });
      if (!gate.confirmed) {
        if (!args.confirmationToken) {
          await auditAdminMcpRead(
            caller,
            'admin_disable_user_requested',
            { reason },
            targetUserId,
          );
        }
        return gate.response;
      }

      const result = await setUserDisabledState({
        targetUserId,
        disabled: true,
        reason,
        actor,
      });
      return wrapToolResult({ ok: true, action: 'disable', ...result });
    }

    case 'admin_enable_user': {
      const targetUserId =
        typeof args.targetUserId === 'string' ? args.targetUserId.trim() : '';
      if (!targetUserId) {
        return wrapToolResult({ error: 'targetUserId is required' }, true);
      }
      const reason = typeof args.reason === 'string' ? args.reason.trim() : null;
      const result = await setUserDisabledState({
        targetUserId,
        disabled: false,
        reason,
        actor,
      });
      return wrapToolResult({ ok: true, action: 'enable', ...result });
    }

    case 'admin_force_logout': {
      const targetUserId =
        typeof args.targetUserId === 'string' ? args.targetUserId.trim() : '';
      if (!targetUserId) {
        return wrapToolResult({ error: 'targetUserId is required' }, true);
      }
      const result = await forceLogoutUser({ targetUserId, actor });
      return wrapToolResult({ ok: true, action: 'force_logout', ...result });
    }

    case 'admin_revoke_api_key': {
      const targetUserId =
        typeof args.targetUserId === 'string' ? args.targetUserId.trim() : '';
      if (!targetUserId) {
        return wrapToolResult({ error: 'targetUserId is required' }, true);
      }
      const targetUser = await getUserById(targetUserId);
      if (!targetUser) {
        return wrapToolResult({ error: 'User not found' }, true);
      }

      const gate = await requireTwoStepConfirmation({
        userId: user.id,
        apiKeyId,
        action: 'admin_revoke_api_key',
        target: targetUserId,
        payload: { targetUserId },
        confirmationToken: args.confirmationToken,
        description:
          'Revoke the target user API key (immediately disables MCP and Apple Health Shortcut access until regenerated).',
        summary: {
          targetUserId,
          username: targetUser.username,
        },
      });
      if (!gate.confirmed) {
        if (!args.confirmationToken) {
          await auditAdminMcpRead(
            caller,
            'admin_revoke_api_key_requested',
            undefined,
            targetUserId,
          );
        }
        return gate.response;
      }

      const result = await revokeUserApiKey({ targetUserId, actor });
      return wrapToolResult({ ok: true, action: 'revoke_api_key', ...result });
    }

    case 'admin_reset_password': {
      const targetUser = await resolveTargetUser(args);
      if (!targetUser) {
        return wrapToolResult({ error: 'User not found' }, true);
      }
      if (targetUser.isGuest) {
        return wrapToolResult(
          { error: 'Cannot reset password for a guest sandbox account' },
          true,
        );
      }
      const reason = typeof args.reason === 'string' ? args.reason.trim() : null;

      const gate = await requireTwoStepConfirmation({
        userId: user.id,
        apiKeyId,
        action: 'admin_reset_password',
        target: targetUser.id,
        payload: { targetUserId: targetUser.id, reason },
        confirmationToken: args.confirmationToken,
        description:
          'Generate a new one-time temporary password, revoke active sessions, and require password change on next login.',
        warning:
          'The temporary password will be returned in the tool result and enter your AI agent conversation. Use scripts/reset-password.mjs in the container terminal if it must stay out of agent context.',
        summary: {
          targetUserId: targetUser.id,
          username: targetUser.username,
          reason,
        },
      });
      if (!gate.confirmed) {
        if (!args.confirmationToken) {
          await auditAdminMcpRead(
            caller,
            'admin_reset_password_requested',
            { reason },
            targetUser.id,
          );
        }
        return gate.response;
      }

      const result = await resetUserPassword({
        targetUserId: targetUser.id,
        source: 'mcp',
        actorUserId: user.id,
        actorLabel: user.username,
        reason,
        auditDetail: {
          apiKeyId,
          apiKeyPrefix,
          mcpTool: 'admin_reset_password',
        },
      });
      return wrapToolResult({ ok: true, ...result });
    }

    case 'admin_adjust_photo_quota': {
      const targetUserId =
        typeof args.targetUserId === 'string' ? args.targetUserId.trim() : '';
      if (!targetUserId) {
        return wrapToolResult({ error: 'targetUserId is required' }, true);
      }
      if (args.photoQuota === undefined) {
        return wrapToolResult(
          { error: 'photoQuota must be an integer (0..10000) or null' },
          true,
        );
      }
      const result = await adjustUserPhotoQuota({
        targetUserId,
        photoQuota: args.photoQuota as number | null,
        actor,
      });
      return wrapToolResult({
        ok: true,
        action: 'adjust_photo_quota',
        ...result,
      });
    }

    case 'admin_delete_user': {
      const targetUserId =
        typeof args.targetUserId === 'string' ? args.targetUserId.trim() : '';
      if (!targetUserId) {
        return wrapToolResult({ error: 'targetUserId is required' }, true);
      }
      if (targetUserId === user.id) {
        return wrapToolResult(
          { error: 'Cannot delete your own admin account' },
          true,
        );
      }
      const targetUser = await getUserById(targetUserId);
      if (!targetUser) {
        return wrapToolResult({ error: 'User not found' }, true);
      }

      const gate = await requireTwoStepConfirmation({
        userId: user.id,
        apiKeyId,
        action: 'admin_delete_user',
        target: targetUserId,
        payload: { targetUserId },
        confirmationToken: args.confirmationToken,
        description:
          'Permanently delete the user account and all workouts, splits, body metrics, custom exercises, progress photos, Apple Health records, API keys, and sessions.',
        warning: 'This action is permanent and cannot be undone.',
        summary: {
          targetUserId,
          username: targetUser.username,
          isGuest: targetUser.isGuest,
        },
      });
      if (!gate.confirmed) {
        if (!args.confirmationToken) {
          await auditAdminMcpRead(
            caller,
            'admin_delete_user_requested',
            undefined,
            targetUserId,
          );
        }
        return gate.response;
      }

      const result = await adminDeleteUser({ targetUserId, actor });
      return wrapToolResult({ ok: true, action: 'delete_user', ...result });
    }

    case 'admin_export_user_data': {
      const targetUserId =
        typeof args.targetUserId === 'string' ? args.targetUserId.trim() : '';
      if (!targetUserId) {
        return wrapToolResult({ error: 'targetUserId is required' }, true);
      }
      const reason = typeof args.reason === 'string' ? args.reason : '';
      const result = await adminExportUserData({
        targetUserId,
        reason,
        actor,
      });
      return wrapToolResult(result);
    }

    case 'admin_query_reporting_view': {
      const allowedArgs = new Set([
        'action',
        'view',
        'columns',
        'filters',
        'orderBy',
        'limit',
        'offset',
      ]);
      for (const key of Object.keys(args)) {
        if (!allowedArgs.has(key)) {
          return wrapToolResult(
            {
              error: `Unsupported argument "${key}". Raw SQL or table access is not permitted; query only allowlisted reporting views via view/columns/filters/orderBy/limit/offset.`,
            },
            true,
          );
        }
      }
      const action =
        args.action === undefined ? 'query' : String(args.action).trim();
      if (action === 'list_views') {
        const views = listReportingViewsMetadata();
        await auditAdminMcpRead(caller, 'admin_query_reporting_view', {
          action: 'list_views',
        });
        return wrapToolResult({ views });
      }
      if (action !== 'query') {
        return wrapToolResult(
          { error: 'action must be "query" or "list_views"' },
          true,
        );
      }
      const result = await queryReportingView({
        view: args.view,
        columns: args.columns,
        filters: args.filters,
        orderBy: args.orderBy,
        limit: args.limit,
        offset: args.offset,
      });
      await auditAdminMcpRead(caller, 'admin_query_reporting_view', {
        view: result.view,
        columns: result.columns,
        rowCount: result.rowCount,
      });
      return wrapToolResult(result);
    }

    case 'admin_get_digest': {
      const periodDays =
        args.periodDays === undefined ? 7 : Number(args.periodDays);
      if (
        !Number.isInteger(periodDays) ||
        periodDays < 1 ||
        periodDays > 90
      ) {
        return wrapToolResult(
          { error: 'periodDays must be an integer between 1 and 90' },
          true,
        );
      }
      const digest = await computeAdminDigest(periodDays);
      await auditAdminMcpRead(caller, 'admin_get_digest', { periodDays });
      return wrapToolResult(digest);
    }

    case 'admin_get_anomaly_hints': {
      const anomalies = await computeAnomalyHints();
      await auditAdminMcpRead(caller, 'admin_get_anomaly_hints', {
        anomalyCount: anomalies.anomalyCount,
      });
      return wrapToolResult(anomalies);
    }

    case 'admin_get_catalog_suggestions': {
      const minUsers = args.minUsers === undefined ? 1 : Number(args.minUsers);
      if (!Number.isInteger(minUsers) || minUsers < 1 || minUsers > 1000) {
        return wrapToolResult(
          { error: 'minUsers must be an integer between 1 and 1000' },
          true,
        );
      }
      const usage = await getLiveCatalogUsage();
      const customExerciseCandidates = usage.customExerciseCandidates.filter(
        (c) => c.userCount >= minUsers,
      );
      await auditAdminMcpRead(caller, 'admin_get_catalog_suggestions', {
        minUsers,
        candidateCount: customExerciseCandidates.length,
        unusedCount: usage.unusedCatalogCount,
      });
      return wrapToolResult({
        generatedAt: new Date().toISOString(),
        minUsers,
        customExerciseCandidates,
        unusedCatalogCount: usage.unusedCatalogCount,
        unusedCatalog: usage.unusedCatalog,
      });
    }

    case 'admin_run_maintenance': {
      const task = typeof args.task === 'string' ? args.task.trim() : '';
      if (
        task !== 'daily_snapshot' &&
        task !== 'guest_purge' &&
        task !== 'both'
      ) {
        return wrapToolResult(
          { error: 'task must be "daily_snapshot", "guest_purge", or "both"' },
          true,
        );
      }

      const output: Record<string, unknown> = { ok: true, task };
      if (task === 'daily_snapshot' || task === 'both') {
        output.dailySnapshot = await adminRefreshDailySnapshot({ actor });
      }
      if (task === 'guest_purge' || task === 'both') {
        output.guestPurge = await adminPurgeExpiredGuests({ actor });
      }
      return wrapToolResult(output);
    }

    default:
      return null;
  }
}
