import crypto from 'node:crypto';
import type { Exercise, TrackingType } from '@/types/domain';
import { getDb } from '@/lib/db/connection';

interface DbExerciseRow {
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

export function listExercises(
  userId: string,
  filter: ExerciseFilter = {},
): Exercise[] {
  const db = getDb();
  const clauses = ['(e.user_id IS NULL OR e.user_id = ?)'];
  const params: Array<string | number> = [userId, userId];

  if (!filter.includeHidden) {
    clauses.push('he.exercise_id IS NULL');
  }
  if (filter.category) {
    clauses.push('e.category = ?');
    params.push(filter.category);
  }
  if (filter.trackingType) {
    clauses.push('e.tracking_type = ?');
    params.push(filter.trackingType);
  }

  const rows = db
    .prepare(`
      SELECT e.*, CASE WHEN he.exercise_id IS NOT NULL THEN 1 ELSE 0 END AS is_hidden
      FROM exercises e
      LEFT JOIN hidden_exercises he
        ON he.exercise_id = e.id AND he.user_id = ?
      WHERE ${clauses.join(' AND ')}
      ORDER BY e.is_custom DESC, e.name ASC
    `)
    .all(...params) as unknown as DbExerciseRow[];

  const mapped = rows.map(mapExerciseRow);
  const q = filter.query?.trim().toLowerCase();
  if (!q) return mapped;

  return mapped.filter(
    (ex) =>
      ex.name.toLowerCase().includes(q) ||
      ex.aliases.some((alias) => alias.toLowerCase().includes(q)),
  );
}

export function getExerciseById(
  userId: string,
  exerciseId: string,
): Exercise | null {
  const db = getDb();
  const row = db
    .prepare(`
      SELECT e.*, CASE WHEN he.exercise_id IS NOT NULL THEN 1 ELSE 0 END AS is_hidden
      FROM exercises e
      LEFT JOIN hidden_exercises he
        ON he.exercise_id = e.id AND he.user_id = ?
      WHERE e.id = ? AND (e.user_id IS NULL OR e.user_id = ?)
    `)
    .get(userId, exerciseId, userId) as DbExerciseRow | undefined;

  return row ? mapExerciseRow(row) : null;
}

/**
 * Case-insensitive exact match on exercise name or aliases, preferring user's custom exercises.
 */
export function findExerciseByNameOrAlias(
  userId: string,
  name: string,
): Exercise | null {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return null;

  const all = listExercises(userId, { includeHidden: true });
  // Prefer exact name match (custom first because listExercises orders is_custom DESC)
  const exactName = all.find((ex) => ex.name.toLowerCase() === normalized);
  if (exactName) return exactName;

  const exactAlias = all.find((ex) =>
    ex.aliases.some((alias) => alias.toLowerCase() === normalized),
  );
  return exactAlias ?? null;
}

export function createCustomExercise(
  userId: string,
  input: CreateCustomExerciseInput,
): Exercise {
  const db = getDb();
  const id = `ex_${crypto.randomUUID()}`;
  const baseSlug = slugifyName(input.name);
  const uniqueSuffix = crypto.randomBytes(3).toString('hex');
  const slug = `${baseSlug}-${uniqueSuffix}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO exercises (
      id, user_id, slug, name, tracking_type, equipment, category,
      default_rest_seconds, is_custom, aliases_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
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
  );

  return getExerciseById(userId, id)!;
}

export function updateCustomExercise(
  userId: string,
  exerciseId: string,
  patch: UpdateCustomExerciseInput,
): Exercise | null {
  const db = getDb();
  const existing = db
    .prepare(
      'SELECT id FROM exercises WHERE id = ? AND user_id = ? AND is_custom = 1',
    )
    .get(exerciseId, userId) as { id: string } | undefined;

  if (!existing) return null;

  const setClauses: string[] = [];
  const params: Array<string | number> = [];

  if (patch.name !== undefined) {
    setClauses.push('name = ?');
    params.push(patch.name.trim());
  }
  if (patch.trackingType !== undefined) {
    setClauses.push('tracking_type = ?');
    params.push(patch.trackingType);
  }
  if (patch.equipment !== undefined) {
    setClauses.push('equipment = ?');
    params.push(patch.equipment.trim() || 'other');
  }
  if (patch.category !== undefined) {
    setClauses.push('category = ?');
    params.push(patch.category.trim() || 'other');
  }
  if (patch.defaultRestSeconds !== undefined) {
    setClauses.push('default_rest_seconds = ?');
    params.push(patch.defaultRestSeconds);
  }
  if (patch.aliases !== undefined) {
    setClauses.push('aliases_json = ?');
    params.push(JSON.stringify(patch.aliases));
  }

  if (setClauses.length > 0) {
    params.push(exerciseId, userId);
    db.prepare(
      `UPDATE exercises SET ${setClauses.join(', ')} WHERE id = ? AND user_id = ? AND is_custom = 1`,
    ).run(...params);
  }

  return getExerciseById(userId, exerciseId);
}

export function deleteCustomExercise(
  userId: string,
  exerciseId: string,
): { deleted: boolean; reason?: 'not_found' | 'not_custom' | 'referenced' } {
  const db = getDb();
  const existing = db
    .prepare(
      'SELECT id, user_id, is_custom FROM exercises WHERE id = ? AND (user_id IS NULL OR user_id = ?)',
    )
    .get(exerciseId, userId) as
    | { id: string; user_id: string | null; is_custom: number }
    | undefined;

  if (!existing) {
    return { deleted: false, reason: 'not_found' };
  }
  if (!existing.is_custom || existing.user_id !== userId) {
    return { deleted: false, reason: 'not_custom' };
  }

  const refWorkout = db
    .prepare('SELECT 1 FROM workout_exercises WHERE exercise_id = ? LIMIT 1')
    .get(exerciseId);
  const refSchedule = db
    .prepare(
      'SELECT 1 FROM schedule_day_exercises WHERE exercise_id = ? LIMIT 1',
    )
    .get(exerciseId);

  if (refWorkout || refSchedule) {
    return { deleted: false, reason: 'referenced' };
  }

  db.prepare(
    'DELETE FROM exercises WHERE id = ? AND user_id = ? AND is_custom = 1',
  ).run(exerciseId, userId);
  return { deleted: true };
}

export function setExerciseHidden(
  userId: string,
  exerciseId: string,
  hidden: boolean,
): boolean {
  const db = getDb();
  const exists = db
    .prepare(
      'SELECT id FROM exercises WHERE id = ? AND (user_id IS NULL OR user_id = ?)',
    )
    .get(exerciseId, userId);

  if (!exists) return false;

  if (hidden) {
    db.prepare(
      'INSERT OR IGNORE INTO hidden_exercises (user_id, exercise_id, hidden_at) VALUES (?, ?, ?)',
    ).run(userId, exerciseId, new Date().toISOString());
  } else {
    db.prepare(
      'DELETE FROM hidden_exercises WHERE user_id = ? AND exercise_id = ?',
    ).run(userId, exerciseId);
  }
  return true;
}
