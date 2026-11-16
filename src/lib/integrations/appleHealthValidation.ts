import type { AppleHealthReceiveKind } from '@/types/domain';

export const MAX_APPLE_HEALTH_ITEMS = 100;
export const OVERLAP_TOLERANCE_MS = 15 * 60_000;

export type AppleHealthSource = 'shortcut_webhook' | 'file_import';

export class AppleHealthValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppleHealthValidationError';
  }
}

export interface ValidatedWorkoutItem {
  kind: 'workout';
  workoutType: string;
  startedAt: string;
  durationMinutes: number;
  activeCalories: number | null;
  avgHeartRate: number | null;
  maxHeartRate: number | null;
  bodyweightKg: number | null;
  measuredDate: string;
  source: AppleHealthSource;
}

export interface ValidatedWeightItem {
  kind: 'weight';
  bodyweightKg: number;
  measuredDate: string;
  source: AppleHealthSource;
}

export type ValidatedAppleHealthItem =
  | ValidatedWorkoutItem
  | ValidatedWeightItem;

export interface ValidatedAppleHealthIngest {
  items: ValidatedAppleHealthItem[];
  summaryKind: AppleHealthReceiveKind;
  source: AppleHealthSource;
  dryRun: boolean;
}

export interface OverlapScore {
  directOverlapMs: number;
  gapMs: number;
  startDiffMs: number;
}

export interface IntervalWorkoutInput {
  startedAt: string;
  durationMinutes: number;
}

export interface IntervalSessionInput {
  startedAt: string;
  completedAt: string | null;
  durationMinutes: number | null;
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === 'object' && !Array.isArray(val);
}

function hasValue(val: unknown): boolean {
  if (val === undefined || val === null) return false;
  if (typeof val === 'string' && val.trim() === '') return false;
  return true;
}

function isValidYmd(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return false;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

export function formatDateInTimezone(
  tz: string | undefined | null,
  date: Date = new Date(),
): string {
  let safeTz = 'UTC';
  if (typeof tz === 'string' && tz.trim() && tz.trim().length <= 64) {
    try {
      Intl.DateTimeFormat('en-US', { timeZone: tz.trim() });
      safeTz = tz.trim();
    } catch {
      safeTz = 'UTC';
    }
  }
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function parseStrictFiniteNumber(val: unknown, fieldName: string): number {
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) {
      throw new AppleHealthValidationError(`${fieldName} must be a finite number`);
    }
    return val;
  }
  if (typeof val === 'string' && val.trim() !== '') {
    const parsed = Number(val.trim());
    if (!Number.isFinite(parsed)) {
      throw new AppleHealthValidationError(`${fieldName} must be a finite number`);
    }
    return parsed;
  }
  throw new AppleHealthValidationError(`${fieldName} must be a finite number`);
}

function parseOptionalBoundedInt(
  val: unknown,
  fieldName: string,
  min: number,
  max: number,
): number | null {
  if (!hasValue(val)) return null;
  const n = parseStrictFiniteNumber(val, fieldName);
  if (n < min || n > max) {
    throw new AppleHealthValidationError(
      `${fieldName} must be between ${min} and ${max}`,
    );
  }
  return Math.round(n);
}

export function parseOptionalWeight(
  val: unknown,
  fieldName = 'bodyweightKg',
): number | null {
  if (!hasValue(val)) return null;
  const n = parseStrictFiniteNumber(val, fieldName);
  if (n < 25 || n > 300) {
    throw new AppleHealthValidationError(
      `${fieldName} must be between 25 and 300 kg`,
    );
  }
  return Math.round(n * 10) / 10;
}

function resolveFirstPresent(
  item: Record<string, unknown>,
  keys: string[],
  prefix: string,
): { value: unknown; fieldName: string } {
  for (const key of keys) {
    if (key in item && item[key] !== undefined && item[key] !== null && item[key] !== '') {
      return { value: item[key], fieldName: `${prefix}.${key}` };
    }
  }
  return { value: undefined, fieldName: `${prefix}.${keys[0]}` };
}

