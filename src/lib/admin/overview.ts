import { isPgMemActive, query, queryOne } from '@/lib/db/connection';
import {
  ensureDailySnapshotIfDue,
  listSnapshotTrends,
  type SnapshotPerUserStorage,
  type SnapshotRetentionCohort,
  type SnapshotTrendPoint,
  type TableSizeMetric,
} from './snapshot';

export interface DailySignupPoint {
  date: string;
  registered: number;
  guest: number;
  total: number;
}

export interface WeeklySignupPoint {
  weekStart: string;
  registered: number;
  guest: number;
  total: number;
}

export interface ChurnUserSummary {
  userId: string;
  username: string;
  displayName: string;
  createdAt: string;
  lastActiveAt: string;
  lastSessionDate: string | null;
  daysSinceLastSession: number | null;
  isDisabled: boolean;
}

export interface DailyVolumePoint {
  date: string;
  sessions: number;
  sets: number;
  totalKg: number;
}

export interface AdminOverviewData {
  generatedAt: string;
  snapshotComputedAt: string | null;
  users: {
    total: number;
    registered: number;
    guest: number;
    disabled: number;
    newPerDay: DailySignupPoint[];
    newPerWeek: WeeklySignupPoint[];
  };
  activeUsers: {
    d1: number;
    d7: number;
    d30: number;
    stickinessPct: number;
    hasActivityEvents: boolean;
    app: { d1: number; d7: number; d30: number };
    apiKey: { d1: number; d7: number; d30: number };
    trends: SnapshotTrendPoint[];
  };
  guestConversion: {
    totalConversions: number;
    conversions30d: number;
    guestsCreated30d: number;
    conversionRate30dPct: number;
  };
  retentionCohorts: SnapshotRetentionCohort[];
  churn: {
    inactive14d: ChurnUserSummary[];
    inactive30d: ChurnUserSummary[];
  };
  dailyVolume: DailyVolumePoint[];
  storage: {
    totalDbBytes: number;
    tableSizes: TableSizeMetric[];
    growthOverTime: Array<{ snapshotDate: string; totalDbBytes: number }>;
    largestUsers: SnapshotPerUserStorage[];
  };
}

function getMondayUtcWeek(ymd: string): string {
  const dt = new Date(`${ymd}T00:00:00.000Z`);
  if (Number.isNaN(dt.getTime())) return ymd;
  const day = dt.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(
    Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate() + diff),
  );
  return monday.toISOString().slice(0, 10);
}

