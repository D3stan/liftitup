import { getDbHealthStats, query, queryOne, type DbHealthStats } from '@/lib/db/connection';
import {
  flushRequestMetrics,
  getSystemState,
  type AppleHealthIngestState,
  type GuestPurgeState,
} from './metrics';

export interface RouteHealthMetric {
  route: string;
  method: string;
  requestCount: number;
  error4xxCount: number;
  error5xxCount: number;
  errorRatePct: number;
  avgLatencyMs: number;
  maxLatencyMs: number;
}

export interface RecentAppErrorItem {
  id: string;
  route: string;
  method: string;
  status: number;
  errorCode: string | null;
  message: string;
  requestId: string | null;
  createdAt: string;
}

export interface AdminSystemHealthReport {
  generatedAt: string;
  requests: {
    windowHours: number;
    totalRequests: number;
    total4xx: number;
    total5xx: number;
    errorRatePct: number;
    avgLatencyMs: number;
    routes: RouteHealthMetric[];
  };
  errors: RecentAppErrorItem[];
  database: DbHealthStats;
  ingest: {
    receivedCount: number;
    rejectedCount: number;
    lastReceivedAt: string | null;
    lastRejectedAt: string | null;
    storedWorkouts: number;
    linkedWorkouts: number;
    unlinkedWorkouts: number;
  };
  guestPurge: {
    lastRunAt: string | null;
    lastPurgedCount: number;
    totalPurgedCount: number;
    currentlyExpiredCount: number;
  };
}

export async function getAdminSystemHealth(
  windowHours = 24,
): Promise<AdminSystemHealthReport> {
  await flushRequestMetrics();

  const safeHours = Math.max(1, Math.min(720, Math.round(windowHours)));
  const now = new Date();
  const cutoffIso = new Date(now.getTime() - safeHours * 3600_000).toISOString();
  const expiredGuestCutoff = new Date(
    now.getTime() - 24 * 3600_000,
  ).toISOString();

  const [
    routeRowsRes,
    errorRowsRes,
    ahRow,
    ingestState,
    purgeState,
    expiredGuestRow,
  ] = await Promise.all([
    query<{
      route: string;
      method: string;
      request_count: number;
      error_4xx_count: number;
      error_5xx_count: number;
      total_duration_ms: number;
      max_duration_ms: number;
    }>(
      `SELECT
         route,
         method,
         COALESCE(SUM(request_count), 0)::int AS request_count,
         COALESCE(SUM(error_4xx_count), 0)::int AS error_4xx_count,
         COALESCE(SUM(error_5xx_count), 0)::int AS error_5xx_count,
         COALESCE(SUM(total_duration_ms), 0)::double precision AS total_duration_ms,
         COALESCE(MAX(max_duration_ms), 0)::double precision AS max_duration_ms
       FROM request_metric_buckets
       WHERE bucket_start >= $1
       GROUP BY route, method
       ORDER BY request_count DESC, route ASC`,
      [cutoffIso],
    ),
    query<{
      id: string;
      route: string;
      method: string;
      status: number;
      error_code: string | null;
      message: string;
      request_id: string | null;
      created_at: string;
    }>(
      `SELECT id, route, method, status, error_code, message, request_id, created_at
       FROM app_errors
       ORDER BY created_at DESC, id DESC
       LIMIT 50`,
    ),
    queryOne<{ total: number; unlinked: number; linked: number }>(
      `SELECT
         COUNT(*)::int AS total,
         COALESCE(SUM(CASE WHEN linked_session_id IS NULL THEN 1 ELSE 0 END), 0)::int AS unlinked,
         COALESCE(SUM(CASE WHEN linked_session_id IS NOT NULL THEN 1 ELSE 0 END), 0)::int AS linked
       FROM apple_health_workouts`,
    ),
    getSystemState<AppleHealthIngestState>('apple_health_ingest'),
    getSystemState<GuestPurgeState>('guest_purge'),
    queryOne<{ cnt: number }>(
      'SELECT COUNT(*)::int AS cnt FROM users WHERE is_guest = 1 AND last_active_at < $1',
      [expiredGuestCutoff],
    ),
  ]);

  let totalRequests = 0;
  let total4xx = 0;
  let total5xx = 0;
  let sumDuration = 0;

  const routes: RouteHealthMetric[] = routeRowsRes.rows.map((r) => {
    const reqCnt = Number(r.request_count);
    const e4 = Number(r.error_4xx_count);
    const e5 = Number(r.error_5xx_count);
    const totDur = Number(r.total_duration_ms);
    const maxDur = Number(r.max_duration_ms);

    totalRequests += reqCnt;
    total4xx += e4;
    total5xx += e5;
    sumDuration += totDur;

    return {
      route: r.route,
      method: r.method,
      requestCount: reqCnt,
      error4xxCount: e4,
      error5xxCount: e5,
      errorRatePct:
        reqCnt > 0 ? Math.round(((e4 + e5) / reqCnt) * 1000) / 10 : 0,
      avgLatencyMs: reqCnt > 0 ? Math.round((totDur / reqCnt) * 10) / 10 : 0,
      maxLatencyMs: Math.round(maxDur * 10) / 10,
    };
  });

  return {
    generatedAt: now.toISOString(),
    requests: {
      windowHours: safeHours,
      totalRequests,
      total4xx,
      total5xx,
      errorRatePct:
        totalRequests > 0
          ? Math.round(((total4xx + total5xx) / totalRequests) * 1000) / 10
          : 0,
      avgLatencyMs:
        totalRequests > 0
          ? Math.round((sumDuration / totalRequests) * 10) / 10
          : 0,
      routes,
    },
    errors: errorRowsRes.rows.map((e) => ({
      id: e.id,
      route: e.route,
      method: e.method,
      status: Number(e.status),
      errorCode: e.error_code,
      message: e.message,
      requestId: e.request_id,
      createdAt: e.created_at,
    })),
    database: getDbHealthStats(),
    ingest: {
      receivedCount: ingestState?.value.receivedCount ?? 0,
      rejectedCount: ingestState?.value.rejectedCount ?? 0,
      lastReceivedAt: ingestState?.value.lastReceivedAt ?? null,
      lastRejectedAt: ingestState?.value.lastRejectedAt ?? null,
      storedWorkouts: Number(ahRow?.total ?? 0),
      linkedWorkouts: Number(ahRow?.linked ?? 0),
      unlinkedWorkouts: Number(ahRow?.unlinked ?? 0),
    },
    guestPurge: {
      lastRunAt: purgeState?.value.lastRunAt ?? null,
      lastPurgedCount: purgeState?.value.lastPurgedCount ?? 0,
      totalPurgedCount: purgeState?.value.totalPurgedCount ?? 0,
      currentlyExpiredCount: Number(expiredGuestRow?.cnt ?? 0),
    },
  };
}