function parseWeightMeasuredDate(
  item: Record<string, unknown>,
  prefix: string,
  timezone: string,
): string {
  if (hasValue(item.measuredOn)) {
    if (!isValidYmd(item.measuredOn)) {
      throw new AppleHealthValidationError(
        `${prefix}.measuredOn must be a valid YYYY-MM-DD date`,
      );
    }
    return item.measuredOn.trim();
  }

  if (hasValue(item.date)) {
    if (isValidYmd(item.date)) {
      return item.date.trim();
    }
    if (typeof item.date === 'string' && Number.isFinite(Date.parse(item.date))) {
      return formatDateInTimezone(timezone, new Date(item.date));
    }
    throw new AppleHealthValidationError(
      `${prefix}.date must be a valid YYYY-MM-DD date or ISO timestamp`,
    );
  }

  if (hasValue(item.startedAt)) {
    if (
      typeof item.startedAt !== 'string' ||
      !Number.isFinite(Date.parse(item.startedAt))
    ) {
      throw new AppleHealthValidationError(
        `${prefix}.startedAt must be a valid ISO timestamp`,
      );
    }
    return formatDateInTimezone(timezone, new Date(item.startedAt));
  }

  throw new AppleHealthValidationError(
    `${prefix}.measuredOn is missing (provide measuredOn, date, or startedAt)`,
  );
}

function normalizeSource(
  rawSource: unknown,
  fallback: AppleHealthSource,
  fieldName: string,
): AppleHealthSource {
  if (rawSource === undefined || rawSource === null || rawSource === '') {
    return fallback;
  }
  if (rawSource === 'file_import' || rawSource === 'shortcut_webhook') {
    return rawSource;
  }
  throw new AppleHealthValidationError(
    `${fieldName} must be "shortcut_webhook" or "file_import"`,
  );
}

function validateSingleItem(
  rawItem: unknown,
  index: number,
  timezone: string,
  defaultSource: AppleHealthSource,
): ValidatedAppleHealthItem {
  const prefix = `workouts[${index}]`;
  if (!isPlainObject(rawItem)) {
    throw new AppleHealthValidationError(`${prefix} must be an object`);
  }

  const itemSource = normalizeSource(
    rawItem.source,
    defaultSource,
    `${prefix}.source`,
  );

  const weightField = resolveFirstPresent(
    rawItem,
    ['bodyweightKg', 'weightKg'],
    prefix,
  );
  const durationField = resolveFirstPresent(
    rawItem,
    ['durationMinutes', 'duration'],
    prefix,
  );

  const hasWorkoutMeta =
    hasValue(rawItem.workoutType) ||
    hasValue(rawItem.activeCalories) ||
    hasValue(rawItem.kcal) ||
    hasValue(rawItem.calories) ||
    hasValue(rawItem.avgHeartRate) ||
    hasValue(rawItem.avgHr) ||
    hasValue(rawItem.maxHeartRate) ||
    hasValue(rawItem.maxHr);

  const hasWeight = hasValue(weightField.value);
  const hasDuration = hasValue(durationField.value);

  // Weight-only item: has bodyweightKg/weightKg and NO workout fields
  if (hasWeight && !hasDuration && !hasWorkoutMeta) {
    const bodyweightKg = parseOptionalWeight(
      weightField.value,
      weightField.fieldName,
    );
    if (bodyweightKg === null) {
      throw new AppleHealthValidationError(`${weightField.fieldName} is missing`);
    }
    const measuredDate = parseWeightMeasuredDate(rawItem, prefix, timezone);
    return {
      kind: 'weight',
      bodyweightKg,
      measuredDate,
      source: itemSource,
    };
  }

  // Workout item (with optional bodyweightKg)
  if (!hasValue(rawItem.startedAt)) {
    throw new AppleHealthValidationError(`${prefix}.startedAt is missing`);
  }
  if (
    typeof rawItem.startedAt !== 'string' ||
    !Number.isFinite(Date.parse(rawItem.startedAt))
  ) {
    throw new AppleHealthValidationError(
      `${prefix}.startedAt must be a valid ISO timestamp`,
    );
  }
  const startedAt = new Date(rawItem.startedAt).toISOString();

  if (!hasDuration) {
    throw new AppleHealthValidationError(`${prefix}.durationMinutes is missing`);
  }
  const rawDuration = parseStrictFiniteNumber(
    durationField.value,
    durationField.fieldName,
  );
  if (rawDuration <= 0 || rawDuration > 600) {
    throw new AppleHealthValidationError(
      `${durationField.fieldName} must be a positive number between 1 and 600`,
    );
  }
  const durationMinutes = Math.max(1, Math.round(rawDuration));

  let workoutType = 'Traditional Strength Training';
  if (rawItem.workoutType !== undefined && rawItem.workoutType !== null) {
    if (typeof rawItem.workoutType !== 'string' || !rawItem.workoutType.trim()) {
      throw new AppleHealthValidationError(
        `${prefix}.workoutType must be a non-empty string`,
      );
    }
    workoutType = rawItem.workoutType.trim().slice(0, 80);
  }

  const calField = resolveFirstPresent(
    rawItem,
    ['activeCalories', 'kcal', 'calories'],
    prefix,
  );
  const activeCalories = parseOptionalBoundedInt(
    calField.value,
    calField.fieldName,
    0,
    10_000,
  );

  const avgHrField = resolveFirstPresent(
    rawItem,
    ['avgHeartRate', 'avgHr'],
    prefix,
  );
  const avgHeartRate = parseOptionalBoundedInt(
    avgHrField.value,
    avgHrField.fieldName,
    25,
    250,
  );

  const maxHrField = resolveFirstPresent(
    rawItem,
    ['maxHeartRate', 'maxHr'],
    prefix,
  );
  const maxHeartRate = parseOptionalBoundedInt(
    maxHrField.value,
    maxHrField.fieldName,
    25,
    250,
  );

  const bodyweightKg = parseOptionalWeight(
    weightField.value,
    weightField.fieldName,
  );

  const measuredDate = formatDateInTimezone(timezone, new Date(startedAt));

  return {
    kind: 'workout',
    workoutType,
    startedAt,
    durationMinutes,
    activeCalories,
    avgHeartRate,
    maxHeartRate,
    bodyweightKg,
    measuredDate,
    source: itemSource,
  };
}

