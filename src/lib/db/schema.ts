import type { Pool, PoolClient } from 'pg';
import { EXERCISE_CATALOG } from '@/lib/exercises/catalog';
import { logger } from '@/lib/logger';
import { deriveCatalogWeightStepKg } from '@/lib/workouts/stepSize';

/**
 * Informational schema revision recorded in `schema_version` on initSchema().
 * Not read at runtime or used as a migration runner; schema changes are applied
 * idempotently via `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`.
 */
export const SCHEMA_VERSION = 2;

const SCHEMA_V2_DDL = `
  CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    height_cm DOUBLE PRECISION,
    weight_kg DOUBLE PRECISION NOT NULL DEFAULT 75,
    age INTEGER,
    training_years DOUBLE PRECISION,
    unit TEXT NOT NULL DEFAULT 'kg' CHECK (unit IN ('kg', 'lb')),
    timezone TEXT NOT NULL DEFAULT 'UTC',
    theme TEXT NOT NULL DEFAULT 'notebook' CHECK (theme IN ('notebook', 'cutecore', 'analog-horror', 'brazilian-phonk', 'future-funk', 'lofi-art')),
    theme_variant TEXT NOT NULL DEFAULT 'light' CHECK (theme_variant IN ('light', 'dark')),
    enable_set_quality INTEGER NOT NULL DEFAULT 0 CHECK (enable_set_quality IN (0, 1)),
    rest_clock_mode TEXT NOT NULL DEFAULT 'stopwatch' CHECK (rest_clock_mode IN ('stopwatch', 'countdown')),
    default_workout_view TEXT NOT NULL DEFAULT 'list' CHECK (default_workout_view IN ('list', 'focus')),
    default_weight_step_kg DOUBLE PRECISION,
    apple_fitness_enabled INTEGER NOT NULL DEFAULT 1 CHECK (apple_fitness_enabled IN (0, 1)),
    apple_health_last_received_at TEXT,
    apple_health_last_received_kind TEXT CHECK (apple_health_last_received_kind IS NULL OR apple_health_last_received_kind IN ('workout', 'weight', 'both')),
    apple_health_last_received_linked INTEGER CHECK (apple_health_last_received_linked IS NULL OR apple_health_last_received_linked IN (0, 1)),
    photo_quota INTEGER,
    is_guest INTEGER NOT NULL DEFAULT 0 CHECK (is_guest IN (0, 1)),
    last_active_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_users_guest_active ON users (is_guest, last_active_at);

  CREATE TABLE IF NOT EXISTS body_metrics (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    measured_on TEXT NOT NULL,
    weight_kg DOUBLE PRECISION NOT NULL,
    source TEXT NOT NULL DEFAULT 'settings',
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_body_metrics_user_date ON body_metrics (user_id, measured_on DESC);

  CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions (user_id);

  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    user_id TEXT UNIQUE NOT NULL,
    key_hash TEXT UNIQUE NOT NULL,
    key_prefix TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_used_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS exercises (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    tracking_type TEXT NOT NULL CHECK (
      tracking_type IN (
        'weight_reps', 'bodyweight_reps', 'weighted_bodyweight',
        'assisted_bodyweight', 'time', 'weight_time', 'distance', 'distance_time'
      )
    ),
    equipment TEXT NOT NULL DEFAULT 'other',
    category TEXT NOT NULL DEFAULT 'other',
    default_rest_seconds INTEGER NOT NULL DEFAULT 120,
    weight_step_kg DOUBLE PRECISION,
    is_custom INTEGER NOT NULL DEFAULT 0 CHECK (is_custom IN (0, 1)),
    aliases_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_exercises_user ON exercises (user_id, is_custom);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_exercises_user_slug ON exercises (COALESCE(user_id, '__global__'), slug);

  CREATE TABLE IF NOT EXISTS hidden_exercises (
    user_id TEXT NOT NULL,
    exercise_id TEXT NOT NULL,
    hidden_at TEXT NOT NULL,
    PRIMARY KEY (user_id, exercise_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS user_exercise_prefs (
    user_id TEXT NOT NULL,
    exercise_id TEXT NOT NULL,
    weight_step_kg DOUBLE PRECISION,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, exercise_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_user_ex_prefs_user ON user_exercise_prefs (user_id);

  CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    rotation_anchor_date TEXT NOT NULL,
    rotation_anchor_index INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_schedules_user_active ON schedules (user_id, is_active);

  CREATE TABLE IF NOT EXISTS schedule_days (
    id TEXT PRIMARY KEY,
    schedule_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    label TEXT NOT NULL,
    is_rest_day INTEGER NOT NULL DEFAULT 0 CHECK (is_rest_day IN (0, 1)),
    FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE,
    UNIQUE (schedule_id, position)
  );

  CREATE TABLE IF NOT EXISTS schedule_day_exercises (
    id TEXT PRIMARY KEY,
    schedule_day_id TEXT NOT NULL,
    exercise_id TEXT NOT NULL,
    order_index INTEGER NOT NULL,
    target_sets INTEGER NOT NULL DEFAULT 3,
    target_reps INTEGER,
    target_reps_min INTEGER,
    target_reps_max INTEGER,
    target_time_seconds INTEGER,
    target_weight_kg DOUBLE PRECISION,
    target_distance_m DOUBLE PRECISION,
    rest_seconds INTEGER NOT NULL DEFAULT 120,
    notes TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (schedule_day_id) REFERENCES schedule_days(id) ON DELETE CASCADE,
    FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE RESTRICT
  );
  CREATE INDEX IF NOT EXISTS idx_sched_day_ex_order ON schedule_day_exercises (schedule_day_id, order_index);

  CREATE TABLE IF NOT EXISTS schedule_events (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    schedule_id TEXT NOT NULL,
    event_date TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (
      event_type IN ('skip', 'postpone', 'reset', 'jolly_extra', 'jolly_instead')
    ),
    shift_days INTEGER,
    jolly_label TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_sched_events_user_date ON schedule_events (user_id, schedule_id, event_date);

  CREATE TABLE IF NOT EXISTS workout_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    session_date TEXT NOT NULL,
    schedule_id TEXT,
    schedule_day_id TEXT,
    is_jolly INTEGER NOT NULL DEFAULT 0 CHECK (is_jolly IN (0, 1)),
    jolly_mode TEXT CHECK (jolly_mode IS NULL OR jolly_mode IN ('extra', 'instead')),
    title TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    duration_minutes INTEGER,
    user_weight_kg DOUBLE PRECISION,
    notes TEXT NOT NULL DEFAULT '',
    apple_watch_kcal INTEGER,
    apple_watch_avg_hr INTEGER,
    apple_watch_max_hr INTEGER,
    cid TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE SET NULL,
    FOREIGN KEY (schedule_day_id) REFERENCES schedule_days(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user_date ON workout_sessions (user_id, session_date DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_user_cid ON workout_sessions (user_id, cid) WHERE cid IS NOT NULL;

  CREATE TABLE IF NOT EXISTS workout_exercises (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    exercise_id TEXT NOT NULL,
    order_index INTEGER NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (session_id) REFERENCES workout_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE RESTRICT
  );
  CREATE INDEX IF NOT EXISTS idx_workout_ex_order ON workout_exercises (session_id, order_index);

  CREATE TABLE IF NOT EXISTS workout_sets (
    id TEXT PRIMARY KEY,
    workout_exercise_id TEXT NOT NULL,
    set_number INTEGER NOT NULL,
    weight_kg DOUBLE PRECISION,
    reps INTEGER,
    time_seconds INTEGER,
    distance_m DOUBLE PRECISION,
    rest_seconds INTEGER,
    actual_rest_seconds INTEGER,
    rest_approximate INTEGER NOT NULL DEFAULT 0 CHECK (rest_approximate IN (0, 1)),
    execution_quality_pct INTEGER CHECK (execution_quality_pct IS NULL OR (execution_quality_pct BETWEEN 0 AND 100)),
    is_completed INTEGER NOT NULL DEFAULT 1 CHECK (is_completed IN (0, 1)),
    created_at TEXT NOT NULL,
    FOREIGN KEY (workout_exercise_id) REFERENCES workout_exercises(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_workout_sets_ex ON workout_sets (workout_exercise_id, set_number);

  CREATE TABLE IF NOT EXISTS workout_set_rep_qualities (
    id TEXT PRIMARY KEY,
    workout_set_id TEXT NOT NULL,
    rep_index INTEGER NOT NULL,
    quality_pct INTEGER NOT NULL CHECK (quality_pct BETWEEN 0 AND 100),
    FOREIGN KEY (workout_set_id) REFERENCES workout_sets(id) ON DELETE CASCADE,
    UNIQUE (workout_set_id, rep_index)
  );

  CREATE TABLE IF NOT EXISTS apple_health_workouts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    workout_type TEXT NOT NULL,
    started_at TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL,
    active_calories INTEGER,
    avg_heart_rate INTEGER,
    max_heart_rate INTEGER,
    bodyweight_kg DOUBLE PRECISION,
    linked_session_id TEXT,
    source TEXT NOT NULL DEFAULT 'shortcut_webhook',
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (linked_session_id) REFERENCES workout_sessions(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_apple_health_user ON apple_health_workouts (user_id, started_at DESC);

  CREATE TABLE IF NOT EXISTS session_swaps (
    user_id TEXT NOT NULL,
    date_key TEXT NOT NULL,
    schedule_day_exercise_id TEXT NOT NULL,
    exercise_id TEXT NOT NULL,
    PRIMARY KEY (user_id, date_key, schedule_day_exercise_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS progress_photos (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    taken_on TEXT NOT NULL,
    pose TEXT NOT NULL CHECK (pose IN ('front', 'side', 'back')),
    weight_kg DOUBLE PRECISION,
    byte_size INTEGER NOT NULL,
    thumb_byte_size INTEGER NOT NULL,
    width INTEGER,
    height INTEGER,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_progress_photos_user_date ON progress_photos (user_id, taken_on DESC, created_at DESC);

  CREATE TABLE IF NOT EXISTS progress_photo_blobs (
    photo_id TEXT PRIMARY KEY,
    full_bytes BYTEA NOT NULL,
    thumb_bytes BYTEA NOT NULL,
    FOREIGN KEY (photo_id) REFERENCES progress_photos(id) ON DELETE CASCADE
  );
`;

