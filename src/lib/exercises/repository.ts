import crypto from 'node:crypto';
import type { Exercise, TrackingType } from '@/types/domain';
import { query, queryOne } from '@/lib/db/connection';

type DbExerciseRow = {
  id: string;
  user_id: string | null;
  slug: string;
  name: string;
  tracking_type: TrackingType;
  equipment: string;
  category: string;
  default_rest_seconds: number;
  weight_step_kg: number | null;
  is_custom: number;
  aliases_json: string;
  created_at: string;
  is_hidden?: number;
  user_weight_step_kg?: number | null;
};

type DbUserExercisePrefRow = {
  user_id: string;
  exercise_id: string;
  weight_step_kg: number | null;
  updated_at: string;
};

export interface UserExercisePref {
  userId: string;
  exerciseId: string;
  weightStepKg: number | null;
  updatedAt: string;
}

export interface ExerciseFilter {
  query?: string;
  category?: string;
  trackingType?: TrackingType;
  includeHidden?: boolean;
}

export interface CreateCustomExerciseInput {
  name: string;
  trackingType: TrackingType;
  equipment?: string;
  category?: string;
  defaultRestSeconds?: number;
  weightStepKg?: number | null;
  aliases?: string[];
}

export interface UpdateCustomExerciseInput {
  name?: string;
  trackingType?: TrackingType;
  equipment?: string;
  category?: string;
  defaultRestSeconds?: number;
  weightStepKg?: number | null;
  aliases?: string[];
}

function parseAliases(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string')
      : [];
  } catch {
    return [];
  }
}

function mapExerciseRow(row: DbExerciseRow): Exercise {
  return {
    id: row.id,
    userId: row.user_id,
    slug: row.slug,
    name: row.name,
    trackingType: row.tracking_type,
    equipment: row.equipment,
    category: row.category,
    defaultRestSeconds: Number(row.default_rest_seconds),
    weightStepKg:
      row.weight_step_kg === null || row.weight_step_kg === undefined
        ? null
        : Number(row.weight_step_kg),
    userWeightStepKg:
      row.user_weight_step_kg === null || row.user_weight_step_kg === undefined
        ? null
        : Number(row.user_weight_step_kg),
    isCustom: Boolean(row.is_custom),
    isHidden: Boolean(row.is_hidden),
    aliases: parseAliases(row.aliases_json),
    createdAt: row.created_at,
  };
}

function slugifyName(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'custom-exercise';
}

export async function listExercises(
  userId: string,
  filter: ExerciseFilter = {},
): Promise<Exercise[]> {
  const params: Array<string | number> = [userId, userId];
  const clauses = ['(e.user_id IS NULL OR e.user_id = $2)'];

  if (!filter.includeHidden) {
    clauses.push('he.exercise_id IS NULL');
  }
  if (filter.category) {
    params.push(filter.category);
    clauses.push(`e.category = $${params.length}`);
  }
  if (filter.trackingType) {
    params.push(filter.trackingType);
    clauses.push(`e.tracking_type = $${params.length}`);
  }

  const { rows } = await query<DbExerciseRow>(
    `
      SELECT
        e.*,
        CASE WHEN he.exercise_id IS NOT NULL THEN 1 ELSE 0 END AS is_hidden,
        uep.weight_step_kg AS user_weight_step_kg
      FROM exercises e
      LEFT JOIN hidden_exercises he
        ON he.exercise_id = e.id AND he.user_id = $1
      LEFT JOIN user_exercise_prefs uep
        ON uep.exercise_id = e.id AND uep.user_id = $1
      WHERE ${clauses.join(' AND ')}
      ORDER BY e.is_custom DESC, e.name ASC
    `,
    params,
  );

  const mapped = rows.map(mapExerciseRow);
  const q = filter.query?.trim().toLowerCase();
  if (!q) return mapped;

  return mapped.filter(
    (ex) =>
      ex.name.toLowerCase().includes(q) ||
      ex.aliases.some((alias) => alias.toLowerCase().includes(q)),
  );
}