export function extractIngestMeta(body: unknown): {
  dryRun: boolean;
  source: AppleHealthSource;
} {
  if (Array.isArray(body)) {
    return { dryRun: false, source: 'shortcut_webhook' };
  }
  if (!isPlainObject(body)) {
    throw new AppleHealthValidationError(
      'Payload must be a JSON object or array',
    );
  }
  if (body.dryRun !== undefined && typeof body.dryRun !== 'boolean') {
    throw new AppleHealthValidationError('dryRun must be a boolean');
  }
  const source = normalizeSource(body.source, 'shortcut_webhook', 'source');
  return {
    dryRun: body.dryRun === true,
    source,
  };
}

export function validateAppleHealthIngestPayload(
  body: unknown,
  options: { timezone: string; defaultSource?: AppleHealthSource },
): ValidatedAppleHealthIngest {
  if (body === null || typeof body !== 'object') {
    throw new AppleHealthValidationError(
      'Payload must be a JSON object or array',
    );
  }

  let dryRun = false;
  let topSource: AppleHealthSource = options.defaultSource ?? 'shortcut_webhook';
  let rawItems: unknown[];

  if (Array.isArray(body)) {
    rawItems = body;
  } else {
    const obj = body as Record<string, unknown>;
    if (obj.dryRun !== undefined && typeof obj.dryRun !== 'boolean') {
      throw new AppleHealthValidationError('dryRun must be a boolean');
    }
    dryRun = obj.dryRun === true;
    topSource = normalizeSource(obj.source, topSource, 'source');

    if ('workouts' in obj && obj.workouts !== undefined) {
      if (!Array.isArray(obj.workouts)) {
        throw new AppleHealthValidationError('workouts must be an array');
      }
      rawItems = obj.workouts;
    } else {
      rawItems = [obj];
    }
  }

  if (rawItems.length === 0) {
    throw new AppleHealthValidationError(
      'workouts must contain at least one item',
    );
  }
  if (rawItems.length > MAX_APPLE_HEALTH_ITEMS) {
    throw new AppleHealthValidationError(
      `workouts cannot exceed ${MAX_APPLE_HEALTH_ITEMS} items per request`,
    );
  }

  const items: ValidatedAppleHealthItem[] = [];
  let hasWorkout = false;
  let hasWeight = false;

  for (let i = 0; i < rawItems.length; i += 1) {
    const validated = validateSingleItem(
      rawItems[i],
      i,
      options.timezone,
      topSource,
    );
    if (validated.kind === 'workout') {
      hasWorkout = true;
      if (validated.bodyweightKg !== null) {
        hasWeight = true;
      }
    } else {
      hasWeight = true;
    }
    items.push(validated);
  }

  const summaryKind: AppleHealthReceiveKind =
    hasWorkout && hasWeight ? 'both' : hasWorkout ? 'workout' : 'weight';

  return {
    items,
    summaryKind,
    source: topSource,
    dryRun,
  };
}

