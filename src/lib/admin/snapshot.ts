import {
  hasActivePool,
  isPgMemActive,
  query,
  queryOne,
} from '@/lib/db/connection';
import { logger } from '@/lib/logger';
import { DEFAULT_PHOTO_QUOTA } from '@/lib/photos/constants';

export interface TableSizeMetric {
  tableName: string;
  totalBytes: number;
  heapBytes: number;
  indexToastBytes: number;
  estimatedRows: number;
}

export interface SnapshotOverviewMetrics {
  totalUsers: number;
  registeredUsers: number;
  guestUsers: number;
  dau: number;
  wau: number;
  mau: number;
  stickinessPct: number;
  appDau: number;
  apiKeyDau: number;
}

export interface SnapshotUserRowCounts {
  sessions: number;
  sessionExercises: number;
  sets: number;
  repQualities: number;
  customExercises: number;
  schedules: number;
  bodyMetrics: number;
  appleHealthWorkouts: number;
}

export interface SnapshotPerUserStorage {
  userId: string;
  username: string;
  displayName: string;
  isGuest: boolean;
  isDisabled: boolean;
  lastActiveAt: string;
  createdAt: string;
  counts: SnapshotUserRowCounts;
  estimatedDbBytes: number;
  photoCount: number;
  photoBytes: number;
  photoQuota: number;
  totalEstimatedBytes: number;
}

export interface SnapshotRetentionCohort {
  cohortWeek: string;
  cohortSize: number;
  week0: number;
  week1: number;
  week2: number;
  week4: number;
  week8: number;
}

export interface SnapshotCatalogExerciseStat {
  exerciseId: string;
  name: string;
  category: string;
  trackingType: string;
  logCount: number;
  userCount: number;
}

export interface SnapshotCustomCandidate {
  normalizedName: string;
  sampleName: string;
  userCount: number;
  sessionCount: number;
}

export interface SnapshotCatalogUsage {
  mostLogged: SnapshotCatalogExerciseStat[];
  leastLogged: SnapshotCatalogExerciseStat[];
  unusedCatalog: Array<{
    exerciseId: string;
    name: string;
    category: string;
    trackingType: string;
  }>;
  unusedCatalogCount: number;
  customExerciseCandidates: SnapshotCustomCandidate[];
}

export interface DailySnapshotRecord {
  snapshotDate: string;
  computedAt: string;
  totalDbBytes: number;
  tableSizes: TableSizeMetric[];
  overview: SnapshotOverviewMetrics;
  perUserStorage: SnapshotPerUserStorage[];
  cohorts: SnapshotRetentionCohort[];
  catalogUsage: SnapshotCatalogUsage;
}

export interface SnapshotTrendPoint {
  snapshotDate: string;
  computedAt: string;
  totalDbBytes: number;
  totalUsers: number;
  registeredUsers: number;
  guestUsers: number;
  dau: number;
  wau: number;
  mau: number;
  stickinessPct: number;
  appDau: number;
  apiKeyDau: number;
}

const SNAPSHOT_STATE_KEY = Symbol.for('liftitup.admin.lastSnapshotDate');

function getLastSnapshotDateChecked(): string | null {
  const g = globalThis as Record<symbol, string | null | undefined>;
  return g[SNAPSHOT_STATE_KEY] ?? null;
}

function setLastSnapshotDateChecked(dateStr: string | null): void {
  const g = globalThis as Record<symbol, string | null | undefined>;
  g[SNAPSHOT_STATE_KEY] = dateStr;
}

export function resetSnapshotThrottleForTests(): void {
  setLastSnapshotDateChecked(null);
}

function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function utcTodayYmd(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function addMsIso(nowMs: number, deltaMs: number): string {
  return new Date(nowMs + deltaMs).toISOString();
}

function getMondayUtcWeek(dateStr: string): string {
  const dt = new Date(dateStr);
  if (Number.isNaN(dt.getTime())) return utcTodayYmd();
  const day = dt.getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(
    Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate() + diffToMonday),
  );
  return monday.toISOString().slice(0, 10);
}

