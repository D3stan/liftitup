import crypto from 'node:crypto';
import type {
  BodyMetric,
  Exercise,
  JollyMode,
  RestClockMode,
  ScheduleEventType,
  TrackingType,
  UserProfile,
  WeightUnit,
} from '@/types/domain';
import {
  matchExerciseName,
  TRACKING_TYPES,
  type MatchableExercise,
} from '@/lib/ai/importSchema';
import { ApiError } from '@/lib/api/handler';
import { query, withTransaction } from '@/lib/db/connection';
import { resetUserAccountDataForRestoreInTx } from '@/lib/db/userDeletion';
import {
  getUserById,
  isValidTimezone,
  updateUserSettings,
  type UpdateUserSettingsInput,
} from '@/lib/db/users';
import { getActiveSchedule } from '@/lib/db/workouts';
import {
  createCustomExercise,
  listExercises,
} from '@/lib/exercises/repository';
import { isValidYmd } from '@/lib/workouts/queries';
import {
  MAX_IMPORT_BYTES,
  REPLACE_CONFIRMATION_WORD,
  type LiftitupApplyResult,
  type LiftitupRestorePreview,
  type LiftitupRestoreValidationError,
  type LiftitupValidateResult,
  type RestoreMode,
  type UnmatchedExerciseResolution,
} from './constants';

export {
  MAX_IMPORT_BYTES,
  REPLACE_CONFIRMATION_WORD,
  type LiftitupApplyResult,
  type LiftitupRestorePreview,
  type LiftitupRestoreValidationError,
  type LiftitupValidateResult,
  type RestoreMode,
  type UnmatchedExerciseResolution,
};

export interface ValidateLiftitupOptions {
  mode?: RestoreMode;
}

export interface ApplyLiftitupOptions {
  mode?: RestoreMode;
  confirmation?: string;
  exerciseResolutions?: Record<string, UnmatchedExerciseResolution>;
}

interface ParsedUserSettings {
  heightCm?: number | null;
  weightKg?: number;
  age?: number | null;
  trainingYears?: number | null;
  unit: WeightUnit;
  timezone?: string;
  enableSetQuality?: boolean;
  restClockMode?: RestClockMode;
  defaultWeightStepKg?: number | null;
  appleFitnessEnabled?: boolean;
}

interface ParsedCustomExercise {
  oldId: string;
  name: string;
  trackingType: TrackingType;
  equipment: string;
  category: string;
  defaultRestSeconds: number;
  weightStepKg: number | null;
  aliases: string[];
}

interface ParsedStepPref {
  exerciseId: string;
  weightStepKg: number;
  updatedAt: string;
}

interface ParsedBodyMetric {
  measuredOn: string;
  weightKg: number;
  source: string;
  createdAt: string;
}

interface ParsedScheduleDayExercise {
  exerciseId: string;
  exerciseName: string;
  trackingType: TrackingType;
  orderIndex: number;
  targetSets: number;
  targetReps: number | null;
  targetRepsMin: number | null;
  targetRepsMax: number | null;
  targetTimeSeconds: number | null;
  targetWeightKg: number | null;
  targetDistanceM: number | null;
  restSeconds: number;
  notes: string;
}

interface ParsedScheduleDay {
  oldId: string;
  position: number;
  label: string;
  isRestDay: boolean;
  exercises: ParsedScheduleDayExercise[];
}

interface ParsedActiveSchedule {
  oldId: string;
  name: string;
  anchorDate: string;
  anchorIndex: number;
  days: ParsedScheduleDay[];
}

interface ParsedScheduleEvent {
  scheduleId: string | null;
  eventDate: string;
  eventType: ScheduleEventType;
  shiftDays: 1 | 2 | 3 | null;
  jollyLabel: string | null;
  createdAt: string;
}

interface ParsedWorkoutSet {
  setNumber: number;
  weightKg: number | null;
  reps: number | null;
  timeSeconds: number | null;
  distanceM: number | null;
  restSeconds: number | null;
  actualRestSeconds: number | null;
  restApproximate: boolean;
  executionQualityPct: number | null;
  isCompleted: boolean;
  repQualities: Array<{ repIndex: number; qualityPct: number }>;
}

interface ParsedWorkoutExercise {
  exerciseId: string;
  name: string;
  trackingType: TrackingType;
  orderIndex: number;
  notes: string;
  sets: ParsedWorkoutSet[];
}

interface ParsedWorkoutSession {
  sourceKey: string;
  sessionDate: string;
  title: string;
  isJolly: boolean;
  jollyMode: JollyMode | null;
  startedAt: string;
  completedAt: string | null;
  durationMinutes: number | null;
  userWeightKg: number | null;
  notes: string;
  appleHealthKcal: number | null;
  appleHealthAvgHr: number | null;
  appleHealthMaxHr: number | null;
  exercises: ParsedWorkoutExercise[];
}

interface ParsedLiftitupExport {
  exportedAt: string | null;
  user: ParsedUserSettings;
  customExercises: ParsedCustomExercise[];
  hiddenIds: string[];
  exerciseStepPrefs: ParsedStepPref[];
  bodyMetrics: ParsedBodyMetric[];
  activeSchedule: ParsedActiveSchedule | null;
  scheduleEvents: ParsedScheduleEvent[];
  sessions: ParsedWorkoutSession[];
}

const VALID_TRACKING_SET = new Set<string>(TRACKING_TYPES);
const VALID_EVENT_TYPES = new Set<string>([
  'skip',
  'postpone',
  'reset',
  'jolly_extra',
  'jolly_instead',
]);

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === 'object' && !Array.isArray(val);
}

function isTrackingType(val: unknown): val is TrackingType {
  return typeof val === 'string' && VALID_TRACKING_SET.has(val);
}

function validateNumberRange(
  val: unknown,
  path: string,
  opts: {
    min: number;
    max: number;
    integer?: boolean;
    allowNull?: boolean;
    exclusiveMin?: boolean;
  },
  errors: LiftitupRestoreValidationError[],
): number | null {
  if (val === undefined || val === null) {
    if (opts.allowNull) return null;
    errors.push({ path, message: 'is required' });
    return null;
  }
  if (typeof val !== 'number' || !Number.isFinite(val)) {
    errors.push({ path, message: 'must be a finite number' });
    return null;
  }
  if (opts.integer && !Number.isInteger(val)) {
    errors.push({ path, message: 'must be an integer' });
    return null;
  }
  const belowMin = opts.exclusiveMin ? val <= opts.min : val < opts.min;
  if (belowMin || val > opts.max) {
    const minOp = opts.exclusiveMin ? `> ${opts.min}` : `>= ${opts.min}`;
    errors.push({ path, message: `must be ${minOp} and <= ${opts.max}` });
    return null;
  }
  return val;
}

function normalizeSourceKey(
  rawId: unknown,
  fallbackParts: string[],
): string {
  if (typeof rawId === 'string' && rawId.trim().length > 0) {
    const trimmed = rawId.trim();
    if (trimmed.length <= 100) return trimmed;
    return crypto.createHash('sha256').update(trimmed).digest('hex').slice(0, 32);
  }
  return crypto
    .createHash('sha256')
    .update(fallbackParts.join('|'))
    .digest('hex')
    .slice(0, 24);
}