function defaultRestForCategory(category: string): number {
  if (category === 'core' || category === 'cardio') return 60;
  return 120;
}

function isPool(client: Pool | PoolClient): client is Pool {
  return (
    typeof (client as Pool).connect === 'function' &&
    typeof (client as PoolClient).release !== 'function'
  );
}

async function withDirectClient<T>(
  clientOrPool: Pool | PoolClient,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  if (isPool(clientOrPool)) {
    const conn = await clientOrPool.connect();
    try {
      return await fn(conn);
    } finally {
      conn.release();
    }
  }
  return fn(clientOrPool);
}

/**
 * Idempotently syncs EXERCISE_CATALOG into the `exercises` table (is_custom = 0).
 */
export async function syncExerciseCatalog(
  clientOrPool: Pool | PoolClient,
): Promise<void> {
  if (EXERCISE_CATALOG.length === 0) return;

  const now = new Date().toISOString();
  const batchSize = 100;

  await withDirectClient(clientOrPool, async (client) => {
    await client.query('BEGIN');
    try {
      for (let i = 0; i < EXERCISE_CATALOG.length; i += batchSize) {
        const chunk = EXERCISE_CATALOG.slice(i, i + batchSize);
        const params: unknown[] = [];
        const valuesSql: string[] = [];

        for (const ex of chunk) {
          const base = params.length;
          valuesSql.push(
            `($${base + 1}, NULL, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, 0, $${base + 9}, $${base + 10})`,
          );
          params.push(
            ex.id,
            ex.id,
            ex.name,
            ex.trackingType,
            ex.equipment,
            ex.category,
            defaultRestForCategory(ex.category),
            deriveCatalogWeightStepKg(ex),
            JSON.stringify(ex.aliases ?? []),
            now,
          );
        }

        await client.query(
          `
          INSERT INTO exercises (
            id, user_id, slug, name, tracking_type, equipment, category,
            default_rest_seconds, weight_step_kg, is_custom, aliases_json, created_at
          ) VALUES ${valuesSql.join(', ')}
          ON CONFLICT (id) DO UPDATE SET
            slug = EXCLUDED.slug,
            name = EXCLUDED.name,
            tracking_type = EXCLUDED.tracking_type,
            equipment = EXCLUDED.equipment,
            category = EXCLUDED.category,
            weight_step_kg = EXCLUDED.weight_step_kg,
            aliases_json = EXCLUDED.aliases_json
          WHERE exercises.is_custom = 0
          `,
          params,
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore rollback error if connection closed
      }
      throw err;
    }
  });
}

/**
 * Applies schema v2 DDL, runs forward-only additive migrations,
 * records schema_version = 2, and syncs EXERCISE_CATALOG.
 * Executes directly against the passed Pool/PoolClient to avoid recursive ensureSchema() calls.
 * Does NOT seed any real or demo users.
 */
export async function initSchema(
  clientOrPool: Pool | PoolClient,
): Promise<void> {
  await withDirectClient(clientOrPool, async (client) => {
    const existingRes = await client.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    const existingTables = new Set(
      existingRes.rows.map((r) => r.table_name.toLowerCase()),
    );

    if (existingTables.size === 0) {
      await client.query(SCHEMA_V2_DDL);
    } else {
      const statements = SCHEMA_V2_DDL.split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      for (const stmt of statements) {
        const match = /^CREATE TABLE IF NOT EXISTS ([a-z_]+)\b/i.exec(stmt);
        if (match && existingTables.has(match[1].toLowerCase())) {
          continue;
        }
        await client.query(stmt);
      }
    }

    await client.query(
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS theme TEXT NOT NULL DEFAULT 'notebook' CHECK (theme IN ('notebook', 'cutecore', 'analog-horror', 'brazilian-phonk', 'future-funk', 'lofi-art'))",
    );
    await client.query(
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS theme_variant TEXT NOT NULL DEFAULT 'light' CHECK (theme_variant IN ('light', 'dark'))",
    );
    await client.query(
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS rest_clock_mode TEXT NOT NULL DEFAULT 'stopwatch' CHECK (rest_clock_mode IN ('stopwatch', 'countdown'))",
    );
    await client.query(
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS default_workout_view TEXT NOT NULL DEFAULT 'list' CHECK (default_workout_view IN ('list', 'focus'))",
    );
    await client.query(
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS default_weight_step_kg DOUBLE PRECISION',
    );
    await client.query(
      'ALTER TABLE exercises ADD COLUMN IF NOT EXISTS weight_step_kg DOUBLE PRECISION',
    );
    await client.query(
      'ALTER TABLE workout_sets ADD COLUMN IF NOT EXISTS actual_rest_seconds INTEGER',
    );
    await client.query(
      'ALTER TABLE workout_sets ADD COLUMN IF NOT EXISTS rest_approximate INTEGER NOT NULL DEFAULT 0 CHECK (rest_approximate IN (0, 1))',
    );
    await client.query(
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS apple_health_last_received_at TEXT',
    );
    await client.query(
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS apple_health_last_received_kind TEXT CHECK (apple_health_last_received_kind IS NULL OR apple_health_last_received_kind IN ('workout', 'weight', 'both'))",
    );
    await client.query(
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS apple_health_last_received_linked INTEGER CHECK (apple_health_last_received_linked IS NULL OR apple_health_last_received_linked IN (0, 1))',
    );
    await client.query(
      'ALTER TABLE apple_health_workouts ALTER COLUMN active_calories DROP NOT NULL',
    );
    await client.query(
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_quota INTEGER',
    );

    // Approved Phase 5 non-additive cleanup: remove existing duplicate
    // (user_id, started_at, workout_type) rows keeping the newest (created_at DESC, id DESC)
    // before enforcing the unique index. Idempotent across both PostgreSQL and pg-mem.
    const allAhRes = await client.query<{
      id: string;
      user_id: string;
      started_at: string;
      workout_type: string;
      created_at: string;
    }>(
      `SELECT id, user_id, started_at, workout_type, created_at
       FROM apple_health_workouts
       ORDER BY created_at DESC, id DESC`,
    );

    const seenAhKeys = new Map<string, Map<string, Set<string>>>();
    const duplicateIds: string[] = [];
    for (const row of allAhRes.rows) {
      let byStart = seenAhKeys.get(row.user_id);
      if (!byStart) {
        byStart = new Map();
        seenAhKeys.set(row.user_id, byStart);
      }
      let types = byStart.get(row.started_at);
      if (!types) {
        types = new Set();
        byStart.set(row.started_at, types);
      }
      if (types.has(row.workout_type)) {
        duplicateIds.push(row.id);
      } else {
        types.add(row.workout_type);
      }
    }

    let removedDuplicates = 0;
    const batchSize = 500;
    for (let i = 0; i < duplicateIds.length; i += batchSize) {
      const chunk = duplicateIds.slice(i, i + batchSize);
      const placeholders = chunk.map((_, idx) => `$${idx + 1}`).join(',');
      const delRes = await client.query(
        `DELETE FROM apple_health_workouts WHERE id IN (${placeholders})`,
        chunk,
      );
      removedDuplicates += delRes.rowCount ?? chunk.length;
    }

    if (removedDuplicates > 0) {
      logger.info('removed duplicate apple_health_workouts rows', {
        removedCount: removedDuplicates,
      });
    }
    await client.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_apple_health_user_start_type ON apple_health_workouts (user_id, started_at, workout_type)',
    );

    const now = new Date().toISOString();
    await client.query(
      'INSERT INTO schema_version (version, applied_at) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [SCHEMA_VERSION, now],
    );

    await syncExerciseCatalog(client);
  });
}