export async function getExerciseById(
  userId: string,
  exerciseId: string,
): Promise<Exercise | null> {
  const row = await queryOne<DbExerciseRow>(
    `
      SELECT
        e.*,
        CASE WHEN he.exercise_id IS NOT NULL THEN 1 ELSE 0 END AS is_hidden,
        uep.weight_step_kg AS user_weight_step_kg
      FROM exercises e
      LEFT JOIN hidden_exercises he
        ON he.exercise_id = e.id AND he.user_id = $1
      LEFT JOIN user_exercise_prefs uep
        ON uep.exercise_id = e.id AND uep.user_id = $1
      WHERE e.id = $2 AND (e.user_id IS NULL OR e.user_id = $3)
    `,
    [userId, exerciseId, userId],
  );

  return row ? mapExerciseRow(row) : null;
}

/**
 * Case-insensitive exact match on exercise name or aliases, preferring user's custom exercises.
 */
export async function findExerciseByNameOrAlias(
  userId: string,
  name: string,
): Promise<Exercise | null> {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return null;

  const all = await listExercises(userId, { includeHidden: true });
  // Prefer exact name match (custom first because listExercises orders is_custom DESC)
  const exactName = all.find((ex) => ex.name.toLowerCase() === normalized);
  if (exactName) return exactName;

  const exactAlias = all.find((ex) =>
    ex.aliases.some((alias) => alias.toLowerCase() === normalized),
  );
  return exactAlias ?? null;
}

export async function createCustomExercise(
  userId: string,
  input: CreateCustomExerciseInput,
): Promise<Exercise> {
  const id = `ex_${crypto.randomUUID()}`;
  const baseSlug = slugifyName(input.name);
  const uniqueSuffix = crypto.randomBytes(3).toString('hex');
  const slug = `${baseSlug}-${uniqueSuffix}`;
  const now = new Date().toISOString();

  await query(
    `
    INSERT INTO exercises (
      id, user_id, slug, name, tracking_type, equipment, category,
      default_rest_seconds, weight_step_kg, is_custom, aliases_json, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, $10, $11)
  `,
    [
      id,
      userId,
      slug,
      input.name.trim(),
      input.trackingType,
      input.equipment?.trim() || 'other',
      input.category?.trim() || 'other',
      input.defaultRestSeconds ?? 120,
      input.weightStepKg ?? null,
      JSON.stringify(input.aliases ?? []),
      now,
    ],
  );

  const created = await getExerciseById(userId, id);
  if (!created) {
    throw new Error('Failed to load created custom exercise');
  }
  return created;
}

export async function updateCustomExercise(
  userId: string,
  exerciseId: string,
  patch: UpdateCustomExerciseInput,
): Promise<Exercise | null> {
  const existing = await queryOne<{ id: string }>(
    'SELECT id FROM exercises WHERE id = $1 AND user_id = $2 AND is_custom = 1',
    [exerciseId, userId],
  );

  if (!existing) return null;

  const setClauses: string[] = [];
  const params: Array<string | number | null> = [];

  if (patch.name !== undefined) {
    params.push(patch.name.trim());
    setClauses.push(`name = $${params.length}`);
  }
  if (patch.trackingType !== undefined) {
    params.push(patch.trackingType);
    setClauses.push(`tracking_type = $${params.length}`);
  }
  if (patch.equipment !== undefined) {
    params.push(patch.equipment.trim() || 'other');
    setClauses.push(`equipment = $${params.length}`);
  }
  if (patch.category !== undefined) {
    params.push(patch.category.trim() || 'other');
    setClauses.push(`category = $${params.length}`);
  }
  if (patch.defaultRestSeconds !== undefined) {
    params.push(patch.defaultRestSeconds);
    setClauses.push(`default_rest_seconds = $${params.length}`);
  }
  if (patch.weightStepKg !== undefined) {
    params.push(patch.weightStepKg);
    setClauses.push(`weight_step_kg = $${params.length}`);
  }
  if (patch.aliases !== undefined) {
    params.push(JSON.stringify(patch.aliases));
    setClauses.push(`aliases_json = $${params.length}`);
  }

  if (setClauses.length > 0) {
    params.push(exerciseId, userId);
    await query(
      `UPDATE exercises SET ${setClauses.join(', ')} WHERE id = $${params.length - 1} AND user_id = $${params.length} AND is_custom = 1`,
      params,
    );
  }

  return getExerciseById(userId, exerciseId);
}