async function computeTableSizes(pgMem: boolean): Promise<{
  totalDbBytes: number;
  tableSizes: TableSizeMetric[];
}> {
  if (!pgMem) {
    const dbSizeRow = await queryOne<{ total_db_bytes: string | number }>(
      'SELECT pg_database_size(current_database())::bigint AS total_db_bytes',
    );
    const tablesRes = await query<{
      table_name: string;
      total_bytes: string | number;
      heap_bytes: string | number;
      index_toast_bytes: string | number;
      estimated_rows: string | number;
    }>(`
      SELECT
        c.relname AS table_name,
        pg_total_relation_size(c.oid)::bigint AS total_bytes,
        pg_relation_size(c.oid)::bigint AS heap_bytes,
        GREATEST(0, pg_total_relation_size(c.oid) - pg_relation_size(c.oid))::bigint AS index_toast_bytes,
        COALESCE(s.n_live_tup, 0)::bigint AS estimated_rows
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY total_bytes DESC, c.relname ASC
    `);

    const tableSizes: TableSizeMetric[] = tablesRes.rows.map((r) => ({
      tableName: r.table_name,
      totalBytes: Number(r.total_bytes),
      heapBytes: Number(r.heap_bytes),
      indexToastBytes: Number(r.index_toast_bytes),
      estimatedRows: Number(r.estimated_rows),
    }));

    return {
      totalDbBytes: Number(dbSizeRow?.total_db_bytes ?? 0),
      tableSizes,
    };
  }

  // Fallback for pg-mem tests
  const tableNames = [
    'users',
    'workout_sessions',
    'workout_exercises',
    'workout_sets',
    'workout_set_rep_qualities',
    'schedules',
    'schedule_days',
    'schedule_day_exercises',
    'schedule_events',
    'exercises',
    'body_metrics',
    'apple_health_workouts',
    'progress_photos',
    'auth_sessions',
    'api_keys',
    'events',
    'audit_log',
  ];
  const tableSizes: TableSizeMetric[] = [];
  let sumBytes = 0;
  for (const name of tableNames) {
    const row = await queryOne<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM ${name}`,
    );
    const cnt = Number(row?.cnt ?? 0);
    const estBytes = cnt * 128;
    sumBytes += estBytes;
    tableSizes.push({
      tableName: name,
      totalBytes: estBytes,
      heapBytes: estBytes,
      indexToastBytes: 0,
      estimatedRows: cnt,
    });
  }
  return { totalDbBytes: sumBytes, tableSizes };
}

async function computePerUserStorage(
  pgMem: boolean,
): Promise<SnapshotPerUserStorage[]> {
  const usersRes = await query<{
    id: string;
    username: string;
    display_name: string;
    is_guest: number;
    is_disabled: number;
    photo_quota: number | null;
    last_active_at: string;
    created_at: string;
  }>(`
    SELECT id, username, display_name, is_guest, is_disabled, photo_quota, last_active_at, created_at
    FROM users
    ORDER BY created_at ASC
  `);

  if (usersRes.rows.length === 0) return [];

  type UserCountsRow = {
    user_id: string;
    sessions_cnt: number;
    session_exercises_cnt: number;
    sets_cnt: number;
    rep_qualities_cnt: number;
    custom_exercises_cnt: number;
    schedules_cnt: number;
    body_metrics_cnt: number;
    apple_health_cnt: number;
    photo_cnt: number;
    photo_bytes: string | number;
    est_db_bytes?: string | number;
  };

  let byUserId: Map<string, UserCountsRow>;

  if (pgMem) {
    // pg-mem does not support correlated outer column references inside SELECT subqueries.
    const [
      sessRows,
      wexRows,
      wsetRows,
      rqRows,
      cexRows,
      schedRows,
      bmRows,
      ahRows,
      photoRows,
    ] = await Promise.all([
      query<{ user_id: string; cnt: number }>(
        `SELECT user_id, COUNT(*)::int AS cnt FROM workout_sessions GROUP BY user_id`,
      ),
      query<{ user_id: string; cnt: number }>(
        `SELECT s.user_id, COUNT(*)::int AS cnt FROM workout_exercises we JOIN workout_sessions s ON s.id = we.session_id GROUP BY s.user_id`,
      ),
      query<{ user_id: string; cnt: number }>(
        `SELECT s.user_id, COUNT(*)::int AS cnt FROM workout_sets ws JOIN workout_exercises we ON we.id = ws.workout_exercise_id JOIN workout_sessions s ON s.id = we.session_id GROUP BY s.user_id`,
      ),
      query<{ user_id: string; cnt: number }>(
        `SELECT s.user_id, COUNT(*)::int AS cnt FROM workout_set_rep_qualities rq JOIN workout_sets ws ON ws.id = rq.workout_set_id JOIN workout_exercises we ON we.id = ws.workout_exercise_id JOIN workout_sessions s ON s.id = we.session_id GROUP BY s.user_id`,
      ),
      query<{ user_id: string; cnt: number }>(
        `SELECT user_id, COUNT(*)::int AS cnt FROM exercises WHERE user_id IS NOT NULL AND is_custom = 1 GROUP BY user_id`,
      ),
      query<{ user_id: string; cnt: number }>(
        `SELECT user_id, COUNT(*)::int AS cnt FROM schedules GROUP BY user_id`,
      ),
      query<{ user_id: string; cnt: number }>(
        `SELECT user_id, COUNT(*)::int AS cnt FROM body_metrics GROUP BY user_id`,
      ),
      query<{ user_id: string; cnt: number }>(
        `SELECT user_id, COUNT(*)::int AS cnt FROM apple_health_workouts GROUP BY user_id`,
      ),
      query<{ user_id: string; cnt: number; photo_bytes: string | number }>(
        `SELECT user_id, COUNT(*)::int AS cnt, COALESCE(SUM(byte_size + thumb_byte_size), 0)::bigint AS photo_bytes FROM progress_photos GROUP BY user_id`,
      ),
    ]);

    byUserId = new Map<string, UserCountsRow>();
    const ensureRow = (uid: string): UserCountsRow => {
      let row = byUserId.get(uid);
      if (!row) {
        row = {
          user_id: uid,
          sessions_cnt: 0,
          session_exercises_cnt: 0,
          sets_cnt: 0,
          rep_qualities_cnt: 0,
          custom_exercises_cnt: 0,
          schedules_cnt: 0,
          body_metrics_cnt: 0,
          apple_health_cnt: 0,
          photo_cnt: 0,
          photo_bytes: 0,
        };
        byUserId.set(uid, row);
      }
      return row;
    };

    for (const r of sessRows.rows) ensureRow(r.user_id).sessions_cnt = Number(r.cnt);
    for (const r of wexRows.rows) ensureRow(r.user_id).session_exercises_cnt = Number(r.cnt);
    for (const r of wsetRows.rows) ensureRow(r.user_id).sets_cnt = Number(r.cnt);
    for (const r of rqRows.rows) ensureRow(r.user_id).rep_qualities_cnt = Number(r.cnt);
    for (const r of cexRows.rows) ensureRow(r.user_id).custom_exercises_cnt = Number(r.cnt);
    for (const r of schedRows.rows) ensureRow(r.user_id).schedules_cnt = Number(r.cnt);
    for (const r of bmRows.rows) ensureRow(r.user_id).body_metrics_cnt = Number(r.cnt);
    for (const r of ahRows.rows) ensureRow(r.user_id).apple_health_cnt = Number(r.cnt);
    for (const r of photoRows.rows) {
      const target = ensureRow(r.user_id);
      target.photo_cnt = Number(r.cnt);
      target.photo_bytes = r.photo_bytes;
    }
  } else {
    const countsSql = `
      WITH
        sess AS (
          SELECT user_id, COUNT(*)::int AS cnt, COALESCE(SUM(pg_column_size(workout_sessions.*) + 28), 0)::bigint AS bytes
          FROM workout_sessions GROUP BY user_id
        ),
        wex AS (
          SELECT s.user_id, COUNT(*)::int AS cnt, COALESCE(SUM(pg_column_size(we.*) + 28), 0)::bigint AS bytes
          FROM workout_exercises we
          JOIN workout_sessions s ON s.id = we.session_id
          GROUP BY s.user_id
        ),
        wset AS (
          SELECT s.user_id, COUNT(*)::int AS cnt, COALESCE(SUM(pg_column_size(ws.*) + 28), 0)::bigint AS bytes
          FROM workout_sets ws
          JOIN workout_exercises we ON we.id = ws.workout_exercise_id
          JOIN workout_sessions s ON s.id = we.session_id
          GROUP BY s.user_id
        ),
        rq AS (
          SELECT s.user_id, COUNT(*)::int AS cnt, COALESCE(SUM(pg_column_size(rq.*) + 28), 0)::bigint AS bytes
          FROM workout_set_rep_qualities rq
          JOIN workout_sets ws ON ws.id = rq.workout_set_id
          JOIN workout_exercises we ON we.id = ws.workout_exercise_id
          JOIN workout_sessions s ON s.id = we.session_id
          GROUP BY s.user_id
        ),
        cex AS (
          SELECT user_id, COUNT(*)::int AS cnt, COALESCE(SUM(pg_column_size(exercises.*) + 28), 0)::bigint AS bytes
          FROM exercises WHERE user_id IS NOT NULL AND is_custom = 1 GROUP BY user_id
        ),
        sched AS (
          SELECT user_id, COUNT(*)::int AS cnt, COALESCE(SUM(pg_column_size(schedules.*) + 28), 0)::bigint AS bytes
          FROM schedules GROUP BY user_id
        ),
        sdays AS (
          SELECT s.user_id, COALESCE(SUM(pg_column_size(sd.*) + 28), 0)::bigint AS bytes
          FROM schedule_days sd
          JOIN schedules s ON s.id = sd.schedule_id
          GROUP BY s.user_id
        ),
        sdex AS (
          SELECT s.user_id, COALESCE(SUM(pg_column_size(sde.*) + 28), 0)::bigint AS bytes
          FROM schedule_day_exercises sde
          JOIN schedule_days sd ON sd.id = sde.schedule_day_id
          JOIN schedules s ON s.id = sd.schedule_id
          GROUP BY s.user_id
        ),
        sevt AS (
          SELECT user_id, COALESCE(SUM(pg_column_size(schedule_events.*) + 28), 0)::bigint AS bytes
          FROM schedule_events GROUP BY user_id
        ),
        bm AS (
          SELECT user_id, COUNT(*)::int AS cnt, COALESCE(SUM(pg_column_size(body_metrics.*) + 28), 0)::bigint AS bytes
          FROM body_metrics GROUP BY user_id
        ),
        ah AS (
          SELECT user_id, COUNT(*)::int AS cnt, COALESCE(SUM(pg_column_size(apple_health_workouts.*) + 28), 0)::bigint AS bytes
          FROM apple_health_workouts GROUP BY user_id
        ),
        ph AS (
          SELECT
            user_id,
            COUNT(*)::int AS cnt,
            COALESCE(SUM(byte_size + thumb_byte_size), 0)::bigint AS photo_bytes,
            COALESCE(SUM(pg_column_size(progress_photos.*) + 28), 0)::bigint AS meta_bytes
          FROM progress_photos GROUP BY user_id
        ),
        asess AS (
          SELECT user_id, COALESCE(SUM(pg_column_size(auth_sessions.*) + 28), 0)::bigint AS bytes
          FROM auth_sessions GROUP BY user_id
        ),
        akeys AS (
          SELECT user_id, COALESCE(SUM(pg_column_size(api_keys.*) + 28), 0)::bigint AS bytes
          FROM api_keys GROUP BY user_id
        ),
        hex AS (
          SELECT user_id, COALESCE(SUM(pg_column_size(hidden_exercises.*) + 28), 0)::bigint AS bytes
          FROM hidden_exercises GROUP BY user_id
        ),
        uep AS (
          SELECT user_id, COALESCE(SUM(pg_column_size(user_exercise_prefs.*) + 28), 0)::bigint AS bytes
          FROM user_exercise_prefs GROUP BY user_id
        ),
        swp AS (
          SELECT user_id, COALESCE(SUM(pg_column_size(session_swaps.*) + 28), 0)::bigint AS bytes
          FROM session_swaps GROUP BY user_id
        )
      SELECT
        u.id AS user_id,
        COALESCE(sess.cnt, 0) AS sessions_cnt,
        COALESCE(wex.cnt, 0) AS session_exercises_cnt,
        COALESCE(wset.cnt, 0) AS sets_cnt,
        COALESCE(rq.cnt, 0) AS rep_qualities_cnt,
        COALESCE(cex.cnt, 0) AS custom_exercises_cnt,
        COALESCE(sched.cnt, 0) AS schedules_cnt,
        COALESCE(bm.cnt, 0) AS body_metrics_cnt,
        COALESCE(ah.cnt, 0) AS apple_health_cnt,
        COALESCE(ph.cnt, 0) AS photo_cnt,
        COALESCE(ph.photo_bytes, 0)::bigint AS photo_bytes,
        (
          (pg_column_size(u.*) + 28) +
          COALESCE(sess.bytes, 0) +
          COALESCE(wex.bytes, 0) +
          COALESCE(wset.bytes, 0) +
          COALESCE(rq.bytes, 0) +
          COALESCE(cex.bytes, 0) +
          COALESCE(sched.bytes, 0) +
          COALESCE(sdays.bytes, 0) +
          COALESCE(sdex.bytes, 0) +
          COALESCE(sevt.bytes, 0) +
          COALESCE(bm.bytes, 0) +
          COALESCE(ah.bytes, 0) +
          COALESCE(ph.meta_bytes, 0) +
          COALESCE(asess.bytes, 0) +
          COALESCE(akeys.bytes, 0) +
          COALESCE(hex.bytes, 0) +
          COALESCE(uep.bytes, 0) +
          COALESCE(swp.bytes, 0)
        )::bigint AS est_db_bytes
      FROM users u
      LEFT JOIN sess ON sess.user_id = u.id
      LEFT JOIN wex ON wex.user_id = u.id
      LEFT JOIN wset ON wset.user_id = u.id
      LEFT JOIN rq ON rq.user_id = u.id
      LEFT JOIN cex ON cex.user_id = u.id
      LEFT JOIN sched ON sched.user_id = u.id
      LEFT JOIN sdays ON sdays.user_id = u.id
      LEFT JOIN sdex ON sdex.user_id = u.id
      LEFT JOIN sevt ON sevt.user_id = u.id
      LEFT JOIN bm ON bm.user_id = u.id
      LEFT JOIN ah ON ah.user_id = u.id
      LEFT JOIN ph ON ph.user_id = u.id
      LEFT JOIN asess ON asess.user_id = u.id
      LEFT JOIN akeys ON akeys.user_id = u.id
      LEFT JOIN hex ON hex.user_id = u.id
      LEFT JOIN uep ON uep.user_id = u.id
      LEFT JOIN swp ON swp.user_id = u.id
    `;

    const countsRes = await query<UserCountsRow>(countsSql);
    byUserId = new Map(countsRes.rows.map((r) => [r.user_id, r]));
  }

  const out: SnapshotPerUserStorage[] = [];
  for (const u of usersRes.rows) {
    const c = byUserId.get(u.id);
    const counts: SnapshotUserRowCounts = {
      sessions: Number(c?.sessions_cnt ?? 0),
      sessionExercises: Number(c?.session_exercises_cnt ?? 0),
      sets: Number(c?.sets_cnt ?? 0),
      repQualities: Number(c?.rep_qualities_cnt ?? 0),
      customExercises: Number(c?.custom_exercises_cnt ?? 0),
      schedules: Number(c?.schedules_cnt ?? 0),
      bodyMetrics: Number(c?.body_metrics_cnt ?? 0),
      appleHealthWorkouts: Number(c?.apple_health_cnt ?? 0),
    };
    const photoCount = Number(c?.photo_cnt ?? 0);
    const photoBytes = Number(c?.photo_bytes ?? 0);
    const estimatedDbBytes =
      c?.est_db_bytes !== undefined
        ? Number(c.est_db_bytes)
        : 240 +
          counts.sessions * 180 +
          counts.sessionExercises * 96 +
          counts.sets * 96 +
          counts.repQualities * 64 +
          counts.customExercises * 160 +
          counts.schedules * 160 +
          counts.bodyMetrics * 96 +
          counts.appleHealthWorkouts * 160 +
          photoCount * 112;
    const quota =
      u.photo_quota !== null &&
      u.photo_quota !== undefined &&
      Number.isFinite(Number(u.photo_quota))
        ? Math.max(0, Math.floor(Number(u.photo_quota)))
        : DEFAULT_PHOTO_QUOTA;

    out.push({
      userId: u.id,
      username: u.username,
      displayName: u.display_name,
      isGuest: Boolean(u.is_guest),
      isDisabled: Boolean(u.is_disabled),
      lastActiveAt: u.last_active_at,
      createdAt: u.created_at,
      counts,
      estimatedDbBytes,
      photoCount,
      photoBytes,
      photoQuota: quota,
      totalEstimatedBytes: estimatedDbBytes + photoBytes,
    });
  }

  out.sort((a, b) => b.totalEstimatedBytes - a.totalEstimatedBytes);
  return out;
}

async function computeCohorts(pgMem: boolean): Promise<SnapshotRetentionCohort[]> {
  if (!pgMem) {
    const res = await query<{
      cohort_week: string;
      cohort_size: number;
      w0: number;
      w1: number;
      w2: number;
      w4: number;
      w8: number;
    }>(`
      WITH user_cohorts AS (
        SELECT
          id,
          (created_at::timestamptz AT TIME ZONE 'UTC')::date AS signup_date,
          to_char(date_trunc('week', (created_at::timestamptz AT TIME ZONE 'UTC')), 'YYYY-MM-DD') AS cohort_week
        FROM users
        WHERE is_guest = 0
      ),
      user_week_hits AS (
        SELECT DISTINCT
          uc.id AS user_id,
          ((ws.session_date::date - uc.signup_date) / 7)::int AS week_num
        FROM user_cohorts uc
        JOIN workout_sessions ws ON ws.user_id = uc.id
        WHERE ws.session_date ~ '^\\d{4}-\\d{2}-\\d{2}$'
          AND ws.session_date::date >= uc.signup_date
      )
      SELECT
        uc.cohort_week,
        COUNT(DISTINCT uc.id)::int AS cohort_size,
        COUNT(DISTINCT CASE WHEN h.week_num = 0 THEN uc.id END)::int AS w0,
        COUNT(DISTINCT CASE WHEN h.week_num = 1 THEN uc.id END)::int AS w1,
        COUNT(DISTINCT CASE WHEN h.week_num = 2 THEN uc.id END)::int AS w2,
        COUNT(DISTINCT CASE WHEN h.week_num = 4 THEN uc.id END)::int AS w4,
        COUNT(DISTINCT CASE WHEN h.week_num = 8 THEN uc.id END)::int AS w8
      FROM user_cohorts uc
      LEFT JOIN user_week_hits h ON h.user_id = uc.id
      GROUP BY uc.cohort_week
      ORDER BY uc.cohort_week DESC
      LIMIT 16
    `);

    return res.rows.map((r) => ({
      cohortWeek: r.cohort_week,
      cohortSize: Number(r.cohort_size),
      week0: Number(r.w0),
      week1: Number(r.w1),
      week2: Number(r.w2),
      week4: Number(r.w4),
      week8: Number(r.w8),
    }));
  }

  // Fallback for pg-mem
  const usersRes = await query<{ id: string; created_at: string }>(
    'SELECT id, created_at FROM users WHERE is_guest = 0',
  );
  const sessRes = await query<{ user_id: string; session_date: string }>(
    'SELECT DISTINCT user_id, session_date FROM workout_sessions',
  );
  const sessByUser = new Map<string, string[]>();
  for (const s of sessRes.rows) {
    const arr = sessByUser.get(s.user_id) ?? [];
    arr.push(s.session_date);
    sessByUser.set(s.user_id, arr);
  }
  const cohorts = new Map<
    string,
    {
      cohortSize: number;
      w0: Set<string>;
      w1: Set<string>;
      w2: Set<string>;
      w4: Set<string>;
      w8: Set<string>;
    }
  >();
  for (const u of usersRes.rows) {
    const week = getMondayUtcWeek(u.created_at);
    let bucket = cohorts.get(week);
    if (!bucket) {
      bucket = {
        cohortSize: 0,
        w0: new Set(),
        w1: new Set(),
        w2: new Set(),
        w4: new Set(),
        w8: new Set(),
      };
      cohorts.set(week, bucket);
    }
    bucket.cohortSize += 1;
    const signupMs = Date.parse(u.created_at.slice(0, 10) + 'T00:00:00.000Z');
    for (const sd of sessByUser.get(u.id) ?? []) {
      const sdMs = Date.parse(sd + 'T00:00:00.000Z');
      if (!Number.isFinite(sdMs) || !Number.isFinite(signupMs) || sdMs < signupMs) continue;
      const wk = Math.floor((sdMs - signupMs) / (7 * 86_400_000));
      if (wk === 0) bucket.w0.add(u.id);
      if (wk === 1) bucket.w1.add(u.id);
      if (wk === 2) bucket.w2.add(u.id);
      if (wk === 4) bucket.w4.add(u.id);
      if (wk === 8) bucket.w8.add(u.id);
    }
  }
  return Array.from(cohorts.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 16)
    .map(([cohortWeek, b]) => ({
      cohortWeek,
      cohortSize: b.cohortSize,
      week0: b.w0.size,
      week1: b.w1.size,
      week2: b.w2.size,
      week4: b.w4.size,
      week8: b.w8.size,
    }));
}

async function computeCatalogUsage(pgMem: boolean): Promise<SnapshotCatalogUsage> {
  if (pgMem) {
    const [exRes, logsRes] = await Promise.all([
      query<{
        id: string;
        name: string;
        category: string;
        tracking_type: string;
        is_custom: number;
        user_id: string | null;
      }>('SELECT id, name, category, tracking_type, is_custom, user_id FROM exercises'),
      query<{
        exercise_id: string;
        session_id: string;
        user_id: string;
        is_guest: number;
      }>(
        `SELECT we.exercise_id, we.session_id, u.id AS user_id, u.is_guest
         FROM workout_exercises we
         JOIN workout_sessions ws ON ws.id = we.session_id
         JOIN users u ON u.id = ws.user_id`,
      ),
    ]);

    const logCountByEx = new Map<string, number>();
    const usersByEx = new Map<string, Set<string>>();
    const sessionsByEx = new Map<string, Set<string>>();
    for (const row of logsRes.rows) {
      if (row.is_guest) continue;
      logCountByEx.set(row.exercise_id, (logCountByEx.get(row.exercise_id) ?? 0) + 1);
      const us = usersByEx.get(row.exercise_id) ?? new Set<string>();
      us.add(row.user_id);
      usersByEx.set(row.exercise_id, us);
      const ss = sessionsByEx.get(row.exercise_id) ?? new Set<string>();
      ss.add(row.session_id);
      sessionsByEx.set(row.exercise_id, ss);
    }

    const catalogStats: SnapshotCatalogExerciseStat[] = [];
    const customAgg = new Map<
      string,
      { sampleName: string; users: Set<string>; sessions: Set<string> }
    >();
    const guestUsers = new Set(
      logsRes.rows.filter((r) => Boolean(r.is_guest)).map((r) => r.user_id),
    );

    for (const ex of exRes.rows) {
      if (!ex.is_custom) {
        catalogStats.push({
          exerciseId: ex.id,
          name: ex.name,
          category: ex.category,
          trackingType: ex.tracking_type,
          logCount: logCountByEx.get(ex.id) ?? 0,
          userCount: usersByEx.get(ex.id)?.size ?? 0,
        });
      } else if (ex.user_id && !guestUsers.has(ex.user_id)) {
        const norm = ex.name.trim().toLowerCase();
        const item = customAgg.get(norm) ?? {
          sampleName: ex.name,
          users: new Set<string>(),
          sessions: new Set<string>(),
        };
        item.users.add(ex.user_id);
        for (const sid of sessionsByEx.get(ex.id) ?? []) item.sessions.add(sid);
        customAgg.set(norm, item);
      }
    }

    catalogStats.sort((a, b) => b.logCount - a.logCount || a.name.localeCompare(b.name));
    const logged = catalogStats.filter((x) => x.logCount > 0);
    const unused = catalogStats.filter((x) => x.logCount === 0);

    return {
      mostLogged: logged.slice(0, 15),
      leastLogged: [...logged]
        .sort((a, b) => a.logCount - b.logCount || a.name.localeCompare(b.name))
        .slice(0, 15),
      unusedCatalog: unused.slice(0, 100).map((x) => ({
        exerciseId: x.exerciseId,
        name: x.name,
        category: x.category,
        trackingType: x.trackingType,
      })),
      unusedCatalogCount: unused.length,
      customExerciseCandidates: Array.from(customAgg.entries())
        .map(([normalizedName, v]) => ({
          normalizedName,
          sampleName: v.sampleName,
          userCount: v.users.size,
          sessionCount: v.sessions.size,
        }))
        .sort((a, b) => b.userCount - a.userCount || b.sessionCount - a.sessionCount)
        .slice(0, 20),
    };
  }

  const catalogStatsRes = await query<{
    id: string;
    name: string;
    category: string;
    tracking_type: string;
    log_count: number;
    user_count: number;
  }>(`
    SELECT
      e.id,
      e.name,
      e.category,
      e.tracking_type,
      COUNT(we.id)::int AS log_count,
      COUNT(DISTINCT CASE WHEN u.id IS NOT NULL THEN u.id END)::int AS user_count
    FROM exercises e
    LEFT JOIN workout_exercises we ON we.exercise_id = e.id
    LEFT JOIN workout_sessions ws ON ws.id = we.session_id
    LEFT JOIN users u ON u.id = ws.user_id AND u.is_guest = 0
    WHERE e.is_custom = 0
    GROUP BY e.id, e.name, e.category, e.tracking_type
    ORDER BY log_count DESC, e.name ASC
  `);

  const mapped: SnapshotCatalogExerciseStat[] = catalogStatsRes.rows.map((r) => ({
    exerciseId: r.id,
    name: r.name,
    category: r.category,
    trackingType: r.tracking_type,
    logCount: Number(r.log_count),
    userCount: Number(r.user_count),
  }));

  const logged = mapped.filter((x) => x.logCount > 0);
  const mostLogged = logged.slice(0, 15);
  const leastLogged = [...logged]
    .sort((a, b) => a.logCount - b.logCount || a.name.localeCompare(b.name))
    .slice(0, 15);
  const unusedAll = mapped.filter((x) => x.logCount === 0);

  const customRes = await query<{
    norm_name: string;
    sample_name: string;
    user_count: number;
    session_count: number;
  }>(`
    SELECT
      lower(trim(e.name)) AS norm_name,
      MIN(e.name) AS sample_name,
      COUNT(DISTINCT e.user_id)::int AS user_count,
      COUNT(DISTINCT we.session_id)::int AS session_count
    FROM exercises e
    JOIN users u ON u.id = e.user_id AND u.is_guest = 0
    LEFT JOIN workout_exercises we ON we.exercise_id = e.id
    WHERE e.is_custom = 1
    GROUP BY lower(trim(e.name))
    ORDER BY user_count DESC, session_count DESC, norm_name ASC
    LIMIT 20
  `);

  return {
    mostLogged,
    leastLogged,
    unusedCatalog: unusedAll.slice(0, 100).map((x) => ({
      exerciseId: x.exerciseId,
      name: x.name,
      category: x.category,
      trackingType: x.trackingType,
    })),
    unusedCatalogCount: unusedAll.length,
    customExerciseCandidates: customRes.rows.map((r) => ({
      normalizedName: r.norm_name,
      sampleName: r.sample_name,
      userCount: Number(r.user_count),
      sessionCount: Number(r.session_count),
    })),
  };
}

/**
 * Computes user overview using portable CASE WHEN (safe in both pg-mem and Postgres).
 */
async function computeSnapshotOverviewPortable(
  nowMs: number,
): Promise<SnapshotOverviewMetrics> {
  const cutoff1d = addMsIso(nowMs, -1 * 86_400_000);
  const cutoff7d = addMsIso(nowMs, -7 * 86_400_000);
  const cutoff30d = addMsIso(nowMs, -30 * 86_400_000);

  const userRow = await queryOne<{
    total_users: number;
    registered_users: number;
    guest_users: number;
    dau: number;
    wau: number;
    mau: number;
  }>(
    `SELECT
       COUNT(*)::int AS total_users,
       COALESCE(SUM(CASE WHEN is_guest = 0 THEN 1 ELSE 0 END), 0)::int AS registered_users,
       COALESCE(SUM(CASE WHEN is_guest = 1 THEN 1 ELSE 0 END), 0)::int AS guest_users,
       COALESCE(SUM(CASE WHEN last_active_at >= $1 THEN 1 ELSE 0 END), 0)::int AS dau,
       COALESCE(SUM(CASE WHEN last_active_at >= $2 THEN 1 ELSE 0 END), 0)::int AS wau,
       COALESCE(SUM(CASE WHEN last_active_at >= $3 THEN 1 ELSE 0 END), 0)::int AS mau
     FROM users`,
    [cutoff1d, cutoff7d, cutoff30d],
  );

  const evtRow = await queryOne<{ app_dau: number; key_dau: number }>(
    `SELECT
       COUNT(DISTINCT CASE WHEN event_type = 'app_active' THEN user_id END)::int AS app_dau,
       COUNT(DISTINCT CASE WHEN event_type = 'api_key_active' THEN user_id END)::int AS key_dau
     FROM events
     WHERE created_at >= $1 AND event_type IN ('app_active', 'api_key_active')`,
    [cutoff1d],
  );

  const dau = Number(userRow?.dau ?? 0);
  const mau = Number(userRow?.mau ?? 0);
  const stickinessPct =
    mau > 0 ? Math.round((dau / mau) * 1000) / 10 : 0;

  return {
    totalUsers: Number(userRow?.total_users ?? 0),
    registeredUsers: Number(userRow?.registered_users ?? 0),
    guestUsers: Number(userRow?.guest_users ?? 0),
    dau,
    wau: Number(userRow?.wau ?? 0),
    mau,
    stickinessPct,
    appDau: Number(evtRow?.app_dau ?? 0),
    apiKeyDau: Number(evtRow?.key_dau ?? 0),
  };
}

/**
 * Computes and persists today's `daily_snapshots` row.
 */
export async function computeAndSaveDailySnapshot(
  snapshotDate = utcTodayYmd(),
): Promise<DailySnapshotRecord> {
  const pgMem = isPgMemActive();
  const now = new Date();
  const computedAt = now.toISOString();

  const [sizeData, overview, perUserStorage, cohorts, catalogUsage] =
    await Promise.all([
      computeTableSizes(pgMem),
      computeSnapshotOverviewPortable(now.getTime()),
      computePerUserStorage(pgMem),
      computeCohorts(pgMem),
      computeCatalogUsage(pgMem),
    ]);

  await query(
    `INSERT INTO daily_snapshots (
       snapshot_date, computed_at, total_db_bytes, table_sizes_json,
       overview_json, per_user_storage_json, cohorts_json, catalog_usage_json
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (snapshot_date) DO UPDATE SET
       computed_at = EXCLUDED.computed_at,
       total_db_bytes = EXCLUDED.total_db_bytes,
       table_sizes_json = EXCLUDED.table_sizes_json,
       overview_json = EXCLUDED.overview_json,
       per_user_storage_json = EXCLUDED.per_user_storage_json,
       cohorts_json = EXCLUDED.cohorts_json,
       catalog_usage_json = EXCLUDED.catalog_usage_json`,
    [
      snapshotDate,
      computedAt,
      sizeData.totalDbBytes,
      JSON.stringify(sizeData.tableSizes),
      JSON.stringify(overview),
      JSON.stringify(perUserStorage),
      JSON.stringify(cohorts),
      JSON.stringify(catalogUsage),
    ],
  );

  setLastSnapshotDateChecked(snapshotDate);

  return {
    snapshotDate,
    computedAt,
    totalDbBytes: sizeData.totalDbBytes,
    tableSizes: sizeData.tableSizes,
    overview,
    perUserStorage,
    cohorts,
    catalogUsage,
  };
}

function mapSnapshotRow(row: {
  snapshot_date: string;
  computed_at: string;
  total_db_bytes: string | number;
  table_sizes_json: string;
  overview_json: string;
  per_user_storage_json: string;
  cohorts_json: string;
  catalog_usage_json: string;
}): DailySnapshotRecord {
  return {
    snapshotDate: row.snapshot_date,
    computedAt: row.computed_at,
    totalDbBytes: Number(row.total_db_bytes),
    tableSizes: safeJsonParse<TableSizeMetric[]>(row.table_sizes_json, []),
    overview: safeJsonParse<SnapshotOverviewMetrics>(row.overview_json, {
      totalUsers: 0,
      registeredUsers: 0,
      guestUsers: 0,
      dau: 0,
      wau: 0,
      mau: 0,
      stickinessPct: 0,
      appDau: 0,
      apiKeyDau: 0,
    }),
    perUserStorage: safeJsonParse<SnapshotPerUserStorage[]>(
      row.per_user_storage_json,
      [],
    ),
    cohorts: safeJsonParse<SnapshotRetentionCohort[]>(row.cohorts_json, []),
    catalogUsage: safeJsonParse<SnapshotCatalogUsage>(row.catalog_usage_json, {
      mostLogged: [],
      leastLogged: [],
      unusedCatalog: [],
      unusedCatalogCount: 0,
      customExerciseCandidates: [],
    }),
  };
}

export async function getLatestDailySnapshot(): Promise<DailySnapshotRecord | null> {
  const row = await queryOne<{
    snapshot_date: string;
    computed_at: string;
    total_db_bytes: string | number;
    table_sizes_json: string;
    overview_json: string;
    per_user_storage_json: string;
    cohorts_json: string;
    catalog_usage_json: string;
  }>(
    `SELECT snapshot_date, computed_at, total_db_bytes, table_sizes_json,
            overview_json, per_user_storage_json, cohorts_json, catalog_usage_json
     FROM daily_snapshots
     ORDER BY snapshot_date DESC
     LIMIT 1`,
  );
  return row ? mapSnapshotRow(row) : null;
}

/**
 * Ensures at most one daily snapshot per UTC day, piggybacking opportunistically
 * on scheduled maintenance or admin reads when no snapshot exists for today.
 */
export async function ensureDailySnapshotIfDue(
  force = false,
): Promise<DailySnapshotRecord | null> {
  if (!hasActivePool()) return null;
  const today = utcTodayYmd();

  if (!force && getLastSnapshotDateChecked() === today) {
    return await getLatestDailySnapshot();
  }

  try {
    if (!force) {
      const existing = await queryOne<{
        snapshot_date: string;
        computed_at: string;
        total_db_bytes: string | number;
        table_sizes_json: string;
        overview_json: string;
        per_user_storage_json: string;
        cohorts_json: string;
        catalog_usage_json: string;
      }>(
        `SELECT snapshot_date, computed_at, total_db_bytes, table_sizes_json,
                overview_json, per_user_storage_json, cohorts_json, catalog_usage_json
         FROM daily_snapshots
         WHERE snapshot_date = $1`,
        [today],
      );
      if (existing) {
        setLastSnapshotDateChecked(today);
        return mapSnapshotRow(existing);
      }
    }

    return await computeAndSaveDailySnapshot(today);
  } catch (err) {
    logger.warn('failed to run opportunistic daily snapshot', { err });
    return null;
  }
}

export async function getLiveCatalogUsage(): Promise<SnapshotCatalogUsage> {
  return await computeCatalogUsage(isPgMemActive());
}

export async function listSnapshotTrends(
  limit = 30,
): Promise<SnapshotTrendPoint[]> {
  const safeLimit = Math.max(1, Math.min(365, Math.round(limit)));
  const res = await query<{
    snapshot_date: string;
    computed_at: string;
    total_db_bytes: string | number;
    overview_json: string;
  }>(
    `SELECT snapshot_date, computed_at, total_db_bytes, overview_json
     FROM daily_snapshots
     ORDER BY snapshot_date DESC
     LIMIT $1`,
    [safeLimit],
  );

  return res.rows
    .reverse()
    .map((r) => {
      const ov = safeJsonParse<SnapshotOverviewMetrics>(r.overview_json, {
        totalUsers: 0,
        registeredUsers: 0,
        guestUsers: 0,
        dau: 0,
        wau: 0,
        mau: 0,
        stickinessPct: 0,
        appDau: 0,
        apiKeyDau: 0,
      });
      return {
        snapshotDate: r.snapshot_date,
        computedAt: r.computed_at,
        totalDbBytes: Number(r.total_db_bytes),
        totalUsers: ov.totalUsers,
        registeredUsers: ov.registeredUsers,
        guestUsers: ov.guestUsers,
        dau: ov.dau,
        wau: ov.wau,
        mau: ov.mau,
        stickinessPct: ov.stickinessPct,
        appDau: ov.appDau,
        apiKeyDau: ov.apiKeyDau,
      };
    });
}
