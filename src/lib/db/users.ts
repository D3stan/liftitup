import crypto from 'node:crypto';
import type {
  AppTheme,
  ThemeVariant,
  UserProfile,
  WeightUnit,
} from '@/types/domain';
import {
  DEFAULT_THEME,
  DEFAULT_THEME_VARIANT,
  isValidAppTheme,
  isValidThemeVariant,
} from '@/lib/theme';
import { getDb } from './connection';

interface DbUserRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  height_cm: number | null;
  weight_kg: number;
  age: number | null;
  training_years: number | null;
  unit: string;
  timezone: string;
  theme?: string;
  theme_variant?: string;
  enable_set_quality: number;
  apple_fitness_enabled: number;
  is_guest: number;
  last_active_at: string;
  created_at: string;
}

export interface UserWithPassword extends UserProfile {
  passwordHash: string;
}

export interface CreateUserInput {
  id?: string;
  username: string;
  displayName: string;
  passwordHash: string;
  heightCm?: number | null;
  weightKg?: number;
  age?: number | null;
  trainingYears?: number | null;
  unit?: WeightUnit;
  timezone?: string;
  theme?: AppTheme;
  themeVariant?: ThemeVariant;
  enableSetQuality?: boolean;
  appleFitnessEnabled?: boolean;
  isGuest?: boolean;
}

export interface UpdateUserSettingsInput {
  displayName?: string;
  heightCm?: number | null;
  weightKg?: number;
  age?: number | null;
  trainingYears?: number | null;
  unit?: WeightUnit;
  timezone?: string;
  theme?: AppTheme;
  themeVariant?: ThemeVariant;
  enableSetQuality?: boolean;
  appleFitnessEnabled?: boolean;
}

export function mapUserRow(row: DbUserRow): UserProfile {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    heightCm: row.height_cm === null ? null : Number(row.height_cm),
    weightKg: Number(row.weight_kg),
    age: row.age === null ? null : Number(row.age),
    trainingYears: row.training_years === null ? null : Number(row.training_years),
    unit: row.unit === 'lb' ? 'lb' : 'kg',
    timezone: row.timezone || 'UTC',
    theme: isValidAppTheme(row.theme) ? row.theme : DEFAULT_THEME,
    themeVariant: isValidThemeVariant(row.theme_variant)
      ? row.theme_variant
      : DEFAULT_THEME_VARIANT,
    enableSetQuality: Boolean(row.enable_set_quality),
    appleFitnessEnabled: Boolean(row.apple_fitness_enabled),
    isGuest: Boolean(row.is_guest),
    lastActiveAt: row.last_active_at,
    createdAt: row.created_at,
  };
}

export function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function sanitizeTimezone(tz: string | undefined | null): string {
  if (!tz || typeof tz !== 'string') return 'UTC';
  const trimmed = tz.trim();
  if (!trimmed || trimmed.length > 64) return 'UTC';
  return isValidTimezone(trimmed) ? trimmed : 'UTC';
}