function parseUserSettings(
  rawUser: unknown,
  errors: LiftitupRestoreValidationError[],
): ParsedUserSettings {
  const result: ParsedUserSettings = { unit: 'kg' };
  if (rawUser === undefined) return result;
  if (!isPlainObject(rawUser)) {
    errors.push({ path: 'user', message: 'must be an object' });
    return result;
  }

  if ('heightCm' in rawUser && rawUser.heightCm !== undefined) {
    result.heightCm = validateNumberRange(
      rawUser.heightCm,
      'user.heightCm',
      { min: 100, max: 250, allowNull: true },
      errors,
    );
  }
  if ('weightKg' in rawUser && rawUser.weightKg !== undefined) {
    const w = validateNumberRange(
      rawUser.weightKg,
      'user.weightKg',
      { min: 25, max: 300 },
      errors,
    );
    if (w !== null) result.weightKg = w;
  }
  if ('age' in rawUser && rawUser.age !== undefined) {
    result.age = validateNumberRange(
      rawUser.age,
      'user.age',
      { min: 12, max: 100, integer: true, allowNull: true },
      errors,
    );
  }
  if ('trainingYears' in rawUser && rawUser.trainingYears !== undefined) {
    result.trainingYears = validateNumberRange(
      rawUser.trainingYears,
      'user.trainingYears',
      { min: 0, max: 80, allowNull: true },
      errors,
    );
  }
  if ('unit' in rawUser && rawUser.unit !== undefined) {
    if (rawUser.unit !== 'kg' && rawUser.unit !== 'lb') {
      errors.push({ path: 'user.unit', message: 'must be "kg" or "lb"' });
    } else {
      result.unit = rawUser.unit;
    }
  }
  if ('timezone' in rawUser && rawUser.timezone !== undefined) {
    if (
      typeof rawUser.timezone !== 'string' ||
      !rawUser.timezone.trim() ||
      !isValidTimezone(rawUser.timezone.trim())
    ) {
      errors.push({
        path: 'user.timezone',
        message: 'must be a valid IANA timezone',
      });
    } else {
      result.timezone = rawUser.timezone.trim();
    }
  }
  if ('enableSetQuality' in rawUser && rawUser.enableSetQuality !== undefined) {
    if (typeof rawUser.enableSetQuality !== 'boolean') {
      errors.push({
        path: 'user.enableSetQuality',
        message: 'must be a boolean',
      });
    } else {
      result.enableSetQuality = rawUser.enableSetQuality;
    }
  }
  if ('restClockMode' in rawUser && rawUser.restClockMode !== undefined) {
    if (
      rawUser.restClockMode !== 'stopwatch' &&
      rawUser.restClockMode !== 'countdown'
    ) {
      errors.push({
        path: 'user.restClockMode',
        message: 'must be "stopwatch" or "countdown"',
      });
    } else {
      result.restClockMode = rawUser.restClockMode;
    }
  }
  if (
    'defaultWeightStepKg' in rawUser &&
    rawUser.defaultWeightStepKg !== undefined
  ) {
    result.defaultWeightStepKg = validateNumberRange(
      rawUser.defaultWeightStepKg,
      'user.defaultWeightStepKg',
      { min: 0, max: 100, exclusiveMin: true, allowNull: true },
      errors,
    );
  }
  if (
    'appleFitnessEnabled' in rawUser &&
    rawUser.appleFitnessEnabled !== undefined
  ) {
    if (typeof rawUser.appleFitnessEnabled !== 'boolean') {
      errors.push({
        path: 'user.appleFitnessEnabled',
        message: 'must be a boolean',
      });
    } else {
      result.appleFitnessEnabled = rawUser.appleFitnessEnabled;
    }
  }

  return result;
}

function parseExercisesBlock(
  rawExercises: unknown,
  errors: LiftitupRestoreValidationError[],
): { customExercises: ParsedCustomExercise[]; hiddenIds: string[] } {
  const customExercises: ParsedCustomExercise[] = [];
  const hiddenIds: string[] = [];
  if (rawExercises === undefined) return { customExercises, hiddenIds };
  if (!isPlainObject(rawExercises)) {
    errors.push({ path: 'exercises', message: 'must be an object' });
    return { customExercises, hiddenIds };
  }

  if (rawExercises.custom !== undefined) {
    if (!Array.isArray(rawExercises.custom)) {
      errors.push({ path: 'exercises.custom', message: 'must be an array' });
    } else {
      rawExercises.custom.forEach((rawEx, idx) => {
        const p = `exercises.custom[${idx}]`;
        if (!isPlainObject(rawEx)) {
          errors.push({ path: p, message: 'must be an object' });
          return;
        }
        const name =
          typeof rawEx.name === 'string' ? rawEx.name.trim().slice(0, 120) : '';
        if (!name) {
          errors.push({
            path: `${p}.name`,
            message: 'must be a non-empty string',
          });
        }
        if (!isTrackingType(rawEx.trackingType)) {
          errors.push({
            path: `${p}.trackingType`,
            message: 'must be a valid trackingType',
          });
        }
        const oldId =
          typeof rawEx.id === 'string' && rawEx.id.trim()
            ? rawEx.id.trim()
            : `custom_${idx}`;
        const defaultRestSeconds =
          rawEx.defaultRestSeconds === undefined
            ? 120
            : (validateNumberRange(
                rawEx.defaultRestSeconds,
                `${p}.defaultRestSeconds`,
                { min: 0, max: 3600, integer: true },
                errors,
              ) ?? 120);
        const weightStepKg =
          rawEx.weightStepKg === undefined
            ? null
            : validateNumberRange(
                rawEx.weightStepKg,
                `${p}.weightStepKg`,
                { min: 0, max: 100, exclusiveMin: true, allowNull: true },
                errors,
              );
        const aliases = Array.isArray(rawEx.aliases)
          ? rawEx.aliases
              .filter((a): a is string => typeof a === 'string')
              .map((a) => a.trim())
              .filter(Boolean)
          : [];
        if (name && isTrackingType(rawEx.trackingType)) {
          customExercises.push({
            oldId,
            name,
            trackingType: rawEx.trackingType,
            equipment:
              typeof rawEx.equipment === 'string' && rawEx.equipment.trim()
                ? rawEx.equipment.trim().slice(0, 60)
                : 'other',
            category:
              typeof rawEx.category === 'string' && rawEx.category.trim()
                ? rawEx.category.trim().slice(0, 60)
                : 'other',
            defaultRestSeconds,
            weightStepKg,
            aliases,
          });
        }
      });
    }
  }

  if (rawExercises.hiddenIds !== undefined) {
    if (!Array.isArray(rawExercises.hiddenIds)) {
      errors.push({ path: 'exercises.hiddenIds', message: 'must be an array' });
    } else {
      rawExercises.hiddenIds.forEach((rawId, idx) => {
        if (typeof rawId !== 'string' || !rawId.trim()) {
          errors.push({
            path: `exercises.hiddenIds[${idx}]`,
            message: 'must be a non-empty string',
          });
        } else {
          hiddenIds.push(rawId.trim());
        }
      });
    }
  }

  return { customExercises, hiddenIds };
}

function parseStepPrefs(
  rawPrefs: unknown,
  errors: LiftitupRestoreValidationError[],
): ParsedStepPref[] {
  if (rawPrefs === undefined) return [];
  if (!Array.isArray(rawPrefs)) {
    errors.push({ path: 'exerciseStepPrefs', message: 'must be an array' });
    return [];
  }
  const out: ParsedStepPref[] = [];
  rawPrefs.forEach((item, idx) => {
    const p = `exerciseStepPrefs[${idx}]`;
    if (!isPlainObject(item)) {
      errors.push({ path: p, message: 'must be an object' });
      return;
    }
    if (typeof item.exerciseId !== 'string' || !item.exerciseId.trim()) {
      errors.push({
        path: `${p}.exerciseId`,
        message: 'must be a non-empty string',
      });
      return;
    }
    const step = validateNumberRange(
      item.weightStepKg,
      `${p}.weightStepKg`,
      { min: 0, max: 100, exclusiveMin: true },
      errors,
    );
    if (step !== null) {
      out.push({
        exerciseId: item.exerciseId.trim(),
        weightStepKg: step,
        updatedAt:
          typeof item.updatedAt === 'string' &&
          Number.isFinite(Date.parse(item.updatedAt))
            ? item.updatedAt
            : new Date(0).toISOString(),
      });
    }
  });
  return out;
}

function parseBodyMetrics(
  rawMetrics: unknown,
  errors: LiftitupRestoreValidationError[],
): ParsedBodyMetric[] {
  if (rawMetrics === undefined) return [];
  if (!Array.isArray(rawMetrics)) {
    errors.push({ path: 'bodyMetrics', message: 'must be an array' });
    return [];
  }
  const out: ParsedBodyMetric[] = [];
  rawMetrics.forEach((item, idx) => {
    const p = `bodyMetrics[${idx}]`;
    if (!isPlainObject(item)) {
      errors.push({ path: p, message: 'must be an object' });
      return;
    }
    if (!isValidYmd(item.measuredOn)) {
      errors.push({
        path: `${p}.measuredOn`,
        message: 'must be a valid YYYY-MM-DD date',
      });
    }
    const weightKg = validateNumberRange(
      item.weightKg,
      `${p}.weightKg`,
      { min: 25, max: 300 },
      errors,
    );
    if (isValidYmd(item.measuredOn) && weightKg !== null) {
      out.push({
        measuredOn: item.measuredOn,
        weightKg,
        source:
          typeof item.source === 'string' && item.source.trim()
            ? item.source.trim().slice(0, 60)
            : 'import',
        createdAt:
          typeof item.createdAt === 'string' &&
          Number.isFinite(Date.parse(item.createdAt))
            ? item.createdAt
            : `${item.measuredOn}T00:00:00.000Z`,
      });
    }
  });
  return out;
}

