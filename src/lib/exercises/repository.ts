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
  is_custom: number;
  aliases_json: string;
  created_at: string;
  is_hidden?: number;
};

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
  aliases?: string[];
}

export interface UpdateCustomExerciseInput {
  name?: string;
  trackingType?: TrackingType;
  equipment?: string;
  category?: string;
  defaultRestSeconds?: number;
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
      SELECT e.*, CASE WHEN he.exercise_id IS NOT NULL THEN 1 ELSE 0 END AS is_hidden
      FROM exercises e
      LEFT JOIN hidden_exercises he
        ON he.exercise_id = e.id AND he.user_id = $1
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
      SELECT e.*, CASE WHEN he.exercise_id IS NOT NULL THEN 1 ELSE 0 END AS is_hidden
      FROM exercises e
      LEFT JOIN hidden_exercises he
        ON he.exercise_id = e.id AND he.user_id = $1
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
      default_rest_seconds, is_custom, aliases_json, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9, $10)
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
  const params: Array<string | number> = [];

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
