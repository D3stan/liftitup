import crypto from 'node:crypto';
import type {
  RotationSchedule,
  ScheduleEvent,
  ScheduleEventType,
  UserProfile,
} from '@/types/domain';
import { ApiError } from '@/lib/api/handler';
import {
  getActiveSchedule,
  listScheduleEvents,
  listWorkoutSessions,
  localDateForTimezone,
} from '@/lib/db';
import { query, withTransaction } from '@/lib/db/connection';
import {
  getPointerForDate,
  remapPointerAfterEdit,
  type QueueDay,
} from './queue';
import {
  createScheduleEvent,
  deleteScheduleEventsByDateOrId,
  isValidIsoDate,
  projectUserCalendar,
} from './repo';

export interface PutScheduleExerciseInput {
  id?: unknown;
  exerciseId?: unknown;
  targetSets?: unknown;
  targetReps?: unknown;
  targetRepsMin?: unknown;
  targetRepsMax?: unknown;
  targetTimeSeconds?: unknown;
  targetWeightKg?: unknown;
  targetDistanceM?: unknown;
  restSeconds?: unknown;
  notes?: unknown;
}

export interface PutScheduleDayInput {
  id?: unknown;
  label?: unknown;
  isRestDay?: unknown;
  exercises?: unknown;
}

export interface PutScheduleBody {
  name?: unknown;
  today?: unknown;
  days?: unknown;
}

interface ValidatedExercise {
  id: string | null;
  exerciseId: string;
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

interface ValidatedDay {
  id: string | null;
  label: string;
  isRestDay: boolean;
  exercises: ValidatedExercise[];
}

function parseOptionalInt(
  value: unknown,
  field: string,
  min: number,
  max: number,
): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw ApiError.validation(
      `${field} must be an integer between ${min} and ${max}`,
    );
  }
  return n;
}

function parseOptionalFloat(
  value: unknown,
  field: string,
  min: number,
  max: number,
): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw ApiError.validation(
      `${field} must be a number between ${min} and ${max}`,
    );
  }
  return n;
}