function parseActiveSchedule(
  rawSched: unknown,
  errors: LiftitupRestoreValidationError[],
): ParsedActiveSchedule | null {
  if (rawSched === undefined || rawSched === null) return null;
  if (!isPlainObject(rawSched)) {
    errors.push({ path: 'activeSchedule', message: 'must be an object or null' });
    return null;
  }

  const name =
    typeof rawSched.name === 'string' ? rawSched.name.trim().slice(0, 100) : '';
  if (!name) {
    errors.push({
      path: 'activeSchedule.name',
      message: 'must be a non-empty string',
    });
  }
  if (!isValidYmd(rawSched.anchorDate)) {
    errors.push({
      path: 'activeSchedule.anchorDate',
      message: 'must be a valid YYYY-MM-DD date',
    });
  }
  const anchorIndex = validateNumberRange(
    rawSched.anchorIndex ?? 0,
    'activeSchedule.anchorIndex',
    { min: 0, max: 30, integer: true },
    errors,
  );

  const days: ParsedScheduleDay[] = [];
  if (!Array.isArray(rawSched.days) || rawSched.days.length === 0) {
    errors.push({
      path: 'activeSchedule.days',
      message: 'must be a non-empty array',
    });
  } else if (rawSched.days.length > 31) {
    errors.push({
      path: 'activeSchedule.days',
      message: 'must have at most 31 days',
    });
  } else {
    const seenPositions = new Set<number>();
    rawSched.days.forEach((rawDay, dayIdx) => {
      const dp = `activeSchedule.days[${dayIdx}]`;
      if (!isPlainObject(rawDay)) {
        errors.push({ path: dp, message: 'must be an object' });
        return;
      }
      const position = validateNumberRange(
        rawDay.position ?? dayIdx,
        `${dp}.position`,
        { min: 0, max: 30, integer: true },
        errors,
      );
      if (position !== null) {
        if (seenPositions.has(position)) {
          errors.push({
            path: `${dp}.position`,
            message: `duplicate position ${position}`,
          });
        }
        seenPositions.add(position);
      }
      const label =
        typeof rawDay.label === 'string' ? rawDay.label.trim().slice(0, 80) : '';
      if (!label) {
        errors.push({
          path: `${dp}.label`,
          message: 'must be a non-empty string',
        });
      }
      if (typeof rawDay.isRestDay !== 'boolean') {
        errors.push({
          path: `${dp}.isRestDay`,
          message: 'must be a boolean',
        });
      }

      const exercises: ParsedScheduleDayExercise[] = [];
      if (rawDay.exercises !== undefined && !Array.isArray(rawDay.exercises)) {
        errors.push({ path: `${dp}.exercises`, message: 'must be an array' });
      } else if (Array.isArray(rawDay.exercises)) {
        rawDay.exercises.forEach((rawEx, exIdx) => {
          const ep = `${dp}.exercises[${exIdx}]`;
          if (!isPlainObject(rawEx)) {
            errors.push({ path: ep, message: 'must be an object' });
            return;
          }
          const exerciseId =
            typeof rawEx.exerciseId === 'string' ? rawEx.exerciseId.trim() : '';
          if (!exerciseId) {
            errors.push({
              path: `${ep}.exerciseId`,
              message: 'must be a non-empty string',
            });
          }
          const exerciseName =
            typeof rawEx.exerciseName === 'string' && rawEx.exerciseName.trim()
              ? rawEx.exerciseName.trim().slice(0, 120)
              : exerciseId;
          const trackingType: TrackingType = isTrackingType(rawEx.trackingType)
            ? rawEx.trackingType
            : 'weight_reps';
          const orderIndex =
            validateNumberRange(
              rawEx.orderIndex ?? exIdx,
              `${ep}.orderIndex`,
              { min: 0, max: 200, integer: true },
              errors,
            ) ?? exIdx;
          const targetSets =
            validateNumberRange(
              rawEx.targetSets ?? 3,
              `${ep}.targetSets`,
              { min: 1, max: 20, integer: true },
              errors,
            ) ?? 3;
          const targetReps =
            rawEx.targetReps === undefined
              ? null
              : validateNumberRange(
                  rawEx.targetReps,
                  `${ep}.targetReps`,
                  { min: 1, max: 200, integer: true, allowNull: true },
                  errors,
                );
          const targetRepsMin =
            rawEx.targetRepsMin === undefined
              ? null
              : validateNumberRange(
                  rawEx.targetRepsMin,
                  `${ep}.targetRepsMin`,
                  { min: 1, max: 200, integer: true, allowNull: true },
                  errors,
                );
          const targetRepsMax =
            rawEx.targetRepsMax === undefined
              ? null
              : validateNumberRange(
                  rawEx.targetRepsMax,
                  `${ep}.targetRepsMax`,
                  { min: 1, max: 200, integer: true, allowNull: true },
                  errors,
                );
          const targetTimeSeconds =
            rawEx.targetTimeSeconds === undefined
              ? null
              : validateNumberRange(
                  rawEx.targetTimeSeconds,
                  `${ep}.targetTimeSeconds`,
                  { min: 1, max: 86400, integer: true, allowNull: true },
                  errors,
                );
          const targetWeightKg =
            rawEx.targetWeightKg === undefined
              ? null
              : validateNumberRange(
                  rawEx.targetWeightKg,
                  `${ep}.targetWeightKg`,
                  { min: 0, max: 1000, allowNull: true },
                  errors,
                );
          const targetDistanceM =
            rawEx.targetDistanceM === undefined
              ? null
              : validateNumberRange(
                  rawEx.targetDistanceM,
                  `${ep}.targetDistanceM`,
                  { min: 0, max: 200000, exclusiveMin: true, allowNull: true },
                  errors,
                );
          const restSeconds =
            validateNumberRange(
              rawEx.restSeconds ?? 120,
              `${ep}.restSeconds`,
              { min: 0, max: 3600, integer: true },
              errors,
            ) ?? 120;
          const notes =
            typeof rawEx.notes === 'string'
              ? rawEx.notes.trim().slice(0, 500)
              : '';

          if (exerciseId) {
            exercises.push({
              exerciseId,
              exerciseName,
              trackingType,
              orderIndex,
              targetSets,
              targetReps,
              targetRepsMin,
              targetRepsMax,
              targetTimeSeconds,
              targetWeightKg,
              targetDistanceM,
              restSeconds,
              notes,
            });
          }
        });
      }

      if (
        position !== null &&
        label &&
        typeof rawDay.isRestDay === 'boolean'
      ) {
        days.push({
          oldId:
            typeof rawDay.id === 'string' && rawDay.id.trim()
              ? rawDay.id.trim()
              : `day_${dayIdx}`,
          position,
          label,
          isRestDay: rawDay.isRestDay,
          exercises,
        });
      }
    });
  }

  if (
    !name ||
    !isValidYmd(rawSched.anchorDate) ||
    anchorIndex === null ||
    days.length === 0
  ) {
    return null;
  }

  return {
    oldId:
      typeof rawSched.id === 'string' && rawSched.id.trim()
        ? rawSched.id.trim()
        : 'sched_export',
    name,
    anchorDate: rawSched.anchorDate,
    anchorIndex,
    days,
  };
}

function parseScheduleEvents(
  rawEvents: unknown,
  errors: LiftitupRestoreValidationError[],
): ParsedScheduleEvent[] {
  if (rawEvents === undefined) return [];
  if (!Array.isArray(rawEvents)) {
    errors.push({ path: 'scheduleEvents', message: 'must be an array' });
    return [];
  }
  const out: ParsedScheduleEvent[] = [];
  rawEvents.forEach((ev, idx) => {
    const p = `scheduleEvents[${idx}]`;
    if (!isPlainObject(ev)) {
      errors.push({ path: p, message: 'must be an object' });
      return;
    }
    if (!isValidYmd(ev.eventDate)) {
      errors.push({
        path: `${p}.eventDate`,
        message: 'must be a valid YYYY-MM-DD date',
      });
    }
    if (typeof ev.eventType !== 'string' || !VALID_EVENT_TYPES.has(ev.eventType)) {
      errors.push({
        path: `${p}.eventType`,
        message: 'must be a valid schedule event type',
      });
    }
    let shiftDays: 1 | 2 | 3 | null = null;
    if (ev.shiftDays !== undefined && ev.shiftDays !== null) {
      if (ev.shiftDays !== 1 && ev.shiftDays !== 2 && ev.shiftDays !== 3) {
        errors.push({
          path: `${p}.shiftDays`,
          message: 'must be 1, 2, 3, or null',
        });
      } else {
        shiftDays = ev.shiftDays;
      }
    }
    if (
      isValidYmd(ev.eventDate) &&
      typeof ev.eventType === 'string' &&
      VALID_EVENT_TYPES.has(ev.eventType)
    ) {
      out.push({
        scheduleId:
          typeof ev.scheduleId === 'string' && ev.scheduleId.trim()
            ? ev.scheduleId.trim()
            : null,
        eventDate: ev.eventDate,
        eventType: ev.eventType as ScheduleEventType,
        shiftDays,
        jollyLabel:
          typeof ev.jollyLabel === 'string' && ev.jollyLabel.trim()
            ? ev.jollyLabel.trim().slice(0, 80)
            : null,
        createdAt:
          typeof ev.createdAt === 'string' &&
          Number.isFinite(Date.parse(ev.createdAt))
            ? ev.createdAt
            : `${ev.eventDate}T00:00:00.000Z`,
      });
    }
  });
  return out;
}