export async function deleteCustomExercise(
  userId: string,
  exerciseId: string,
): Promise<{ deleted: boolean; reason?: 'not_found' | 'not_custom' | 'referenced' }> {
  const existing = await queryOne<{
    id: string;
    user_id: string | null;
    is_custom: number;
  }>(
    'SELECT id, user_id, is_custom FROM exercises WHERE id = $1 AND (user_id IS NULL OR user_id = $2)',
    [exerciseId, userId],
  );

  if (!existing) {
    return { deleted: false, reason: 'not_found' };
  }
  if (!existing.is_custom || existing.user_id !== userId) {
    return { deleted: false, reason: 'not_custom' };
  }

  const refWorkout = await queryOne(
    'SELECT 1 AS found FROM workout_exercises WHERE exercise_id = $1 LIMIT 1',
    [exerciseId],
  );
  const refSchedule = await queryOne(
    'SELECT 1 AS found FROM schedule_day_exercises WHERE exercise_id = $1 LIMIT 1',
    [exerciseId],
  );

  if (refWorkout || refSchedule) {
    return { deleted: false, reason: 'referenced' };
  }

  await query(
    'DELETE FROM exercises WHERE id = $1 AND user_id = $2 AND is_custom = 1',
    [exerciseId, userId],
  );
  return { deleted: true };
}

export async function setExerciseHidden(
  userId: string,
  exerciseId: string,
  hidden: boolean,
): Promise<boolean> {
  const exists = await queryOne<{ id: string }>(
    'SELECT id FROM exercises WHERE id = $1 AND (user_id IS NULL OR user_id = $2)',
    [exerciseId, userId],
  );

  if (!exists) return false;

  if (hidden) {
    await query(
      'INSERT INTO hidden_exercises (user_id, exercise_id, hidden_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [userId, exerciseId, new Date().toISOString()],
    );
  } else {
    await query(
      'DELETE FROM hidden_exercises WHERE user_id = $1 AND exercise_id = $2',
      [userId, exerciseId],
    );
  }
  return true;
}

function mapUserExercisePrefRow(row: DbUserExercisePrefRow): UserExercisePref {
  return {
    userId: row.user_id,
    exerciseId: row.exercise_id,
    weightStepKg:
      row.weight_step_kg === null || row.weight_step_kg === undefined
        ? null
        : Number(row.weight_step_kg),
    updatedAt: row.updated_at,
  };
}

/**
 * Lists all per-exercise step preference overrides for `userId`.
 */
export async function listUserExercisePrefs(
  userId: string,
): Promise<UserExercisePref[]> {
  const { rows } = await query<DbUserExercisePrefRow>(
    'SELECT * FROM user_exercise_prefs WHERE user_id = $1 ORDER BY exercise_id ASC',
    [userId],
  );
  return rows.map(mapUserExercisePrefRow);
}

/**
 * Reads a single `user_exercise_prefs` row for `(userId, exerciseId)`.
 */
export async function getUserExercisePref(
  userId: string,
  exerciseId: string,
): Promise<UserExercisePref | null> {
  const row = await queryOne<DbUserExercisePrefRow>(
    'SELECT * FROM user_exercise_prefs WHERE user_id = $1 AND exercise_id = $2',
    [userId, exerciseId],
  );
  return row ? mapUserExercisePrefRow(row) : null;
}