function validateDays(rawDays: unknown): ValidatedDay[] {
  if (!Array.isArray(rawDays) || rawDays.length === 0) {
    throw ApiError.validation('days must be a non-empty array');
  }
  if (rawDays.length > 30) {
    throw ApiError.validation('days cannot exceed 30 entries');
  }

  return rawDays.map((rawDay, dayIdx) => {
    if (!rawDay || typeof rawDay !== 'object') {
      throw ApiError.validation(`days[${dayIdx}] must be an object`);
    }
    const d = rawDay as PutScheduleDayInput;
    const label = typeof d.label === 'string' ? d.label.trim() : '';
    if (!label || label.length > 80) {
      throw ApiError.validation(`days[${dayIdx}].label must be 1–80 characters`);
    }
    const isRestDay = Boolean(d.isRestDay);
    const id = typeof d.id === 'string' && d.id.trim() ? d.id.trim() : null;

    if (isRestDay) {
      return { id, label, isRestDay: true, exercises: [] };
    }

    const rawExercises = Array.isArray(d.exercises) ? d.exercises : [];
    const exercises: ValidatedExercise[] = rawExercises.map((rawEx, exIdx) => {
      if (!rawEx || typeof rawEx !== 'object') {
        throw ApiError.validation(
          `days[${dayIdx}].exercises[${exIdx}] must be an object`,
        );
      }
      const ex = rawEx as PutScheduleExerciseInput;
      const exerciseId =
        typeof ex.exerciseId === 'string' ? ex.exerciseId.trim() : '';
      if (!exerciseId) {
        throw ApiError.validation(
          `days[${dayIdx}].exercises[${exIdx}].exerciseId is required`,
        );
      }

      const targetSets =
        parseOptionalInt(
          ex.targetSets ?? 3,
          `days[${dayIdx}].exercises[${exIdx}].targetSets`,
          1,
          20,
        ) ?? 3;
      const restSeconds =
        parseOptionalInt(
          ex.restSeconds ?? 120,
          `days[${dayIdx}].exercises[${exIdx}].restSeconds`,
          0,
          600,
        ) ?? 120;
      const targetReps = parseOptionalInt(
        ex.targetReps,
        `days[${dayIdx}].exercises[${exIdx}].targetReps`,
        1,
        1000,
      );
      const targetRepsMin = parseOptionalInt(
        ex.targetRepsMin,
        `days[${dayIdx}].exercises[${exIdx}].targetRepsMin`,
        1,
        1000,
      );
      const targetRepsMax = parseOptionalInt(
        ex.targetRepsMax,
        `days[${dayIdx}].exercises[${exIdx}].targetRepsMax`,
        1,
        1000,
      );
      if (
        targetRepsMin !== null &&
        targetRepsMax !== null &&
        targetRepsMin > targetRepsMax
      ) {
        throw ApiError.validation(
          `days[${dayIdx}].exercises[${exIdx}]: targetRepsMin cannot exceed targetRepsMax`,
        );
      }
      const targetTimeSeconds = parseOptionalInt(
        ex.targetTimeSeconds,
        `days[${dayIdx}].exercises[${exIdx}].targetTimeSeconds`,
        1,
        86400,
      );
      const targetWeightKg = parseOptionalFloat(
        ex.targetWeightKg,
        `days[${dayIdx}].exercises[${exIdx}].targetWeightKg`,
        0,
        2000,
      );
      const targetDistanceM = parseOptionalFloat(
        ex.targetDistanceM,
        `days[${dayIdx}].exercises[${exIdx}].targetDistanceM`,
        0,
        1_000_000,
      );
      const notes =
        typeof ex.notes === 'string' ? ex.notes.trim().slice(0, 500) : '';
      const exRowId =
        typeof ex.id === 'string' && ex.id.trim() ? ex.id.trim() : null;

      return {
        id: exRowId,
        exerciseId,
        targetSets,
        targetReps,
        targetRepsMin,
        targetRepsMax,
        targetTimeSeconds,
        targetWeightKg,
        targetDistanceM,
        restSeconds,
        notes,
      };
    });

    return { id, label, isRestDay: false, exercises };
  });
}

/**
 * Replaces or edits the user's active rotation schedule while preserving
 * existing day/exercise IDs and remapping today's queue pointer.
 * Shared between `PUT /api/schedule` and MCP `manage_schedule`.
 */