function parseSessions(
  rawSessions: unknown,
  errors: LiftitupRestoreValidationError[],
): ParsedWorkoutSession[] {
  if (!Array.isArray(rawSessions)) {
    errors.push({ path: 'sessions', message: 'must be an array' });
    return [];
  }

  const out: ParsedWorkoutSession[] = [];
  rawSessions.forEach((rawSes, sIdx) => {
    const sp = `sessions[${sIdx}]`;
    if (!isPlainObject(rawSes)) {
      errors.push({ path: sp, message: 'must be an object' });
      return;
    }

    if (!isValidYmd(rawSes.sessionDate)) {
      errors.push({
        path: `${sp}.sessionDate`,
        message: 'must be a valid YYYY-MM-DD date',
      });
    }
    const title =
      typeof rawSes.title === 'string'
        ? rawSes.title.trim().slice(0, 120)
        : '';
    if (!title) {
      errors.push({
        path: `${sp}.title`,
        message: 'must be a non-empty string',
      });
    }

    const isJolly =
      rawSes.isJolly === undefined ? false : Boolean(rawSes.isJolly);
    let jollyMode: JollyMode | null = null;
    if (isJolly) {
      if (
        rawSes.jollyMode !== undefined &&
        rawSes.jollyMode !== null &&
        rawSes.jollyMode !== 'extra' &&
        rawSes.jollyMode !== 'instead'
      ) {
        errors.push({
          path: `${sp}.jollyMode`,
          message: 'must be "extra", "instead", or null',
        });
      } else {
        jollyMode = (rawSes.jollyMode as JollyMode | null | undefined) ?? 'extra';
      }
    }

    const startedAt =
      typeof rawSes.startedAt === 'string' &&
      rawSes.startedAt.trim() &&
      Number.isFinite(Date.parse(rawSes.startedAt))
        ? rawSes.startedAt.trim()
        : isValidYmd(rawSes.sessionDate)
          ? `${rawSes.sessionDate}T12:00:00.000Z`
          : '';
    if (
      rawSes.startedAt !== undefined &&
      (typeof rawSes.startedAt !== 'string' ||
        !Number.isFinite(Date.parse(rawSes.startedAt)))
    ) {
      errors.push({
        path: `${sp}.startedAt`,
        message: 'must be a valid ISO timestamp',
      });
    }

    let completedAt: string | null = null;
    if (rawSes.completedAt !== undefined && rawSes.completedAt !== null) {
      if (
        typeof rawSes.completedAt !== 'string' ||
        !Number.isFinite(Date.parse(rawSes.completedAt))
      ) {
        errors.push({
          path: `${sp}.completedAt`,
          message: 'must be a valid ISO timestamp or null',
        });
      } else {
        completedAt = rawSes.completedAt.trim();
      }
    }

    const durationMinutes =
      rawSes.durationMinutes === undefined
        ? null
        : validateNumberRange(
            rawSes.durationMinutes,
            `${sp}.durationMinutes`,
            { min: 0, max: 600, integer: true, allowNull: true },
            errors,
          );
    const userWeightKg =
      rawSes.userWeightKg === undefined
        ? null
        : validateNumberRange(
            rawSes.userWeightKg,
            `${sp}.userWeightKg`,
            { min: 20, max: 400, allowNull: true },
            errors,
          );
    const notes =
      typeof rawSes.notes === 'string' ? rawSes.notes.trim().slice(0, 4000) : '';

    let kcal: number | null = null;
    let avgHr: number | null = null;
    let maxHr: number | null = null;
    if (rawSes.appleHealth !== undefined && rawSes.appleHealth !== null) {
      if (!isPlainObject(rawSes.appleHealth)) {
        errors.push({
          path: `${sp}.appleHealth`,
          message: 'must be an object',
        });
      } else {
        kcal =
          rawSes.appleHealth.kcal === undefined
            ? null
            : validateNumberRange(
                rawSes.appleHealth.kcal,
                `${sp}.appleHealth.kcal`,
                { min: 0, max: 20000, integer: true, allowNull: true },
                errors,
              );
        avgHr =
          rawSes.appleHealth.avgHr === undefined
            ? null
            : validateNumberRange(
                rawSes.appleHealth.avgHr,
                `${sp}.appleHealth.avgHr`,
                { min: 20, max: 260, integer: true, allowNull: true },
                errors,
              );
        maxHr =
          rawSes.appleHealth.maxHr === undefined
            ? null
            : validateNumberRange(
                rawSes.appleHealth.maxHr,
                `${sp}.appleHealth.maxHr`,
                { min: 20, max: 260, integer: true, allowNull: true },
                errors,
              );
      }
    }

    const exercises: ParsedWorkoutExercise[] = [];
    if (!Array.isArray(rawSes.exercises)) {
      errors.push({ path: `${sp}.exercises`, message: 'must be an array' });
    } else {
      rawSes.exercises.forEach((rawEx, eIdx) => {
        const ep = `${sp}.exercises[${eIdx}]`;
        if (!isPlainObject(rawEx)) {
          errors.push({ path: ep, message: 'must be an object' });
          return;
        }
        const exerciseId =
          typeof rawEx.exerciseId === 'string' ? rawEx.exerciseId.trim() : '';
        const name =
          typeof rawEx.name === 'string'
            ? rawEx.name.trim().slice(0, 120)
            : exerciseId;
        if (!name && !exerciseId) {
          errors.push({
            path: `${ep}.name`,
            message: 'must provide name or exerciseId',
          });
        }
        const trackingType: TrackingType = isTrackingType(rawEx.trackingType)
          ? rawEx.trackingType
          : 'weight_reps';
        const orderIndex =
          validateNumberRange(
            rawEx.orderIndex ?? eIdx,
            `${ep}.orderIndex`,
            { min: 0, max: 200, integer: true },
            errors,
          ) ?? eIdx;
        const exNotes =
          typeof rawEx.notes === 'string'
            ? rawEx.notes.trim().slice(0, 2000)
            : '';

        const sets: ParsedWorkoutSet[] = [];
        if (!Array.isArray(rawEx.sets)) {
          errors.push({ path: `${ep}.sets`, message: 'must be an array' });
        } else {
          rawEx.sets.forEach((rawSet, setIdx) => {
            const stp = `${ep}.sets[${setIdx}]`;
            if (!isPlainObject(rawSet)) {
              errors.push({ path: stp, message: 'must be an object' });
              return;
            }
            const setNumber =
              validateNumberRange(
                rawSet.setNumber ?? setIdx + 1,
                `${stp}.setNumber`,
                { min: 1, max: 200, integer: true },
                errors,
              ) ?? setIdx + 1;
            const weightKg =
              rawSet.weightKg === undefined
                ? null
                : validateNumberRange(
                    rawSet.weightKg,
                    `${stp}.weightKg`,
                    { min: 0, max: 1500, allowNull: true },
                    errors,
                  );
            const reps =
              rawSet.reps === undefined
                ? null
                : validateNumberRange(
                    rawSet.reps,
                    `${stp}.reps`,
                    { min: 0, max: 1000, integer: true, allowNull: true },
                    errors,
                  );
            const timeSeconds =
              rawSet.timeSeconds === undefined
                ? null
                : validateNumberRange(
                    rawSet.timeSeconds,
                    `${stp}.timeSeconds`,
                    { min: 0, max: 86400, integer: true, allowNull: true },
                    errors,
                  );
            const distanceM =
              rawSet.distanceM === undefined
                ? null
                : validateNumberRange(
                    rawSet.distanceM,
                    `${stp}.distanceM`,
                    { min: 0, max: 1_000_000, allowNull: true },
                    errors,
                  );
            const restSeconds =
              rawSet.restSeconds === undefined
                ? null
                : validateNumberRange(
                    rawSet.restSeconds,
                    `${stp}.restSeconds`,
                    { min: 0, max: 3600, integer: true, allowNull: true },
                    errors,
                  );
            const actualRestSeconds =
              rawSet.actualRestSeconds === undefined
                ? null
                : validateNumberRange(
                    rawSet.actualRestSeconds,
                    `${stp}.actualRestSeconds`,
                    { min: 0, max: 86400, integer: true, allowNull: true },
                    errors,
                  );
            const restApproximate =
              actualRestSeconds !== null && Boolean(rawSet.restApproximate);
            const executionQualityPct =
              rawSet.executionQualityPct === undefined
                ? null
                : validateNumberRange(
                    rawSet.executionQualityPct,
                    `${stp}.executionQualityPct`,
                    { min: 0, max: 100, integer: true, allowNull: true },
                    errors,
                  );
            const isCompleted = rawSet.isCompleted !== false;

            const repQualities: Array<{ repIndex: number; qualityPct: number }> =
              [];
            if (Array.isArray(rawSet.repQualities)) {
              const seenReps = new Set<number>();
              rawSet.repQualities.forEach((rq, rqIdx) => {
                if (!isPlainObject(rq)) {
                  errors.push({
                    path: `${stp}.repQualities[${rqIdx}]`,
                    message: 'must be an object',
                  });
                  return;
                }
                const repIndex = validateNumberRange(
                  rq.repIndex,
                  `${stp}.repQualities[${rqIdx}].repIndex`,
                  { min: 1, max: 1000, integer: true },
                  errors,
                );
                const qualityPct = validateNumberRange(
                  rq.qualityPct,
                  `${stp}.repQualities[${rqIdx}].qualityPct`,
                  { min: 0, max: 100, integer: true },
                  errors,
                );
                if (
                  repIndex !== null &&
                  qualityPct !== null &&
                  !seenReps.has(repIndex)
                ) {
                  seenReps.add(repIndex);
                  repQualities.push({ repIndex, qualityPct });
                }
              });
            }

            sets.push({
              setNumber,
              weightKg,
              reps,
              timeSeconds,
              distanceM,
              restSeconds,
              actualRestSeconds,
              restApproximate,
              executionQualityPct,
              isCompleted,
              repQualities,
            });
          });
        }

        exercises.push({
          exerciseId: exerciseId || name,
          name: name || exerciseId,
          trackingType,
          orderIndex,
          notes: exNotes,
          sets,
        });
      });
    }

    if (isValidYmd(rawSes.sessionDate) && title && startedAt) {
      out.push({
        sourceKey: normalizeSourceKey(rawSes.id, [
          rawSes.sessionDate,
          startedAt,
          title,
          String(sIdx),
        ]),
        sessionDate: rawSes.sessionDate,
        title,
        isJolly,
        jollyMode,
        startedAt,
        completedAt,
        durationMinutes,
        userWeightKg,
        notes,
        appleHealthKcal: kcal,
        appleHealthAvgHr: avgHr,
        appleHealthMaxHr: maxHr,
        exercises,
      });
    }
  });

  return out;
}