/**
 * Upserts a per-user weight step override in `user_exercise_prefs`.
 */
export async function upsertUserExerciseStepPref(
  userId: string,
  exerciseId: string,
  weightStepKg: number,
): Promise<UserExercisePref> {
  const now = new Date().toISOString();
  const row = await queryOne<DbUserExercisePrefRow>(
    `
    INSERT INTO user_exercise_prefs (user_id, exercise_id, weight_step_kg, updated_at)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (user_id, exercise_id) DO UPDATE SET
      weight_step_kg = EXCLUDED.weight_step_kg,
      updated_at = EXCLUDED.updated_at
    RETURNING *
    `,
    [userId, exerciseId, weightStepKg, now],
  );
  return mapUserExercisePrefRow(row!);
}

/**
 * Deletes the `user_exercise_prefs` override row for `(userId, exerciseId)`.
 */
export async function deleteUserExerciseStepPref(
  userId: string,
  exerciseId: string,
): Promise<boolean> {
  const res = await query(
    'DELETE FROM user_exercise_prefs WHERE user_id = $1 AND exercise_id = $2',
    [userId, exerciseId],
  );
  return Number(res.rowCount ?? 0) > 0;
}

/**
 * Updates or resets the weight step for an exercise from a user's perspective:
 * - For a custom exercise owned by `userId`, updates `exercises.weight_step_kg` directly
 *   (never creating a `user_exercise_prefs` row).
 * - For a shared catalog exercise (not owned by `userId`), upserts or deletes the
 *   user's override row in `user_exercise_prefs` without touching `exercises`.
 */
export async function setExerciseWeightStepForUser(
  userId: string,
  exerciseId: string,
  weightStepKg: number | null,
): Promise<Exercise | null> {
  const existing = await getExerciseById(userId, exerciseId);
  if (!existing) return null;

  if (existing.isCustom && existing.userId === userId) {
    return updateCustomExercise(userId, exerciseId, { weightStepKg });
  }

  if (weightStepKg === null) {
    await deleteUserExerciseStepPref(userId, exerciseId);
  } else {
    await upsertUserExerciseStepPref(userId, exerciseId, weightStepKg);
  }
  return getExerciseById(userId, exerciseId);
}

export interface ExerciseStepMeta {
  isCustom: boolean;
  weightStepKg: number | null;
  userWeightStepKg: number | null;
}

/**
 * Loads step metadata (isCustom, exercise weight_step_kg, and user_exercise_prefs override)
 * for a list of exercise IDs, including hidden exercises.
 */
export async function getExerciseStepMetaByIds(
  userId: string,
  exerciseIds: string[],
): Promise<Record<string, ExerciseStepMeta>> {
  if (exerciseIds.length === 0) return {};
  const placeholders = exerciseIds.map((_, i) => `$${i + 2}`).join(',');
  const { rows } = await query<{
    id: string;
    is_custom: number;
    weight_step_kg: number | null;
    user_weight_step_kg: number | null;
  }>(
    `
      SELECT
        e.id,
        e.is_custom,
        e.weight_step_kg,
        uep.weight_step_kg AS user_weight_step_kg
      FROM exercises e
      LEFT JOIN user_exercise_prefs uep
        ON uep.exercise_id = e.id AND uep.user_id = $1
      WHERE e.id IN (${placeholders}) AND (e.user_id IS NULL OR e.user_id = $1)
    `,
    [userId, ...exerciseIds],
  );

  const result: Record<string, ExerciseStepMeta> = {};
  for (const row of rows) {
    result[row.id] = {
      isCustom: Boolean(row.is_custom),
      weightStepKg:
        row.weight_step_kg === null || row.weight_step_kg === undefined
          ? null
          : Number(row.weight_step_kg),
      userWeightStepKg:
        row.user_weight_step_kg === null || row.user_weight_step_kg === undefined
          ? null
          : Number(row.user_weight_step_kg),
    };
  }
  return result;
}
