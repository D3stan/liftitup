import crypto from 'node:crypto';
import type {
  AppTheme,
  AppleHealthReceiveKind,
  RestClockMode,
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
import { query, queryOne, withTransaction } from './connection';
import { deleteUserAccountInTx } from './userDeletion';

type DbUserRow = {
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
  rest_clock_mode?: string;
  default_weight_step_kg?: number | null;
  apple_fitness_enabled: number;
  apple_health_last_received_at?: string | null;
  apple_health_last_received_kind?: string | null;
  apple_health_last_received_linked?: number | null;
  is_guest: number;
  last_active_at: string;
  created_at: string;
};

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
  restClockMode?: RestClockMode;
  defaultWeightStepKg?: number | null;
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
  restClockMode?: RestClockMode;
  defaultWeightStepKg?: number | null;
  appleFitnessEnabled?: boolean;
}

export function isValidRestClockMode(val: unknown): val is RestClockMode {
  return val === 'stopwatch' || val === 'countdown';
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
    restClockMode: row.rest_clock_mode === 'countdown' ? 'countdown' : 'stopwatch',
    defaultWeightStepKg:
      row.default_weight_step_kg === null || row.default_weight_step_kg === undefined
        ? null
        : Number(row.default_weight_step_kg),
    appleFitnessEnabled: Boolean(row.apple_fitness_enabled),
    appleHealthLastReceivedAt: row.apple_health_last_received_at ?? null,
    appleHealthLastReceivedKind:
      row.apple_health_last_received_kind === 'workout' ||
      row.apple_health_last_received_kind === 'weight' ||
      row.apple_health_last_received_kind === 'both'
        ? row.apple_health_last_received_kind
        : null,
    appleHealthLastReceivedLinked:
      row.apple_health_last_received_linked === null ||
      row.apple_health_last_received_linked === undefined
        ? null
        : Boolean(row.apple_health_last_received_linked),
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

export async function getUserById(userId: string): Promise<UserProfile | null> {
  const row = await queryOne<DbUserRow>('SELECT * FROM users WHERE id = $1', [
    userId,
  ]);
  return row ? mapUserRow(row) : null;
}

export async function getUserByUsername(
  username: string,
): Promise<UserWithPassword | null> {
  const normalized = username.trim().toLowerCase();
  const row = await queryOne<DbUserRow>(
    'SELECT * FROM users WHERE lower(username) = $1',
    [normalized],
  );
  if (!row) return null;
  return {
    ...mapUserRow(row),
    passwordHash: row.password_hash,
  };
}

export async function createUser(input: CreateUserInput): Promise<UserProfile> {
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

  const restClockMode: RestClockMode =
    input.restClockMode === 'countdown' ? 'countdown' : 'stopwatch';

  const row = await queryOne<DbUserRow>(
    `
    INSERT INTO users (
      id, username, display_name, password_hash,
      height_cm, weight_kg, age, training_years,
      unit, timezone, theme, theme_variant,
      enable_set_quality, rest_clock_mode, default_weight_step_kg,
      apple_fitness_enabled, is_guest, last_active_at, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
    RETURNING *
    `,
    [
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
      restClockMode,
      input.defaultWeightStepKg ?? null,
      input.appleFitnessEnabled === false ? 0 : 1,
      input.isGuest ? 1 : 0,
      now,
      now,
    ],
  );

  return mapUserRow(row!);
}

export async function updateUserSettings(
  userId: string,
  patch: UpdateUserSettingsInput,
): Promise<UserProfile | null> {
  const setClauses: string[] = [];
  const params: Array<string | number | null> = [];
  let idx = 1;

  if (patch.displayName !== undefined) {
    setClauses.push(`display_name = $${idx++}`);
    params.push(patch.displayName.trim());
  }
  if (patch.heightCm !== undefined) {
    setClauses.push(`height_cm = $${idx++}`);
    params.push(patch.heightCm);
  }
  if (patch.weightKg !== undefined) {
    setClauses.push(`weight_kg = $${idx++}`);
    params.push(patch.weightKg);
  }
  if (patch.age !== undefined) {
    setClauses.push(`age = $${idx++}`);
    params.push(patch.age);
  }
  if (patch.trainingYears !== undefined) {
    setClauses.push(`training_years = $${idx++}`);
    params.push(patch.trainingYears);
  }
  if (patch.unit !== undefined) {
    setClauses.push(`unit = $${idx++}`);
    params.push(patch.unit === 'lb' ? 'lb' : 'kg');
  }
  if (patch.timezone !== undefined) {
    setClauses.push(`timezone = $${idx++}`);
    params.push(sanitizeTimezone(patch.timezone));
  }
  if (patch.theme !== undefined) {
    setClauses.push(`theme = $${idx++}`);
    params.push(isValidAppTheme(patch.theme) ? patch.theme : DEFAULT_THEME);
  }
  if (patch.themeVariant !== undefined) {
    setClauses.push(`theme_variant = $${idx++}`);
    params.push(
      isValidThemeVariant(patch.themeVariant)
        ? patch.themeVariant
        : DEFAULT_THEME_VARIANT,
    );
  }
  if (patch.enableSetQuality !== undefined) {
    setClauses.push(`enable_set_quality = $${idx++}`);
    params.push(patch.enableSetQuality ? 1 : 0);
  }
  if (patch.restClockMode !== undefined) {
    setClauses.push(`rest_clock_mode = $${idx++}`);
    params.push(patch.restClockMode === 'countdown' ? 'countdown' : 'stopwatch');
  }
  if (patch.defaultWeightStepKg !== undefined) {
    setClauses.push(`default_weight_step_kg = $${idx++}`);
    params.push(patch.defaultWeightStepKg);
  }
  if (patch.appleFitnessEnabled !== undefined) {
    setClauses.push(`apple_fitness_enabled = $${idx++}`);
    params.push(patch.appleFitnessEnabled ? 1 : 0);
  }

  if (setClauses.length === 0) {
    return getUserById(userId);
  }

  params.push(userId);
  const row = await queryOne<DbUserRow>(
    `UPDATE users SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
    params,
  );
  return row ? mapUserRow(row) : null;
}

export async function recordAppleHealthLastReceived(
  userId: string,
  input: {
    receivedAt: string;
    kind: AppleHealthReceiveKind;
    linked: boolean | null;
  },
): Promise<UserProfile | null> {
  const row = await queryOne<DbUserRow>(
    `UPDATE users
     SET apple_health_last_received_at = $1,
         apple_health_last_received_kind = $2,
         apple_health_last_received_linked = $3
     WHERE id = $4
     RETURNING *`,
    [
      input.receivedAt,
      input.kind,
      input.linked === null ? null : input.linked ? 1 : 0,
      userId,
    ],
  );
  return row ? mapUserRow(row) : null;
}

/**
 * Updates users.last_active_at throttled to at most once every 5 minutes
 * to avoid unnecessary write contention on read requests.
 */
export async function touchUserLastActive(userId: string): Promise<void> {
  const now = new Date();
  const nowIso = now.toISOString();
  const thresholdIso = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
  await query(
    'UPDATE users SET last_active_at = $1 WHERE id = $2 AND last_active_at < $3',
    [nowIso, userId, thresholdIso],
  );
}

/**
 * Deletes guest sandbox users inactive for longer than `olderThanHours`
 * using explicit child-to-parent deletion order inside a transaction.
 * Returns the number of purged guest users.
 */
export async function deleteExpiredGuests(
  olderThanHours = 24,
): Promise<number> {
  const cutoffIso = new Date(
    Date.now() - olderThanHours * 60 * 60 * 1000,
  ).toISOString();
  return withTransaction(async () => {
    const res = await query<{ id: string }>(
      'SELECT id FROM users WHERE is_guest = 1 AND last_active_at < $1',
      [cutoffIso],
    );
    let deleted = 0;
    for (const row of res.rows) {
      if (await deleteUserAccountInTx(row.id)) {
        deleted += 1;
      }
    }
    return deleted;
  });
}