export function parseAndValidateLiftitupExport(rawText: string): {
  valid: boolean;
  errors: LiftitupRestoreValidationError[];
  payload: ParsedLiftitupExport | null;
} {
  if (typeof rawText !== 'string' || !rawText.trim()) {
    return {
      valid: false,
      errors: [{ path: 'root', message: 'Import JSON is empty' }],
      payload: null,
    };
  }

  if (Buffer.byteLength(rawText, 'utf8') > MAX_IMPORT_BYTES) {
    return {
      valid: false,
      errors: [{ path: 'root', message: 'Import file exceeds 8 MB limit' }],
      payload: null,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText) as unknown;
  } catch (err) {
    return {
      valid: false,
      errors: [
        {
          path: 'root',
          message: `Invalid JSON (${err instanceof Error ? err.message : 'parse error'})`,
        },
      ],
      payload: null,
    };
  }

  if (!isPlainObject(parsed)) {
    return {
      valid: false,
      errors: [{ path: 'root', message: 'JSON root must be an object' }],
      payload: null,
    };
  }

  const errors: LiftitupRestoreValidationError[] = [];

  if (parsed.schemaVersion !== 2) {
    errors.push({
      path: 'schemaVersion',
      message: 'Expected Liftitup export schemaVersion 2',
    });
  }

  const exportedAt =
    typeof parsed.exportedAt === 'string' && parsed.exportedAt.trim()
      ? parsed.exportedAt.trim()
      : null;

  const user = parseUserSettings(parsed.user, errors);
  const { customExercises, hiddenIds } = parseExercisesBlock(
    parsed.exercises,
    errors,
  );
  const exerciseStepPrefs = parseStepPrefs(parsed.exerciseStepPrefs, errors);
  const bodyMetrics = parseBodyMetrics(parsed.bodyMetrics, errors);
  const activeSchedule = parseActiveSchedule(parsed.activeSchedule, errors);
  const scheduleEvents = parseScheduleEvents(parsed.scheduleEvents, errors);
  const sessions = parseSessions(parsed.sessions, errors);

  if (errors.length > 0) {
    return { valid: false, errors, payload: null };
  }

  return {
    valid: true,
    errors: [],
    payload: {
      exportedAt,
      user,
      customExercises,
      hiddenIds,
      exerciseStepPrefs,
      bodyMetrics,
      activeSchedule,
      scheduleEvents,
      sessions,
    },
  };
}

interface MatchingAnalysis {
  existingPool: Exercise[];
  catalogById: Map<string, Exercise>;
  exportCustomById: Map<string, ParsedCustomExercise>;
  reusedCustomByOldId: Map<string, Exercise>;
  customToCreate: ParsedCustomExercise[];
  unmatchedExercises: Array<{
    key: string;
    name: string;
    suggestedTrackingType: TrackingType;
    occurrences: number;
  }>;
  matchedCount: number;
  warnings: string[];
}

function toMatchableList(exercises: readonly Exercise[]): MatchableExercise[] {
  return exercises.map((ex) => ({
    id: ex.id,
    name: ex.name,
    trackingType: ex.trackingType,
    isCustom: ex.isCustom,
    aliases: ex.aliases,
  }));
}

function analyzeExerciseMatching(
  payload: ParsedLiftitupExport,
  allUserExercises: readonly Exercise[],
  mode: RestoreMode,
): MatchingAnalysis {
  // In Replace mode, user's old custom exercises will be deleted before restore,
  // so only built-in catalog exercises survive from the existing DB pool.
  const existingPool =
    mode === 'replace'
      ? allUserExercises.filter((ex) => !ex.isCustom)
      : [...allUserExercises];

  const catalogById = new Map<string, Exercise>();
  for (const ex of existingPool) {
    if (!ex.isCustom) {
      catalogById.set(ex.id, ex);
    }
  }

  const existingMatchables = toMatchableList(existingPool);
  const exportCustomById = new Map<string, ParsedCustomExercise>();
  for (const cex of payload.customExercises) {
    exportCustomById.set(cex.oldId, cex);
  }

  const exportCustomMatchables: MatchableExercise[] = payload.customExercises.map(
    (cex) => ({
      id: cex.oldId,
      name: cex.name,
      trackingType: cex.trackingType,
      isCustom: true,
      aliases: cex.aliases,
    }),
  );

  // Determine which export custom exercises match existing user custom exercises (in Merge mode)
  const reusedCustomByOldId = new Map<string, Exercise>();
  const customToCreate: ParsedCustomExercise[] = [];
  const existingCustomOnly = existingPool.filter((ex) => ex.isCustom);
  const existingCustomMatchables = toMatchableList(existingCustomOnly);

  for (const cex of payload.customExercises) {
    if (mode === 'merge') {
      const matched =
        matchExerciseName(cex.name, existingCustomMatchables) ??
        cex.aliases
          .map((a) => matchExerciseName(a, existingCustomMatchables))
          .find((m): m is MatchableExercise => m !== null);
      if (matched) {
        const full = existingCustomOnly.find((e) => e.id === matched.id);
        if (full) {
          reusedCustomByOldId.set(cex.oldId, full);
          continue;
        }
      }
    }
    customToCreate.push(cex);
  }

  const unmatchedByKey = new Map<
    string,
    {
      key: string;
      name: string;
      suggestedTrackingType: TrackingType;
      occurrences: number;
    }
  >();
  let matchedCount = 0;

  const checkExerciseRef = (
    refId: string,
    refName: string,
    trackingType: TrackingType,
  ) => {
    if (catalogById.has(refId)) {
      matchedCount += 1;
      return;
    }
    if (exportCustomById.has(refId)) {
      matchedCount += 1;
      return;
    }
    const matchedDb = matchExerciseName(refName, existingMatchables);
    if (matchedDb) {
      matchedCount += 1;
      return;
    }
    const matchedExportCustom = matchExerciseName(
      refName,
      exportCustomMatchables,
    );
    if (matchedExportCustom) {
      matchedCount += 1;
      return;
    }

    const cleanName = refName.trim() || refId;
    const key = cleanName.toLowerCase();
    const existing = unmatchedByKey.get(key);
    if (existing) {
      existing.occurrences += 1;
    } else {
      unmatchedByKey.set(key, {
        key,
        name: cleanName,
        suggestedTrackingType: trackingType,
        occurrences: 1,
      });
    }
  };

  for (const session of payload.sessions) {
    for (const ex of session.exercises) {
      checkExerciseRef(ex.exerciseId, ex.name, ex.trackingType);
    }
  }
  if (payload.activeSchedule) {
    for (const day of payload.activeSchedule.days) {
      for (const ex of day.exercises) {
        checkExerciseRef(ex.exerciseId, ex.exerciseName, ex.trackingType);
      }
    }
  }

  const warnings: string[] = [];
  const unresolvedHidden = payload.hiddenIds.filter(
    (id) => !catalogById.has(id) && !exportCustomById.has(id),
  );
  if (unresolvedHidden.length > 0) {
    warnings.push(
      `${unresolvedHidden.length} hidden exercise ID(s) do not match the catalog or exported custom exercises and will be skipped.`,
    );
  }
  const unresolvedStepPrefs = payload.exerciseStepPrefs.filter(
    (p) => !catalogById.has(p.exerciseId) && !exportCustomById.has(p.exerciseId),
  );
  if (unresolvedStepPrefs.length > 0) {
    warnings.push(
      `${unresolvedStepPrefs.length} exercise step preference(s) do not match the catalog or exported custom exercises and will be skipped.`,
    );
  }

  return {
    existingPool,
    catalogById,
    exportCustomById,
    reusedCustomByOldId,
    customToCreate,
    unmatchedExercises: Array.from(unmatchedByKey.values()),
    matchedCount,
    warnings,
  };
}