export async function getAdminOverview(): Promise<AdminOverviewData> {
  const now = new Date();
  const nowMs = now.getTime();
  const cutoff1d = new Date(nowMs - 1 * 86_400_000).toISOString();
  const cutoff7d = new Date(nowMs - 7 * 86_400_000).toISOString();
  const cutoff14d = new Date(nowMs - 14 * 86_400_000).toISOString();
  const cutoff30d = new Date(nowMs - 30 * 86_400_000).toISOString();
  const cutoff14dDate = cutoff14d.slice(0, 10);
  const cutoff30dDate = cutoff30d.slice(0, 10);
  const cutoff84d = new Date(nowMs - 84 * 86_400_000).toISOString();

  const [snapshot, trends] = await Promise.all([
    ensureDailySnapshotIfDue(),
    listSnapshotTrends(30),
  ]);

  const userSummaryRow = await queryOne<{
    total: number;
    registered: number;
    guest: number;
    disabled: number;
    d1: number;
    d7: number;
    d30: number;
  }>(
    `SELECT
       COUNT(*)::int AS total,
       COALESCE(SUM(CASE WHEN is_guest = 0 THEN 1 ELSE 0 END), 0)::int AS registered,
       COALESCE(SUM(CASE WHEN is_guest = 1 THEN 1 ELSE 0 END), 0)::int AS guest,
       COALESCE(SUM(CASE WHEN is_disabled = 1 THEN 1 ELSE 0 END), 0)::int AS disabled,
       COALESCE(SUM(CASE WHEN last_active_at >= $1 THEN 1 ELSE 0 END), 0)::int AS d1,
       COALESCE(SUM(CASE WHEN last_active_at >= $2 THEN 1 ELSE 0 END), 0)::int AS d7,
       COALESCE(SUM(CASE WHEN last_active_at >= $3 THEN 1 ELSE 0 END), 0)::int AS d30
     FROM users`,
    [cutoff1d, cutoff7d, cutoff30d],
  );

  // Activity split (app vs API key) from events
  const activityEventsCountRow = await queryOne<{ cnt: number }>(
    `SELECT COUNT(*)::int AS cnt
     FROM events
     WHERE event_type IN ('app_active', 'api_key_active')`,
  );
  const hasActivityEvents = Number(activityEventsCountRow?.cnt ?? 0) > 0;

  const activityBreakdownRow = await queryOne<{
    app_d1: number;
    app_d7: number;
    app_d30: number;
    key_d1: number;
    key_d7: number;
    key_d30: number;
  }>(
    `SELECT
       COUNT(DISTINCT CASE WHEN event_type = 'app_active' AND created_at >= $1 THEN user_id END)::int AS app_d1,
       COUNT(DISTINCT CASE WHEN event_type = 'app_active' AND created_at >= $2 THEN user_id END)::int AS app_d7,
       COUNT(DISTINCT CASE WHEN event_type = 'app_active' AND created_at >= $3 THEN user_id END)::int AS app_d30,
       COUNT(DISTINCT CASE WHEN event_type = 'api_key_active' AND created_at >= $1 THEN user_id END)::int AS key_d1,
       COUNT(DISTINCT CASE WHEN event_type = 'api_key_active' AND created_at >= $2 THEN user_id END)::int AS key_d7,
       COUNT(DISTINCT CASE WHEN event_type = 'api_key_active' AND created_at >= $3 THEN user_id END)::int AS key_d30
     FROM events
     WHERE event_type IN ('app_active', 'api_key_active') AND created_at >= $3`,
    [cutoff1d, cutoff7d, cutoff30d],
  );

  // Signups per day (30d) & per week (12w)
  const signupsRes = await query<{ created_at: string; is_guest: number }>(
    `SELECT created_at, is_guest FROM users WHERE created_at >= $1 ORDER BY created_at ASC`,
    [cutoff84d],
  );
  const dayMap = new Map<string, { registered: number; guest: number }>();
  const weekMap = new Map<string, { registered: number; guest: number }>();
  for (const row of signupsRes.rows) {
    const day = row.created_at.slice(0, 10);
    const week = getMondayUtcWeek(day);
    if (row.created_at >= cutoff30d) {
      const d = dayMap.get(day) ?? { registered: 0, guest: 0 };
      if (row.is_guest) d.guest += 1;
      else d.registered += 1;
      dayMap.set(day, d);
    }
    const w = weekMap.get(week) ?? { registered: 0, guest: 0 };
    if (row.is_guest) w.guest += 1;
    else w.registered += 1;
    weekMap.set(week, w);
  }

  const newPerDay: DailySignupPoint[] = Array.from(dayMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, c]) => ({
      date,
      registered: c.registered,
      guest: c.guest,
      total: c.registered + c.guest,
    }));

  const newPerWeek: WeeklySignupPoint[] = Array.from(weekMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([weekStart, c]) => ({
      weekStart,
      registered: c.registered,
      guest: c.guest,
      total: c.registered + c.guest,
    }));

  // Guest conversion metrics from events
  const convRow = await queryOne<{
    total_conv: number;
    conv_30d: number;
    guests_30d: number;
  }>(
    `SELECT
       COALESCE(SUM(CASE WHEN event_type = 'guest_converted' THEN 1 ELSE 0 END), 0)::int AS total_conv,
       COALESCE(SUM(CASE WHEN event_type = 'guest_converted' AND created_at >= $1 THEN 1 ELSE 0 END), 0)::int AS conv_30d,
       COALESCE(SUM(CASE WHEN event_type = 'guest_created' AND created_at >= $1 THEN 1 ELSE 0 END), 0)::int AS guests_30d
     FROM events
     WHERE event_type IN ('guest_converted', 'guest_created')`,
    [cutoff30d],
  );
  const conv30d = Number(convRow?.conv_30d ?? 0);
  const guests30d = Number(convRow?.guests_30d ?? 0);
  const conversionRate30dPct =
    guests30d > 0 ? Math.round((conv30d / guests30d) * 1000) / 10 : 0;

  // Churn list: registered users with no workout_sessions in 14 / 30 days
  const churnRes = await query<{
    id: string;
    username: string;
    display_name: string;
    created_at: string;
    last_active_at: string;
    is_disabled: number;
    last_session_date: string | null;
  }>(
    `SELECT
       u.id,
       u.username,
       u.display_name,
       u.created_at,
       u.last_active_at,
       u.is_disabled,
       MAX(ws.session_date) AS last_session_date
     FROM users u
     LEFT JOIN workout_sessions ws ON ws.user_id = u.id
     WHERE u.is_guest = 0
     GROUP BY u.id, u.username, u.display_name, u.created_at, u.last_active_at, u.is_disabled
     ORDER BY last_session_date ASC NULLS FIRST, u.created_at ASC`,
  );

  const inactive14d: ChurnUserSummary[] = [];
  const inactive30d: ChurnUserSummary[] = [];
  const todayUtcMs = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);

  for (const r of churnRes.rows) {
    const lastDate = r.last_session_date;
    const daysSinceLastSession = lastDate
      ? Math.max(
          0,
          Math.floor(
            (todayUtcMs - Date.parse(`${lastDate}T00:00:00.000Z`)) / 86_400_000,
          ),
        )
      : null;

    const item: ChurnUserSummary = {
      userId: r.id,
      username: r.username,
      displayName: r.display_name,
      createdAt: r.created_at,
      lastActiveAt: r.last_active_at,
      lastSessionDate: lastDate,
      daysSinceLastSession,
      isDisabled: Boolean(r.is_disabled),
    };

    const isChurned30 =
      (lastDate !== null && lastDate < cutoff30dDate) ||
      (lastDate === null && r.created_at < cutoff30d);
    const isChurned14 =
      (lastDate !== null && lastDate < cutoff14dDate) ||
      (lastDate === null && r.created_at < cutoff14d);

    if (isChurned30) inactive30d.push(item);
    if (isChurned14) inactive14d.push(item);
  }

  // Daily volume (aggregate sessions, sets, total kg logged per day for last 30 days)
  const pgMem = isPgMemActive();
  const volumeSql = pgMem
    ? `
      SELECT
        ws.session_date AS date,
        COUNT(DISTINCT ws.id)::int AS sessions,
        COUNT(wset.id)::int AS sets,
        COALESCE(SUM(CASE WHEN wset.is_completed = 1 AND wset.weight_kg IS NOT NULL AND wset.reps IS NOT NULL THEN wset.weight_kg * wset.reps ELSE 0 END), 0) AS total_kg
      FROM workout_sessions ws
      LEFT JOIN workout_exercises we ON we.session_id = ws.id
      LEFT JOIN workout_sets wset ON wset.workout_exercise_id = we.id
      WHERE ws.session_date >= $1
      GROUP BY ws.session_date
      ORDER BY ws.session_date ASC
    `
    : `
      SELECT
        ws.session_date AS date,
        COUNT(DISTINCT ws.id)::int AS sessions,
        COUNT(wset.id)::int AS sets,
        COALESCE(SUM(CASE WHEN wset.is_completed = 1 AND wset.weight_kg IS NOT NULL AND wset.reps IS NOT NULL THEN wset.weight_kg * wset.reps ELSE 0 END), 0)::double precision AS total_kg
      FROM workout_sessions ws
      LEFT JOIN workout_exercises we ON we.session_id = ws.id
      LEFT JOIN workout_sets wset ON wset.workout_exercise_id = we.id
      WHERE ws.session_date >= $1
      GROUP BY ws.session_date
      ORDER BY ws.session_date ASC
    `;

  const volumeRes = await query<{
    date: string;
    sessions: number;
    sets: number;
    total_kg: number | string;
  }>(volumeSql, [cutoff30dDate]);

  const dailyVolume: DailyVolumePoint[] = volumeRes.rows.map((r) => ({
    date: r.date,
    sessions: Number(r.sessions),
    sets: Number(r.sets),
    totalKg: Math.round(Number(r.total_kg) * 10) / 10,
  }));

  const d1 = Number(userSummaryRow?.d1 ?? 0);
  const d30 = Number(userSummaryRow?.d30 ?? 0);
  const stickinessPct = d30 > 0 ? Math.round((d1 / d30) * 1000) / 10 : 0;

  return {
    generatedAt: now.toISOString(),
    snapshotComputedAt: snapshot?.computedAt ?? null,
    users: {
      total: Number(userSummaryRow?.total ?? 0),
      registered: Number(userSummaryRow?.registered ?? 0),
      guest: Number(userSummaryRow?.guest ?? 0),
      disabled: Number(userSummaryRow?.disabled ?? 0),
      newPerDay,
      newPerWeek,
    },
    activeUsers: {
      d1,
      d7: Number(userSummaryRow?.d7 ?? 0),
      d30,
      stickinessPct,
      hasActivityEvents,
      app: {
        d1: Number(activityBreakdownRow?.app_d1 ?? 0),
        d7: Number(activityBreakdownRow?.app_d7 ?? 0),
        d30: Number(activityBreakdownRow?.app_d30 ?? 0),
      },
      apiKey: {
        d1: Number(activityBreakdownRow?.key_d1 ?? 0),
        d7: Number(activityBreakdownRow?.key_d7 ?? 0),
        d30: Number(activityBreakdownRow?.key_d30 ?? 0),
      },
      trends,
    },
    guestConversion: {
      totalConversions: Number(convRow?.total_conv ?? 0),
      conversions30d: conv30d,
      guestsCreated30d: guests30d,
      conversionRate30dPct,
    },
    retentionCohorts: snapshot?.cohorts ?? [],
    churn: {
      inactive14d,
      inactive30d,
    },
    dailyVolume,
    storage: {
      totalDbBytes: snapshot?.totalDbBytes ?? 0,
      tableSizes: snapshot?.tableSizes ?? [],
      growthOverTime: trends.map((t) => ({
        snapshotDate: t.snapshotDate,
        totalDbBytes: t.totalDbBytes,
      })),
      largestUsers: (snapshot?.perUserStorage ?? []).slice(0, 10),
    },
  };
}
