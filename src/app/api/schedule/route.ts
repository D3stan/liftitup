import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { ApiError, parseJsonBody, withApiHandler } from '@/lib/api/handler';
import { requireAuth } from '@/lib/auth';
import {
  getActiveSchedule,
  getDb,
  listScheduleEvents,
  listWorkoutSessions,
  localDateForTimezone,
  withTransaction,
} from '@/lib/db';
import {
  getPointerForDate,
  remapPointerAfterEdit,
  type QueueDay,
} from '@/lib/schedule/queue';

interface PutScheduleExerciseInput {
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

interface PutScheduleDayInput {
  id?: unknown;
  label?: unknown;
  isRestDay?: unknown;
  exercises?: unknown;
}

interface PutScheduleBody {
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

function isValidIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
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
    throw ApiError.validation(`${field} must be an integer between ${min} and ${max}`);
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
    throw ApiError.validation(`${field} must be a number between ${min} and ${max}`);
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
        throw ApiError.validation(`days[${dayIdx}].exercises[${exIdx}] must be an object`);
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

export const GET = withApiHandler('api.schedule.get', async (req, ctx) => {
  const auth = await requireAuth(req, ctx);
  const schedule = getActiveSchedule(auth.user.id);
  return NextResponse.json({ schedule });
});

export const PUT = withApiHandler('api.schedule.put', async (req, ctx) => {
  const auth = await requireAuth(req, ctx);
  const body = await parseJsonBody<PutScheduleBody>(req);

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
    todayStr = localDateForTimezone(auth.user.timezone);
  }

  const db = getDb();

  // Verify all referenced exercises exist and are visible to this user
  const exerciseIds = Array.from(
    new Set(days.flatMap((d) => d.exercises.map((e) => e.exerciseId))),
  );
  if (exerciseIds.length > 0) {
    const placeholders = exerciseIds.map(() => '?').join(',');
    const foundRows = db
      .prepare(
        `SELECT id FROM exercises WHERE id IN (${placeholders}) AND (user_id IS NULL OR user_id = ?)`,
      )
      .all(...exerciseIds, auth.user.id) as Array<{ id: string }>;
    const foundSet = new Set(foundRows.map((r) => r.id));
    for (const id of exerciseIds) {
      if (!foundSet.has(id)) {
        throw ApiError.validation(`Unknown exerciseId: "${id}"`);
      }
    }
  }

  const now = new Date().toISOString();

  withTransaction(() => {
    const oldSchedule = getActiveSchedule(auth.user.id);

    // 1. Compute today's queue pointer on the old schedule before editing
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
      const events = listScheduleEvents(auth.user.id, oldSchedule.id);
      const sessions = listWorkoutSessions(auth.user.id, {
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

      // Resolve final day IDs (preserving existing IDs belonging to this schedule)
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

      // Delete removed days first (ON DELETE CASCADE cleans up their exercises)
      for (const oldDay of oldSchedule.days) {
        if (!usedDayIds.has(oldDay.id)) {
          db.prepare('DELETE FROM schedule_days WHERE id = ?').run(oldDay.id);
        }
      }

      // Temporarily shift surviving day positions negative to avoid UNIQUE(schedule_id, position) collisions
      const shiftStmt = db.prepare(
        'UPDATE schedule_days SET position = ? WHERE id = ?',
      );
      resolvedDays.forEach((d, idx) => {
        if (d.isExisting) {
          shiftStmt.run(-1000 - idx, d.resolvedId);
        }
      });

      const updateDayStmt = db.prepare(
        'UPDATE schedule_days SET position = ?, label = ?, is_rest_day = ? WHERE id = ?',
      );
      const insertDayStmt = db.prepare(
        'INSERT INTO schedule_days (id, schedule_id, position, label, is_rest_day) VALUES (?, ?, ?, ?, ?)',
      );
      const deleteDayExStmt = db.prepare(
        'DELETE FROM schedule_day_exercises WHERE id = ?',
      );
      const updateExStmt = db.prepare(`
        UPDATE schedule_day_exercises
        SET exercise_id = ?, order_index = ?, target_sets = ?, target_reps = ?,
            target_reps_min = ?, target_reps_max = ?, target_time_seconds = ?,
            target_weight_kg = ?, target_distance_m = ?, rest_seconds = ?, notes = ?
        WHERE id = ?
      `);
      const insertExStmt = db.prepare(`
        INSERT INTO schedule_day_exercises (
          id, schedule_day_id, exercise_id, order_index, target_sets, target_reps,
          target_reps_min, target_reps_max, target_time_seconds, target_weight_kg,
          target_distance_m, rest_seconds, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      resolvedDays.forEach((d, pos) => {
        if (d.isExisting) {
          updateDayStmt.run(pos, d.label, d.isRestDay ? 1 : 0, d.resolvedId);
        } else {
          insertDayStmt.run(
            d.resolvedId,
            scheduleId,
            pos,
            d.label,
            d.isRestDay ? 1 : 0,
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
            deleteDayExStmt.run(oldExId);
          }
        }

        resolvedExercises.forEach((ex, orderIdx) => {
          if (ex.isExisting) {
            updateExStmt.run(
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
            );
          } else {
            insertExStmt.run(
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
            );
          }
        });
      });

      const newQueue: QueueDay[] = resolvedDays.map((d, pos) => ({
        id: d.resolvedId,
        position: pos,
        label: d.label,
        isRestDay: d.isRestDay,
      }));
      const mappedIndex = remapPointerAfterEdit(oldQueue, newQueue, pointer);

      db.prepare(
        `UPDATE schedules
         SET name = ?, rotation_anchor_date = ?, rotation_anchor_index = ?, updated_at = ?
         WHERE id = ?`,
      ).run(scheduleName, todayStr, mappedIndex, now, scheduleId);
    } else {
      scheduleId = crypto.randomUUID();
      db.prepare(
        `INSERT INTO schedules (
          id, user_id, name, is_active, rotation_anchor_date, rotation_anchor_index, created_at, updated_at
        ) VALUES (?, ?, ?, 1, ?, 0, ?, ?)`,
      ).run(scheduleId, auth.user.id, scheduleName, todayStr, now, now);

      const insertDayStmt = db.prepare(
        'INSERT INTO schedule_days (id, schedule_id, position, label, is_rest_day) VALUES (?, ?, ?, ?, ?)',
      );
      const insertExStmt = db.prepare(`
        INSERT INTO schedule_day_exercises (
          id, schedule_day_id, exercise_id, order_index, target_sets, target_reps,
          target_reps_min, target_reps_max, target_time_seconds, target_weight_kg,
          target_distance_m, rest_seconds, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      days.forEach((d, pos) => {
        const dayId = crypto.randomUUID();
        insertDayStmt.run(dayId, scheduleId, pos, d.label, d.isRestDay ? 1 : 0);
        d.exercises.forEach((ex, orderIdx) => {
          insertExStmt.run(
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
          );
        });
      });
    }
  });

  const updated = getActiveSchedule(auth.user.id);
  ctx.log.info('Active schedule replaced', {
    scheduleId: updated?.id ?? null,
    dayCount: updated?.days.length ?? 0,
    anchorDate: updated?.rotationAnchorDate ?? null,
    anchorIndex: updated?.rotationAnchorIndex ?? 0,
  });

  return NextResponse.json({ schedule: updated });
});