export async function validateLiftitupRestore(
  user: UserProfile,
  rawText: string,
  options?: ValidateLiftitupOptions,
): Promise<LiftitupValidateResult> {
  const mode: RestoreMode = options?.mode === 'replace' ? 'replace' : 'merge';
  const parsed = parseAndValidateLiftitupExport(rawText);
  if (!parsed.valid || !parsed.payload) {
    return {
      valid: false,
      errors: parsed.errors,
      preview: null,
    };
  }

  const payload = parsed.payload;
  const allUserExercises = await listExercises(user.id, { includeHidden: true });
  const analysis = analyzeExerciseMatching(payload, allUserExercises, mode);
  const existingSchedule = await getActiveSchedule(user.id);

  let dateRange: { from: string; to: string } | null = null;
  if (payload.sessions.length > 0) {
    let minDate = payload.sessions[0].sessionDate;
    let maxDate = payload.sessions[0].sessionDate;
    for (const s of payload.sessions) {
      if (s.sessionDate < minDate) minDate = s.sessionDate;
      if (s.sessionDate > maxDate) maxDate = s.sessionDate;
    }
    dateRange = { from: minDate, to: maxDate };
  }

  const willKeepExisting =
    mode === 'merge' &&
    payload.activeSchedule !== null &&
    existingSchedule !== null;

  const warnings = [...analysis.warnings];
  if (willKeepExisting) {
    warnings.push(
      `You already have an active split ("${existingSchedule!.name}"). Merge mode keeps your existing active split.`,
    );
  }

  const relevantEventsCount = payload.activeSchedule
    ? payload.scheduleEvents.filter(
        (ev) =>
          ev.scheduleId === null || ev.scheduleId === payload.activeSchedule!.oldId,
      ).length
    : 0;

  return {
    valid: true,
    errors: [],
    preview: {
      mode,
      unit: payload.user.unit,
      exportedAt: payload.exportedAt,
      sessionsCount: payload.sessions.length,
      dateRange,
      exercisesMatchedCount: analysis.matchedCount,
      customExercisesFromExport: payload.customExercises.map((cex) => ({
        oldId: cex.oldId,
        name: cex.name,
        trackingType: cex.trackingType,
        weightStepKg: cex.weightStepKg,
        alreadyExists: analysis.reusedCustomByOldId.has(cex.oldId),
      })),
      unmatchedExercises: analysis.unmatchedExercises,
      availableExercises: analysis.existingPool.map((ex) => ({
        id: ex.id,
        name: ex.name,
        trackingType: ex.trackingType,
        isCustom: ex.isCustom,
      })),
      bodyMetricsCount: payload.bodyMetrics.length,
      hiddenExercisesCount: payload.hiddenIds.length,
      exerciseStepPrefsCount: payload.exerciseStepPrefs.length,
      activeScheduleSummary: payload.activeSchedule
        ? {
            name: payload.activeSchedule.name,
            daysCount: payload.activeSchedule.days.length,
            eventsCount: relevantEventsCount,
            willKeepExisting,
          }
        : null,
      warnings,
      replaceWarning: {
        willDelete: [
          'All existing workout sessions, sets, rep qualities, and exercise swaps',
          'All splits / schedules (active and inactive) and schedule events',
          'All body metrics and custom exercises',
          'All hidden exercise flags and per-exercise weight step overrides',
        ],
        cannotRestore: [
          'Inactive splits (exports only contain the active split)',
          'Apple Health workout session links and un-exported Apple Health data',
          'Anything logged after the export file was created',
        ],
        preserves: [
          'Your account login, API key, and active browser sessions',
          'Apple Health workout rows (unlinked from deleted sessions)',
          'Progress photos (neither Merge nor Replace touches photos)',
        ],
      },
    },
  };
}