/**
 * Strictly parses an uploaded JSON, CSV, or Apple Health export.xml file without
 * inventing fallback durations (50m), calories (350 kcal), or timestamps ("now").
 */
export function parseAppleHealthFileStrict(
  fileName: string,
  content: string,
  timezone: string,
): { workouts: Record<string, unknown>[]; source: 'file_import' } {
  const lower = fileName.toLowerCase();
  const rawItems: Record<string, unknown>[] = [];

  if (lower.endsWith('.json')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content) as unknown;
    } catch {
      throw new AppleHealthValidationError('Invalid JSON file');
    }
    const list = Array.isArray(parsed)
      ? parsed
      : isPlainObject(parsed) && 'workouts' in parsed
        ? parsed.workouts
        : [parsed];
    if (!Array.isArray(list) || list.length === 0) {
      throw new AppleHealthValidationError('No workouts found in JSON file');
    }
    for (let i = 0; i < list.length; i += 1) {
      const raw = list[i];
      if (!isPlainObject(raw)) {
        throw new AppleHealthValidationError(`workouts[${i}] must be an object`);
      }
      rawItems.push({ ...raw, source: 'file_import' });
    }
  } else if (lower.endsWith('.csv')) {
    const lines = content
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length < 2) {
      throw new AppleHealthValidationError('CSV file has no data rows');
    }
    const headers = lines[0]
      .split(',')
      .map((h) => h.trim().replace(/^"|"$/g, '').toLowerCase());

    for (let i = 1; i < lines.length; i += 1) {
      const cols = lines[i]
        .split(',')
        .map((c) => c.trim().replace(/^"|"$/g, ''));
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => {
        row[h] = cols[idx] ?? '';
      });

      const item: Record<string, unknown> = { source: 'file_import' };
      const wt = row.workouttype || row.type || row.activity;
      if (wt) item.workoutType = wt;
      if (row.startedat) item.startedAt = row.startedat;
      if (row.measuredon) item.measuredOn = row.measuredon;
      if (row.date) item.date = row.date;
      if (row.durationminutes) item.durationMinutes = row.durationminutes;
      else if (row.duration) item.duration = row.duration;
      if (row.activecalories) item.activeCalories = row.activecalories;
      else if (row.calories) item.calories = row.calories;
      else if (row.kcal) item.kcal = row.kcal;
      if (row.avgheartrate) item.avgHeartRate = row.avgheartrate;
      else if (row.avghr) item.avgHr = row.avghr;
      if (row.maxheartrate) item.maxHeartRate = row.maxheartrate;
      else if (row.maxhr) item.maxHr = row.maxhr;
      if (row.bodyweightkg) item.bodyweightKg = row.bodyweightkg;
      else if (row.weightkg) item.weightKg = row.weightkg;
      rawItems.push(item);
    }
  } else if (lower.endsWith('.xml')) {
    const workoutRegex = /<Workout\s+([^>]+?)(?:\/>|>[\s\S]*?<\/Workout>)/gi;
    let match: RegExpExecArray | null;
    let idx = 0;
    while ((match = workoutRegex.exec(content)) !== null) {
      const attrs = match[1];
      const typeMatch = attrs.match(/workoutActivityType="([^"]+)"/i);
      const durMatch = attrs.match(/duration="([^"]+)"/i);
      const durUnitMatch = attrs.match(/durationUnit="([^"]+)"/i);
      const kcalMatch = attrs.match(/totalEnergyBurned="([^"]+)"/i);
      const startMatch = attrs.match(/startDate="([^"]+)"/i);

      if (!startMatch || !startMatch[1].trim()) {
        throw new AppleHealthValidationError(
          `workouts[${idx}].startedAt is missing in XML <Workout>`,
        );
      }
      if (!durMatch || !durMatch[1].trim()) {
        throw new AppleHealthValidationError(
          `workouts[${idx}].durationMinutes is missing in XML <Workout>`,
        );
      }

      let durationMinutes = Number(durMatch[1]);
      const durUnit = durUnitMatch?.[1]?.toLowerCase();
      if (durUnit === 'sec' || durUnit === 's') {
        durationMinutes = durationMinutes / 60;
      } else if (durUnit === 'hr' || durUnit === 'h') {
        durationMinutes = durationMinutes * 60;
      }

      const rawType = typeMatch ? typeMatch[1] : 'TraditionalStrengthTraining';
      const friendlyType = rawType
        .replace(/^HKWorkoutActivityType/i, '')
        .replace(/([A-Z])/g, ' $1')
        .trim();

      const item: Record<string, unknown> = {
        workoutType: friendlyType || 'Traditional Strength Training',
        startedAt: startMatch[1].trim(),
        durationMinutes,
        source: 'file_import',
      };
      if (kcalMatch && kcalMatch[1].trim() !== '') {
        item.activeCalories = Number(kcalMatch[1]);
      }

      rawItems.push(item);
      idx += 1;
    }

    if (rawItems.length === 0) {
      throw new AppleHealthValidationError('No <Workout> entries found in XML file');
    }
  } else {
    throw new AppleHealthValidationError(
      'Unsupported file type. Upload a .json, .csv, or .xml file.',
    );
  }

  // Validate everything strictly before sending to the API
  validateAppleHealthIngestPayload(
    { source: 'file_import', workouts: rawItems },
    { timezone, defaultSource: 'file_import' },
  );

  return { workouts: rawItems, source: 'file_import' };
}