export function localDateForTimezone(tz: string, date: Date = new Date()): string {
  const safeTz = sanitizeTimezone(tz);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function getUserById(userId: string): UserProfile | null {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM users WHERE id = ?')
    .get(userId) as DbUserRow | undefined;
  return row ? mapUserRow(row) : null;
}

export function getUserByUsername(username: string): UserWithPassword | null {
  const db = getDb();
  const normalized = username.trim().toLowerCase();
  const row = db
    .prepare('SELECT * FROM users WHERE lower(username) = ?')
    .get(normalized) as DbUserRow | undefined;
  if (!row) return null;
  return {
    ...mapUserRow(row),
    passwordHash: row.password_hash,
  };
}

export function createUser(input: CreateUserInput): UserProfile {
  const db = getDb();
  const now = new Date().toISOString();
  const id = input.id ?? `usr_${crypto.randomUUID()}`;
  const username = input.username.trim().toLowerCase();
  const displayName = input.displayName.trim() || username;
  const timezone = sanitizeTimezone(input.timezone);
  const unit: WeightUnit = input.unit === 'lb' ? 'lb' : 'kg';
  const theme: AppTheme = isValidAppTheme(input.theme)
    ? input.theme
    : DEFAULT_THEME;
  const themeVariant: ThemeVariant = isValidThemeVariant(input.themeVariant)
    ? input.themeVariant
    : DEFAULT_THEME_VARIANT;

  db.prepare(`
    INSERT INTO users (
      id, username, display_name, password_hash,
      height_cm, weight_kg, age, training_years,
      unit, timezone, theme, theme_variant,
      enable_set_quality, apple_fitness_enabled,
      is_guest, last_active_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    username,
    displayName,
    input.passwordHash,
    input.heightCm ?? null,
    input.weightKg ?? 75,
    input.age ?? null,
    input.trainingYears ?? null,
    unit,
    timezone,
    theme,
    themeVariant,
    input.enableSetQuality ? 1 : 0,
    input.appleFitnessEnabled === false ? 0 : 1,
    input.isGuest ? 1 : 0,
    now,
    now,
  );

  return getUserById(id)!;
}

export function updateUserSettings(
  userId: string,
  patch: UpdateUserSettingsInput,
): UserProfile | null {
  const db = getDb();
  const setClauses: string[] = [];
  const params: Array<string | number | null> = [];

  if (patch.displayName !== undefined) {
    setClauses.push('display_name = ?');
    params.push(patch.displayName.trim());
  }
  if (patch.heightCm !== undefined) {
    setClauses.push('height_cm = ?');
    params.push(patch.heightCm);
  }
  if (patch.weightKg !== undefined) {
    setClauses.push('weight_kg = ?');
    params.push(patch.weightKg);
  }
  if (patch.age !== undefined) {
    setClauses.push('age = ?');
    params.push(patch.age);
  }
  if (patch.trainingYears !== undefined) {
    setClauses.push('training_years = ?');
    params.push(patch.trainingYears);
  }
  if (patch.unit !== undefined) {
    setClauses.push('unit = ?');
    params.push(patch.unit === 'lb' ? 'lb' : 'kg');
  }
  if (patch.timezone !== undefined) {
    setClauses.push('timezone = ?');
    params.push(sanitizeTimezone(patch.timezone));
  }
  if (patch.theme !== undefined) {
    setClauses.push('theme = ?');
    params.push(isValidAppTheme(patch.theme) ? patch.theme : DEFAULT_THEME);
  }
  if (patch.themeVariant !== undefined) {
    setClauses.push('theme_variant = ?');
    params.push(
      isValidThemeVariant(patch.themeVariant)
        ? patch.themeVariant
        : DEFAULT_THEME_VARIANT,
    );
  }
  if (patch.enableSetQuality !== undefined) {
    setClauses.push('enable_set_quality = ?');
    params.push(patch.enableSetQuality ? 1 : 0);
  }
  if (patch.appleFitnessEnabled !== undefined) {
    setClauses.push('apple_fitness_enabled = ?');
    params.push(patch.appleFitnessEnabled ? 1 : 0);
  }

  if (setClauses.length === 0) {
    return getUserById(userId);
  }

  params.push(userId);
  db.prepare(`UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`).run(
    ...params,
  );
  return getUserById(userId);
}

/**
 * Updates users.last_active_at throttled to at most once every 5 minutes
 * to avoid unnecessary write contention on read requests.
 */
export function touchUserLastActive(userId: string): void {
  const db = getDb();
  const now = new Date();
  const nowIso = now.toISOString();
  const thresholdIso = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
  db.prepare(
    'UPDATE users SET last_active_at = ? WHERE id = ? AND last_active_at < ?',
  ).run(nowIso, userId, thresholdIso);
}

/**
 * Deletes guest sandbox users inactive for longer than `olderThanHours`.
 * Returns the number of purged guest users (cascade cleans up all child rows).
 */
export function deleteExpiredGuests(olderThanHours = 24): number {
  const db = getDb();
  const cutoffIso = new Date(
    Date.now() - olderThanHours * 60 * 60 * 1000,
  ).toISOString();
  const res = db
    .prepare('DELETE FROM users WHERE is_guest = 1 AND last_active_at < ?')
    .run(cutoffIso);
  return Number(res.changes ?? 0);
}