export async function replaceActiveScheduleForUser(
  user: UserProfile,
  body: PutScheduleBody,
): Promise<RotationSchedule | null> {
  const days = validateDays(body.days);
  const rawName = typeof body.name === 'string' ? body.name.trim() : '';
  if (rawName.length > 80) {
    throw ApiError.validation('name must be 80 characters or fewer');
  }

  let todayStr: string;
  if (body.today !== undefined && body.today !== null && body.today !== '') {
    if (typeof body.today !== 'string' || !isValidIsoDate(body.today)) {
      throw ApiError.validation('today must be a valid YYYY-MM-DD date');
    }
    todayStr = body.today;
  } else {
    todayStr = localDateForTimezone(user.timezone);
  }

  const exerciseIds = Array.from(
    new Set(days.flatMap((d) => d.exercises.map((e) => e.exerciseId))),
  );
  if (exerciseIds.length > 0) {
    const placeholders = exerciseIds.map((_, i) => `$${i + 1}`).join(', ');
    const { rows: foundRows } = await query<{ id: string }>(
      `SELECT id FROM exercises WHERE id IN (${placeholders}) AND (user_id IS NULL OR user_id = $${exerciseIds.length + 1})`,
      [...exerciseIds, user.id],
    );
    const foundSet = new Set(foundRows.map((r) => r.id));
    for (const id of exerciseIds) {
      if (!foundSet.has(id)) {
        throw ApiError.validation(`Unknown exerciseId: "${id}"`);
      }
    }
  }

  const now = new Date().toISOString();

  await withTransaction(async () => {
    const oldSchedule = await getActiveSchedule(user.id);

    let oldQueue: QueueDay[] = [];
    let pointer: { index: number; dayId: string | null } = {
      index: 0,
      dayId: null,
    };

    if (oldSchedule) {
      oldQueue = oldSchedule.days.map((d) => ({
        id: d.id,
        position: d.position,
        label: d.label,
        isRestDay: d.isRestDay,
      }));
      const events = await listScheduleEvents(user.id, oldSchedule.id);
      const sessions = await listWorkoutSessions(user.id, {
        from: oldSchedule.rotationAnchorDate,
        includeExercises: false,
      });
      pointer = getPointerForDate({
        queue: oldQueue,
        anchorDate: oldSchedule.rotationAnchorDate,
        anchorIndex: oldSchedule.rotationAnchorIndex,
        events: events.map((e) => ({
          id: e.id,
          eventDate: e.eventDate,
          eventType: e.eventType,
          shiftDays: e.shiftDays,
          jollyLabel: e.jollyLabel,
          createdAt: e.createdAt,
        })),
        sessions: sessions.map((s) => ({
          id: s.id,
          sessionDate: s.sessionDate,
          scheduleDayId: s.scheduleDayId,
          isJolly: s.isJolly,
          jollyMode: s.jollyMode,
          title: s.title,
          completedAt: s.completedAt,
          cid: s.cid,
          isImported: Boolean(s.cid?.startsWith('import:')),
        })),
        today: todayStr,
        targetDate: todayStr,
      });
    }

    const scheduleName = rawName || oldSchedule?.name || 'My Split';
    let scheduleId: string;

    if (oldSchedule) {
      scheduleId = oldSchedule.id;
      const oldDayIds = new Set(oldSchedule.days.map((d) => d.id));
      const oldExByDay = new Map<string, Set<string>>();
      for (const d of oldSchedule.days) {
        oldExByDay.set(d.id, new Set(d.exercises.map((e) => e.id)));
      }

      const usedDayIds = new Set<string>();
      const resolvedDays = days.map((d) => {
        let dayId: string;
        let isExisting = false;
        if (d.id && oldDayIds.has(d.id) && !usedDayIds.has(d.id)) {
          dayId = d.id;
          isExisting = true;
        } else {
          dayId = crypto.randomUUID();
        }
        usedDayIds.add(dayId);
        return { ...d, resolvedId: dayId, isExisting };
      });

      for (const oldDay of oldSchedule.days) {
        if (!usedDayIds.has(oldDay.id)) {
          await query('DELETE FROM schedule_days WHERE id = $1', [oldDay.id]);
        }
      }

      for (let idx = 0; idx < resolvedDays.length; idx++) {
        const d = resolvedDays[idx];
        if (d.isExisting) {
          await query('UPDATE schedule_days SET position = $1 WHERE id = $2', [
            -1000 - idx,
            d.resolvedId,
          ]);
        }
      }

      for (let pos = 0; pos < resolvedDays.length; pos++) {
        const d = resolvedDays[pos];
        if (d.isExisting) {
          await query(
            'UPDATE schedule_days SET position = $1, label = $2, is_rest_day = $3 WHERE id = $4',
            [pos, d.label, d.isRestDay ? 1 : 0, d.resolvedId],
          );
        } else {
          await query(
            'INSERT INTO schedule_days (id, schedule_id, position, label, is_rest_day) VALUES ($1, $2, $3, $4, $5)',
            [d.resolvedId, scheduleId, pos, d.label, d.isRestDay ? 1 : 0],
          );
        }

        const existingExSet = oldExByDay.get(d.resolvedId) ?? new Set<string>();
        const usedExIds = new Set<string>();

        const resolvedExercises = d.exercises.map((ex) => {
          let exRowId: string;
          let isExistingEx = false;
          if (ex.id && existingExSet.has(ex.id) && !usedExIds.has(ex.id)) {
            exRowId = ex.id;
            isExistingEx = true;
          } else {
            exRowId = crypto.randomUUID();
          }
          usedExIds.add(exRowId);
          return { ...ex, resolvedId: exRowId, isExisting: isExistingEx };
        });

        for (const oldExId of existingExSet) {
          if (!usedExIds.has(oldExId)) {
            await query('DELETE FROM schedule_day_exercises WHERE id = $1', [
              oldExId,
            ]);
          }
        }

        for (let orderIdx = 0; orderIdx < resolvedExercises.length; orderIdx++) {
          const ex = resolvedExercises[orderIdx];
          if (ex.isExisting) {
            await query(
              `UPDATE schedule_day_exercises
               SET exercise_id = $1, order_index = $2, target_sets = $3, target_reps = $4,
                   target_reps_min = $5, target_reps_max = $6, target_time_seconds = $7,
                   target_weight_kg = $8, target_distance_m = $9, rest_seconds = $10, notes = $11
               WHERE id = $12`,
              [
                ex.exerciseId,
                orderIdx,
                ex.targetSets,
                ex.targetReps,
                ex.targetRepsMin,
                ex.targetRepsMax,
                ex.targetTimeSeconds,
                ex.targetWeightKg,
                ex.targetDistanceM,
                ex.restSeconds,
                ex.notes,
                ex.resolvedId,
              ],
            );
          } else {
            await query(
              `INSERT INTO schedule_day_exercises (
                 id, schedule_day_id, exercise_id, order_index, target_sets, target_reps,
                 target_reps_min, target_reps_max, target_time_seconds, target_weight_kg,
                 target_distance_m, rest_seconds, notes
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
              [
                ex.resolvedId,
                d.resolvedId,
                ex.exerciseId,
                orderIdx,
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
      }

      const newQueue: QueueDay[] = resolvedDays.map((d, pos) => ({
        id: d.resolvedId,
        position: pos,
        label: d.label,
        isRestDay: d.isRestDay,
      }));
      const mappedIndex = remapPointerAfterEdit(oldQueue, newQueue, pointer);

      await query(
        `UPDATE schedules
         SET name = $1, rotation_anchor_date = $2, rotation_anchor_index = $3, updated_at = $4
         WHERE id = $5`,
        [scheduleName, todayStr, mappedIndex, now, scheduleId],
      );
    } else {
      scheduleId = crypto.randomUUID();
      await query(
        `INSERT INTO schedules (
          id, user_id, name, is_active, rotation_anchor_date, rotation_anchor_index, created_at, updated_at
        ) VALUES ($1, $2, $3, 1, $4, 0, $5, $6)`,
        [scheduleId, user.id, scheduleName, todayStr, now, now],
      );

      for (let pos = 0; pos < days.length; pos++) {
        const d = days[pos];
        const dayId = crypto.randomUUID();
        await query(
          'INSERT INTO schedule_days (id, schedule_id, position, label, is_rest_day) VALUES ($1, $2, $3, $4, $5)',
          [dayId, scheduleId, pos, d.label, d.isRestDay ? 1 : 0],
        );
        for (let orderIdx = 0; orderIdx < d.exercises.length; orderIdx++) {
          const ex = d.exercises[orderIdx];
          await query(
            `INSERT INTO schedule_day_exercises (
               id, schedule_day_id, exercise_id, order_index, target_sets, target_reps,
               target_reps_min, target_reps_max, target_time_seconds, target_weight_kg,
               target_distance_m, rest_seconds, notes
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [
              crypto.randomUUID(),
              dayId,
              ex.exerciseId,
              orderIdx,
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
    }
  });

  return getActiveSchedule(user.id);
}

const ALLOWED_EVENT_TYPES = new Set<ScheduleEventType>([
  'skip',
  'postpone',
  'reset',
  'jolly_extra',
  'jolly_instead',
]);

export interface CreateScheduleEventInput {
  eventDate?: unknown;
  eventType?: unknown;
  shiftDays?: unknown;
  jollyLabel?: unknown;
  today?: unknown;
}

/**
 * Validates and creates a rotation schedule event (skip, postpone, reset,
 * jolly_extra, jolly_instead). Shared by `POST /api/schedule/events` and MCP.
 */
export async function createScheduleEventForUser(
  user: UserProfile,
  body: CreateScheduleEventInput,
): Promise<ScheduleEvent> {
  const today =
    typeof body.today === 'string' && isValidIsoDate(body.today)
      ? body.today
      : localDateForTimezone(user.timezone);

  const eventDate = body.eventDate === undefined ? today : body.eventDate;
  if (typeof eventDate !== 'string' || !isValidIsoDate(eventDate)) {
    throw ApiError.validation('eventDate must be YYYY-MM-DD');
  }

  if (
    typeof body.eventType !== 'string' ||
    !ALLOWED_EVENT_TYPES.has(body.eventType as ScheduleEventType)
  ) {
    throw ApiError.validation(
      'eventType must be one of skip, postpone, reset, jolly_extra, jolly_instead',
    );
  }
  const eventType = body.eventType as ScheduleEventType;

  let shiftDays: 1 | 2 | 3 | null = null;
  if (eventType === 'postpone') {
    const raw = body.shiftDays === undefined ? 1 : body.shiftDays;
    if (raw !== 1 && raw !== 2 && raw !== 3) {
      throw ApiError.validation('shiftDays must be 1, 2, or 3');
    }
    shiftDays = raw;
  }

  let jollyLabel: string | null = null;
  if (body.jollyLabel !== undefined && body.jollyLabel !== null) {
    if (typeof body.jollyLabel !== 'string') {
      throw ApiError.validation('jollyLabel must be a string');
    }
    const trimmed = body.jollyLabel.trim();
    if (trimmed.length > 60) {
      throw ApiError.validation('jollyLabel must be at most 60 characters');
    }
    jollyLabel = trimmed || null;
  }

  const schedule = await getActiveSchedule(user.id);
  if (!schedule) {
    throw ApiError.badRequest('No active rotation schedule');
  }

  if (eventType === 'jolly_instead') {
    const projected = await projectUserCalendar({
      userId: user.id,
      today,
      rangeStart: eventDate,
      rangeEnd: eventDate,
    });
    const targetDay = projected.days[0];
    if (
      !targetDay ||
      targetDay.status === 'rest' ||
      targetDay.plannedDay?.isRestDay
    ) {
      throw ApiError.badRequest('Jolly instead is not available on a rest day');
    }
  }

  return createScheduleEvent({
    userId: user.id,
    scheduleId: schedule.id,
    eventDate,
    eventType,
    shiftDays,
    jollyLabel,
  });
}

/**
 * Deletes schedule events by ID or date for the user's active schedule.
 * Shared by `DELETE /api/schedule/events` and MCP.
 */
export async function deleteScheduleEventForUser(
  user: UserProfile,
  opts: { id?: string; eventDate?: string },
): Promise<number> {
  const schedule = await getActiveSchedule(user.id);
  if (!schedule) {
    throw ApiError.badRequest('No active rotation schedule');
  }

  if (!opts.id && !opts.eventDate) {
    throw ApiError.validation('id or date parameter is required');
  }
  if (opts.eventDate && !isValidIsoDate(opts.eventDate)) {
    throw ApiError.validation('date must be YYYY-MM-DD');
  }

  return deleteScheduleEventsByDateOrId({
    userId: user.id,
    scheduleId: schedule.id,
    id: opts.id,
    eventDate: opts.eventDate,
  });
}