/**
 * Computes time overlap between an Apple Health workout interval and a logged
 * workout session interval, using ±15 minutes tolerance on either side.
 * Returns null if the intervals are further apart than OVERLAP_TOLERANCE_MS.
 */
export function computeIntervalOverlap(
  ah: IntervalWorkoutInput,
  session: IntervalSessionInput,
): OverlapScore | null {
  const ahStart = Date.parse(ah.startedAt);
  const sessStart = Date.parse(session.startedAt);
  if (!Number.isFinite(ahStart) || !Number.isFinite(sessStart)) {
    return null;
  }

  const ahDurationMs = Math.max(1, ah.durationMinutes) * 60_000;
  const ahEnd = ahStart + ahDurationMs;

  let sessEnd = sessStart;
  if (session.durationMinutes !== null && session.durationMinutes > 0) {
    sessEnd = sessStart + session.durationMinutes * 60_000;
  } else if (session.completedAt) {
    const parsedCompleted = Date.parse(session.completedAt);
    if (Number.isFinite(parsedCompleted) && parsedCompleted >= sessStart) {
      sessEnd = parsedCompleted;
    }
  }

  const gapMs = Math.max(0, ahStart - sessEnd, sessStart - ahEnd);
  if (gapMs > OVERLAP_TOLERANCE_MS) {
    return null;
  }

  const directOverlapMs = Math.max(
    0,
    Math.min(ahEnd, sessEnd) - Math.max(ahStart, sessStart),
  );
  const startDiffMs = Math.abs(ahStart - sessStart);

  return { directOverlapMs, gapMs, startDiffMs };
}

/**
 * Returns > 0 if `a` is strictly better than `b`, < 0 if `b` is strictly better
 * than `a`, or 0 if tied.
 */
export function compareOverlapScores(a: OverlapScore, b: OverlapScore): number {
  if (a.directOverlapMs !== b.directOverlapMs) {
    return a.directOverlapMs - b.directOverlapMs;
  }
  if (a.gapMs !== b.gapMs) {
    return b.gapMs - a.gapMs;
  }
  if (a.startDiffMs !== b.startDiffMs) {
    return b.startDiffMs - a.startDiffMs;
  }
  return 0;
}

export function rankMatchingSessions<T extends IntervalSessionInput>(
  workout: IntervalWorkoutInput,
  candidates: T[],
): Array<{ session: T; score: OverlapScore }> {
  const matches: Array<{ session: T; score: OverlapScore }> = [];
  for (const session of candidates) {
    const score = computeIntervalOverlap(workout, session);
    if (score) {
      matches.push({ session, score });
    }
  }
  matches.sort((a, b) => compareOverlapScores(b.score, a.score));
  return matches;
}

export function findBestMatchingHealthWorkout<T extends IntervalWorkoutInput>(
  session: IntervalSessionInput,
  candidates: T[],
): { workout: T; score: OverlapScore } | null {
  let best: { workout: T; score: OverlapScore } | null = null;
  for (const workout of candidates) {
    const score = computeIntervalOverlap(workout, session);
    if (!score) continue;
    if (!best || compareOverlapScores(score, best.score) > 0) {
      best = { workout, score };
    }
  }
  return best;
}