export async function applyLiftitupRestore(
  user: UserProfile,
  rawText: string,
  options?: ApplyLiftitupOptions,
): Promise<LiftitupApplyResult> {
  const mode: RestoreMode = options?.mode === 'replace' ? 'replace' : 'merge';

  if (Buffer.byteLength(rawText, 'utf8') > MAX_IMPORT_BYTES) {
    throw ApiError.validation('Import file exceeds 8 MB limit');
  }

  const parsed = parseAndValidateLiftitupExport(rawText);
  if (!parsed.valid || !parsed.payload) {
    throw ApiError.validation('Invalid Liftitup export JSON', {
      errors: parsed.errors,
    });
  }

  if (mode === 'replace') {
    const provided =
      typeof options?.confirmation === 'string'
        ? options.confirmation.trim().toUpperCase()
        : '';
    if (provided !== REPLACE_CONFIRMATION_WORD) {
      throw ApiError.validation(
        `Please type ${REPLACE_CONFIRMATION_WORD} to confirm replacing all account data`,
      );
    }
  }

  const payload = parsed.payload;
  const allUserExercises = await listExercises(user.id, { includeHidden: true });
  const analysis = analyzeExerciseMatching(payload, allUserExercises, mode);
  const resolutions = options?.exerciseResolutions ?? {};
  const availableById = new Map(analysis.existingPool.map((ex) => [ex.id, ex]));

  // Validate every unmatched exercise resolution BEFORE deleting or writing anything.
  const validatedResolutions = new Map<string, UnmatchedExerciseResolution>();
  for (const unmatched of analysis.unmatchedExercises) {
    const res = resolutions[unmatched.key] ?? resolutions[unmatched.name];
    if (!res || (res.action !== 'map' && res.action !== 'create_custom')) {
      throw ApiError.validation(
        `Unmatched exercise "${unmatched.name}" must be mapped to an existing exercise or created as custom`,
      );
    }
    if (res.action === 'map') {
      if (
        typeof res.targetExerciseId !== 'string' ||
        !availableById.has(res.targetExerciseId.trim())
      ) {
        throw ApiError.validation(
          `Mapped exercise for "${unmatched.name}" does not exist in available exercises`,
        );
      }
      validatedResolutions.set(unmatched.key, {
        action: 'map',
        targetExerciseId: res.targetExerciseId.trim(),
      });
    } else {
      if (!isTrackingType(res.trackingType)) {
        throw ApiError.validation(
          `Custom exercise "${unmatched.name}" has an invalid trackingType`,
        );
      }
      const customName =
        typeof res.name === 'string' && res.name.trim()
          ? res.name.trim().slice(0, 120)
          : unmatched.name;
      validatedResolutions.set(unmatched.key, {
        action: 'create_custom',
        name: customName,
        trackingType: res.trackingType,
      });
    }
  }

  return withTransaction(async () => {
    let isCleanAccount = false;
    if (mode === 'replace') {
      await resetUserAccountDataForRestoreInTx(user.id);
      isCleanAccount = true;
    } else {
      const [hasSession, hasSched, hasMetric] = await Promise.all([
        query('SELECT 1 AS ok FROM workout_sessions WHERE user_id = $1 LIMIT 1', [
          user.id,
        ]),
        query('SELECT 1 AS ok FROM schedules WHERE user_id = $1 LIMIT 1', [
          user.id,
        ]),
        query('SELECT 1 AS ok FROM body_metrics WHERE user_id = $1 LIMIT 1', [
          user.id,
        ]),
      ]);
      isCleanAccount =
        hasSession.rows.length === 0 &&
        hasSched.rows.length === 0 &&
        hasMetric.rows.length === 0;
    }

    const skippedItems: Array<{ item: string; reason: string }> = [];

    // 1. Create / map custom exercises from export (never reuse exported IDs)
    const oldCustomIdToNewId = new Map<string, string>();
    const customExercisesByNewMatch: MatchableExercise[] = [];
    let customExercisesCreated = 0;
    let customExercisesReused = 0;

    for (const [oldId, existingEx] of analysis.reusedCustomByOldId.entries()) {
      oldCustomIdToNewId.set(oldId, existingEx.id);
      customExercisesByNewMatch.push({
        id: existingEx.id,
        name: existingEx.name,
        trackingType: existingEx.trackingType,
        isCustom: true,
        aliases: existingEx.aliases,
      });
      customExercisesReused += 1;
    }

    for (const cex of analysis.customToCreate) {
      const created = await createCustomExercise(user.id, {
        name: cex.name,
        trackingType: cex.trackingType,
        equipment: cex.equipment,
        category: cex.category,
        defaultRestSeconds: cex.defaultRestSeconds,
        weightStepKg: cex.weightStepKg,
        aliases: cex.aliases,
      });
      oldCustomIdToNewId.set(cex.oldId, created.id);
      customExercisesByNewMatch.push({
        id: created.id,
        name: created.name,
        trackingType: created.trackingType,
        isCustom: true,
        aliases: created.aliases,
      });
      customExercisesCreated += 1;
    }

    // 2. Create / map user resolutions for unmatched exercises
    const unmatchedKeyToExerciseId = new Map<string, string>();
    for (const unmatched of analysis.unmatchedExercises) {
      const res = validatedResolutions.get(unmatched.key)!;
      if (res.action === 'map') {
        unmatchedKeyToExerciseId.set(unmatched.key, res.targetExerciseId);
      } else {
        const created = await createCustomExercise(user.id, {
          name: res.name ?? unmatched.name,
          trackingType: res.trackingType,
        });
        unmatchedKeyToExerciseId.set(unmatched.key, created.id);
        customExercisesCreated += 1;
      }
    }

    const existingPoolMatchables = toMatchableList(analysis.existingPool);

    const resolveExerciseRefId = (refId: string, refName: string): string => {
      if (analysis.catalogById.has(refId)) {
        return refId;
      }
      const mappedCustomId = oldCustomIdToNewId.get(refId);
      if (mappedCustomId) {
        return mappedCustomId;
      }
      const matchedDb = matchExerciseName(refName, existingPoolMatchables);
      if (matchedDb) {
        return matchedDb.id;
      }
      const matchedExportCustom = matchExerciseName(
        refName,
        customExercisesByNewMatch,
      );
      if (matchedExportCustom) {
        return matchedExportCustom.id;
      }
      const key = (refName.trim() || refId).toLowerCase();
      const resolvedUnmatched = unmatchedKeyToExerciseId.get(key);
      if (resolvedUnmatched) {
        return resolvedUnmatched;
      }
      throw new Error(`Failed to resolve exercise "${refName}" (${refId})`);
    };

    const resolveCatalogOrCustomId = (refId: string): string | null => {
      if (analysis.catalogById.has(refId)) return refId;
      return oldCustomIdToNewId.get(refId) ?? null;
    };

    // 3. Apply user profile / training settings (never id/username)
    const userPatch: UpdateUserSettingsInput = {};
    if (mode === 'replace' || isCleanAccount) {
      if (payload.user.heightCm !== undefined) {
        userPatch.heightCm = payload.user.heightCm;
      }
      if (payload.user.weightKg !== undefined) {
        userPatch.weightKg = payload.user.weightKg;
      }
      if (payload.user.age !== undefined) {
        userPatch.age = payload.user.age;
      }
      if (payload.user.trainingYears !== undefined) {
        userPatch.trainingYears = payload.user.trainingYears;
      }
      userPatch.unit = payload.user.unit;
      if (payload.user.timezone !== undefined) {
        userPatch.timezone = payload.user.timezone;
      }
      if (payload.user.enableSetQuality !== undefined) {
        userPatch.enableSetQuality = payload.user.enableSetQuality;
      }
      if (payload.user.restClockMode !== undefined) {
        userPatch.restClockMode = payload.user.restClockMode;
      }
      if (payload.user.defaultWeightStepKg !== undefined) {
        userPatch.defaultWeightStepKg = payload.user.defaultWeightStepKg;
      }
      if (payload.user.appleFitnessEnabled !== undefined) {
        userPatch.appleFitnessEnabled = payload.user.appleFitnessEnabled;
      }
    } else {
      // Existing account in Merge mode: only fill unset/null fields
      if (user.heightCm === null && payload.user.heightCm !== undefined) {
        userPatch.heightCm = payload.user.heightCm;
      }
      if (user.age === null && payload.user.age !== undefined) {
        userPatch.age = payload.user.age;
      }
      if (
        user.trainingYears === null &&
        payload.user.trainingYears !== undefined
      ) {
        userPatch.trainingYears = payload.user.trainingYears;
      }
      if (
        user.defaultWeightStepKg === null &&
        payload.user.defaultWeightStepKg !== undefined
      ) {
        userPatch.defaultWeightStepKg = payload.user.defaultWeightStepKg;
      }
    }
    if (Object.keys(userPatch).length > 0) {
      await updateUserSettings(user.id, userPatch);
    }

    const nowIso = new Date().toISOString();

    // 4. Restore hidden exercises
    let hiddenExercisesApplied = 0;
    for (const rawHiddenId of payload.hiddenIds) {
      const targetId = resolveCatalogOrCustomId(rawHiddenId);
      if (!targetId) {
        skippedItems.push({
          item: `Hidden exercise (${rawHiddenId})`,
          reason: 'Exercise ID not found in catalog or exported custom exercises',
        });
        continue;
      }
      const res = await query(
        'INSERT INTO hidden_exercises (user_id, exercise_id, hidden_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [user.id, targetId, nowIso],
      );
      if (Number(res.rowCount ?? 0) > 0) {
        hiddenExercisesApplied += 1;
      }
    }

    // 5. Restore per-exercise weight step overrides
    let exerciseStepPrefsApplied = 0;
    let exerciseStepPrefsSkipped = 0;
    for (const pref of payload.exerciseStepPrefs) {
      const targetId = resolveCatalogOrCustomId(pref.exerciseId);
      if (!targetId) {
        exerciseStepPrefsSkipped += 1;
        skippedItems.push({
          item: `Exercise step pref (${pref.exerciseId})`,
          reason: 'Exercise ID not found in catalog or exported custom exercises',
        });
        continue;
      }
      if (mode === 'replace') {
        await query(
          `
          INSERT INTO user_exercise_prefs (user_id, exercise_id, weight_step_kg, updated_at)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (user_id, exercise_id) DO UPDATE SET
            weight_step_kg = EXCLUDED.weight_step_kg,
            updated_at = EXCLUDED.updated_at
          `,
          [user.id, targetId, pref.weightStepKg, pref.updatedAt],
        );
        exerciseStepPrefsApplied += 1;
      } else {
        const res = await query(
          `
          INSERT INTO user_exercise_prefs (user_id, exercise_id, weight_step_kg, updated_at)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (user_id, exercise_id) DO NOTHING
          `,
          [user.id, targetId, pref.weightStepKg, pref.updatedAt],
        );
        if (Number(res.rowCount ?? 0) > 0) {
          exerciseStepPrefsApplied += 1;
        } else {
          exerciseStepPrefsSkipped += 1;
        }
      }
    }

    // 6. Restore body metrics (fresh bm_* IDs; deduped in Merge mode)
    const existingMetricKeys = new Set<string>();
    if (mode === 'merge') {
      const existingMetricsRes = await query<{
        measured_on: string;
        weight_kg: number;
        source: string;
        created_at: string;
      }>(
        'SELECT measured_on, weight_kg, source, created_at FROM body_metrics WHERE user_id = $1',
        [user.id],
      );
      for (const row of existingMetricsRes.rows) {
        existingMetricKeys.add(
          `${row.measured_on}|${Number(row.weight_kg)}|${row.source}|${row.created_at}`,
        );
      }
    }

    let bodyMetricsCreated = 0;
    let bodyMetricsSkipped = 0;
    for (const bm of payload.bodyMetrics) {
      const key = `${bm.measuredOn}|${bm.weightKg}|${bm.source}|${bm.createdAt}`;
      if (existingMetricKeys.has(key)) {
        bodyMetricsSkipped += 1;
        continue;
      }
      existingMetricKeys.add(key);
      await query(
        `
        INSERT INTO body_metrics (id, user_id, measured_on, weight_kg, source, created_at)
        VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [
          `bm_${crypto.randomUUID()}`,
          user.id,
          bm.measuredOn,
          bm.weightKg,
          bm.source,
          bm.createdAt,
        ],
      );
      bodyMetricsCreated += 1;
    }

    // 7. Restore active split + schedule events (unless Merge mode & user already has one)
    let splitRestored = false;
    let splitKeptExisting = false;
    let scheduleEventsCreated = 0;

    if (payload.activeSchedule) {
      const currentActive =
        mode === 'merge' ? await getActiveSchedule(user.id) : null;
      if (currentActive) {
        splitKeptExisting = true;
        skippedItems.push({
          item: `Split "${payload.activeSchedule.name}"`,
          reason: `Kept existing active split "${currentActive.name}" in merge mode`,
        });
      } else {
        const newScheduleId = `sched_${crypto.randomUUID()}`;
        await query(
          `
          INSERT INTO schedules (
            id, user_id, name, is_active, rotation_anchor_date, rotation_anchor_index,
            created_at, updated_at
          ) VALUES ($1, $2, $3, 1, $4, $5, $6, $7)
          `,
          [
            newScheduleId,
            user.id,
            payload.activeSchedule.name,
            payload.activeSchedule.anchorDate,
            payload.activeSchedule.anchorIndex,
            nowIso,
            nowIso,
          ],
        );

        const sortedDays = [...payload.activeSchedule.days].sort(
          (a, b) => a.position - b.position,
        );
        for (const day of sortedDays) {
          const newDayId = `sday_${crypto.randomUUID()}`;
          await query(
            `
            INSERT INTO schedule_days (id, schedule_id, position, label, is_rest_day)
            VALUES ($1, $2, $3, $4, $5)
            `,
            [
              newDayId,
              newScheduleId,
              day.position,
              day.label,
              day.isRestDay ? 1 : 0,
            ],
          );

          const sortedExs = [...day.exercises].sort(
            (a, b) => a.orderIndex - b.orderIndex,
          );
          for (let exIdx = 0; exIdx < sortedExs.length; exIdx += 1) {
            const ex = sortedExs[exIdx];
            const resolvedExId = resolveExerciseRefId(
              ex.exerciseId,
              ex.exerciseName,
            );
            await query(
              `
              INSERT INTO schedule_day_exercises (
                id, schedule_day_id, exercise_id, order_index,
                target_sets, target_reps, target_reps_min, target_reps_max,
                target_time_seconds, target_weight_kg, target_distance_m,
                rest_seconds, notes
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
              `,
              [
                `sdex_${crypto.randomUUID()}`,
                newDayId,
                resolvedExId,
                ex.orderIndex,
                ex.targetSets,
                ex.targetReps,
                ex.targetRepsMin,
                ex.targetRepsMax,
                ex.targetTimeSeconds,
                ex.targetWeightKg,
                ex.targetDistanceM,
                ex.restSeconds,
                ex.notes,
              ],
            );
          }
        }

        for (const ev of payload.scheduleEvents) {
          if (
            ev.scheduleId !== null &&
            ev.scheduleId !== payload.activeSchedule.oldId
          ) {
            continue;
          }
          await query(
            `
            INSERT INTO schedule_events (
              id, user_id, schedule_id, event_date, event_type,
              shift_days, jolly_label, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `,
            [
              `se_${crypto.randomUUID()}`,
              user.id,
              newScheduleId,
              ev.eventDate,
              ev.eventType,
              ev.shiftDays,
              ev.jollyLabel,
              ev.createdAt,
            ],
          );
          scheduleEventsCreated += 1;
        }

        splitRestored = true;
      }
    }

    // 8. Restore sessions (fresh IDs, schedule_id=NULL, schedule_day_id=NULL, deduped by cid)
    const existingCids = new Set<string>();
    const cidRes = await query<{ cid: string }>(
      'SELECT cid FROM workout_sessions WHERE user_id = $1 AND cid IS NOT NULL',
      [user.id],
    );
    for (const row of cidRes.rows) {
      existingCids.add(row.cid);
    }

    let sessionsCreated = 0;
    let sessionsSkipped = 0;

    for (const session of payload.sessions) {
      const cid = `import:liftitup:${session.sourceKey}`;
      if (existingCids.has(cid)) {
        sessionsSkipped += 1;
        skippedItems.push({
          item: `${session.title} (${session.sessionDate})`,
          reason: 'Already imported (duplicate session)',
        });
        continue;
      }
      existingCids.add(cid);

      const newSessionId = `sess_${crypto.randomUUID()}`;
      await query(
        `
        INSERT INTO workout_sessions (
          id, user_id, session_date, schedule_id, schedule_day_id,
          is_jolly, jolly_mode, title, started_at, completed_at,
          duration_minutes, user_weight_kg, notes,
          apple_watch_kcal, apple_watch_avg_hr, apple_watch_max_hr, cid
        ) VALUES ($1, $2, $3, NULL, NULL, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        `,
        [
          newSessionId,
          user.id,
          session.sessionDate,
          session.isJolly ? 1 : 0,
          session.jollyMode,
          session.title,
          session.startedAt,
          session.completedAt,
          session.durationMinutes,
          session.userWeightKg,
          session.notes,
          session.appleHealthKcal,
          session.appleHealthAvgHr,
          session.appleHealthMaxHr,
          cid,
        ],
      );

      const sortedExercises = [...session.exercises].sort(
        (a, b) => a.orderIndex - b.orderIndex,
      );
      for (let eIdx = 0; eIdx < sortedExercises.length; eIdx += 1) {
        const ex = sortedExercises[eIdx];
        const resolvedExId = resolveExerciseRefId(ex.exerciseId, ex.name);
        const newWorkoutExId = `wex_${crypto.randomUUID()}`;
        await query(
          `
          INSERT INTO workout_exercises (id, session_id, exercise_id, order_index, notes)
          VALUES ($1, $2, $3, $4, $5)
          `,
          [newWorkoutExId, newSessionId, resolvedExId, ex.orderIndex, ex.notes],
        );

        const sortedSets = [...ex.sets].sort(
          (a, b) => a.setNumber - b.setNumber,
        );
        const setCreatedAt = session.completedAt ?? session.startedAt;
        for (const s of sortedSets) {
          const newSetId = `ws_${crypto.randomUUID()}`;
          await query(
            `
            INSERT INTO workout_sets (
              id, workout_exercise_id, set_number, weight_kg, reps, time_seconds,
              distance_m, rest_seconds, actual_rest_seconds, rest_approximate,
              execution_quality_pct, is_completed, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            `,
            [
              newSetId,
              newWorkoutExId,
              s.setNumber,
              s.weightKg,
              s.reps,
              s.timeSeconds,
              s.distanceM,
              s.restSeconds,
              s.actualRestSeconds,
              s.restApproximate ? 1 : 0,
              s.executionQualityPct,
              s.isCompleted ? 1 : 0,
              setCreatedAt,
            ],
          );

          for (const rq of s.repQualities) {
            await query(
              `
              INSERT INTO workout_set_rep_qualities (id, workout_set_id, rep_index, quality_pct)
              VALUES ($1, $2, $3, $4)
              `,
              [
                `wrq_${crypto.randomUUID()}`,
                newSetId,
                rq.repIndex,
                rq.qualityPct,
              ],
            );
          }
        }
      }

      sessionsCreated += 1;
    }

    const updatedUser = await getUserById(user.id);
    if (!updatedUser) {
      throw ApiError.internal('User disappeared during restore');
    }

    return {
      mode,
      sessionsCreated,
      sessionsSkipped,
      bodyMetricsCreated,
      bodyMetricsSkipped,
      customExercisesCreated,
      customExercisesReused,
      hiddenExercisesApplied,
      exerciseStepPrefsApplied,
      exerciseStepPrefsSkipped,
      splitRestored,
      splitKeptExisting,
      scheduleEventsCreated,
      skippedItems,
      user: updatedUser,
    };
  });
}
