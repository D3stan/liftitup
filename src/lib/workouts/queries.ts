import crypto from 'node:crypto';
import type {
  Exercise,
  JollyMode,
  ScheduleDay,
  TrackingType,
  WorkoutSession,
} from '@/types/domain';
import { ApiError } from '@/lib/api/handler';
import { withTransaction, getDb } from '@/lib/db/connection';
import { getUserById, localDateForTimezone } from '@/lib/db/users';
import {
  getActiveSchedule,
  getLastPerformanceByExerciseIds,
  getWorkoutSessionById,
  getWorkoutSessionsByDate,
  listScheduleEvents,
  listWorkoutSessions,
} from '@/lib/db/workouts';
import { getExerciseById } from '@/lib/exercises/repository';
import { projectCalendar } from '@/lib/schedule/queue';
import type {
  SaveWorkoutExerciseInput,
  SaveWorkoutSessionInput,
  SwapExerciseInput,
  SwapExerciseResult,
  UpdateWorkoutSessionInput,
  WorkoutDayViewResponse,
} from './types';

export function isValidYmd(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
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

export function addDaysYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

interface SessionSwapRow {
  schedule_day_exercise_id: string;
  exercise_id: string;
  exercise_name: string;
  tracking_type: TrackingType;
  default_rest_seconds: number;
}

function getSessionSwapsForDate(
  userId: string,
  dateKey: string,
): Map<string, SessionSwapRow> {
  const db = getDb();
  const rows = db
    .prepare(`
      SELECT
        ss.schedule_day_exercise_id,
        ss.exercise_id,
        e.name AS exercise_name,
        e.tracking_type,
        e.default_rest_seconds
      FROM session_swaps ss
      JOIN exercises e ON e.id = ss.exercise_id
      WHERE ss.user_id = ? AND ss.date_key = ?
    `)
    .all(userId, dateKey) as unknown as SessionSwapRow[];

  const map = new Map<string, SessionSwapRow>();
  for (const row of rows) {
    map.set(row.schedule_day_exercise_id, row);
  }
  return map;
}

export function getWorkoutDayView(
  userId: string,
  date: string,
  clientToday?: string,
): WorkoutDayViewResponse {
  if (!isValidYmd(date)) {
    throw ApiError.validation('date must be YYYY-MM-DD');
  }

  const user = getUserById(userId);
  if (!user) {
    throw ApiError.unauthorized();
  }

  const today =
    clientToday && isValidYmd(clientToday)
      ? clientToday
      : localDateForTimezone(user.timezone);

  const schedule = getActiveSchedule(userId);
  let plannedDay: ScheduleDay | null = null;
  let calendarStatus: WorkoutDayViewResponse['calendarDay']['status'] =
    'unscheduled';
  let skippedLabel: string | null = null;
  let dayEvents: WorkoutDayViewResponse['calendarDay']['events'] = [];

  if (schedule && schedule.days.length > 0) {
    const simFrom =
      schedule.rotationAnchorDate < date ? schedule.rotationAnchorDate : date;
    const simTo = date > today ? date : today;
    const events = listScheduleEvents(userId, schedule.id, { to: simTo });
    const simSessions = listWorkoutSessions(userId, {
      from: simFrom,
      to: simTo,
      includeExercises: false,
    });

    const projected = projectCalendar({
      queue: schedule.days,
      anchorDate: schedule.rotationAnchorDate,
      anchorIndex: schedule.rotationAnchorIndex,
      events,
      sessions: simSessions,
      today,
      rangeStart: date,
      rangeEnd: date,
    });

    const entry = projected[0];
    if (entry) {
      calendarStatus = entry.status;
      skippedLabel = entry.skippedLabel;
      dayEvents = entry.events;
      if (entry.plannedDay) {
        const fullDay =
          schedule.days.find((d) => d.id === entry.plannedDay!.id) ?? null;
        if (fullDay) {
          const swaps = getSessionSwapsForDate(userId, date);
          plannedDay = {
            ...fullDay,
            exercises: fullDay.exercises.map((ex) => {
              const swap = swaps.get(ex.id);
              if (!swap) return ex;
              return {
                ...ex,
                exerciseId: swap.exercise_id,
                exerciseName: swap.exercise_name,
                trackingType: swap.tracking_type,
              };
            }),
          };
        }
      }
    }
  }

  const sessions = getWorkoutSessionsByDate(userId, date);

  const exerciseIds = new Set<string>();
  if (plannedDay) {
    for (const ex of plannedDay.exercises) {
      exerciseIds.add(ex.exerciseId);
    }
  }
  for (const session of sessions) {
    for (const ex of session.exercises) {
      exerciseIds.add(ex.exerciseId);
    }
  }

  const prefillByExerciseId = getLastPerformanceByExerciseIds(
    userId,
    Array.from(exerciseIds),
    addDaysYmd(date, -1),
  );

  return {
    date,
    today,
    user: {
      id: user.id,
      unit: user.unit,
      weightKg: user.weightKg,
      enableSetQuality: user.enableSetQuality,
      timezone: user.timezone,
    },
    calendarDay: {
      date,
      status: calendarStatus,
      plannedDay,
      skippedLabel,
      events: dayEvents,
    },
    sessions,
    prefillByExerciseId,
  };
}

function parseNullableNumberRange(
  val: unknown,
  field: string,
  min: number,
  max: number,
  integerOnly = false,
): number | null {
  if (val === undefined || val === null || val === '') return null;
  if (typeof val !== 'number' || !Number.isFinite(val)) {
    throw ApiError.validation(`${field} must be a finite number or null`);
  }
  if (val < min || val > max) {
    throw ApiError.validation(`${field} must be between ${min} and ${max}`);
  }
  return integerOnly ? Math.round(val) : val;
}

interface NormalizedExercisePayload {
  exerciseId: string;
  orderIndex: number;
  notes: string;
  sets: Array<{
    setNumber: number;
    weightKg: number | null;
    reps: number | null;
    timeSeconds: number | null;
    distanceM: number | null;
    restSeconds: number | null;
    executionQualityPct: number | null;
    isCompleted: boolean;
    repQualities: Array<{ repIndex: number; qualityPct: number }>;
  }>;
}

function validateAndNormalizeExercises(
  userId: string,
  exercises: unknown,
): NormalizedExercisePayload[] {
  if (!Array.isArray(exercises) || exercises.length === 0) {
    throw ApiError.validation('exercises must contain at least 1 exercise');
  }

  const normalized: NormalizedExercisePayload[] = [];
  const checkedExerciseIds = new Set<string>();

  for (let i = 0; i < exercises.length; i += 1) {
    const raw = exercises[i] as SaveWorkoutExerciseInput | undefined;
    if (!raw || typeof raw !== 'object') {
      throw ApiError.validation(`exercises[${i}] must be an object`);
    }
    if (typeof raw.exerciseId !== 'string' || !raw.exerciseId.trim()) {
      throw ApiError.validation(`exercises[${i}].exerciseId is required`);
    }
    const exerciseId = raw.exerciseId.trim();

    if (!checkedExerciseIds.has(exerciseId)) {
      const found = getExerciseById(userId, exerciseId);
      if (!found) {
        throw ApiError.validation(
          `exercises[${i}].exerciseId "${exerciseId}" does not exist`,
        );
      }
      checkedExerciseIds.add(exerciseId);
    }

    const notes =
      typeof raw.notes === 'string' ? raw.notes.trim().slice(0, 2000) : '';

    if (!Array.isArray(raw.sets) || raw.sets.length === 0) {
      throw ApiError.validation(
        `exercises[${i}].sets must contain at least 1 set`,
      );
    }

    const sets: NormalizedExercisePayload['sets'] = [];
    for (let j = 0; j < raw.sets.length; j += 1) {
      const s = raw.sets[j];
      if (!s || typeof s !== 'object') {
        throw ApiError.validation(`exercises[${i}].sets[${j}] must be an object`);
      }

      const setNumber =
        typeof s.setNumber === 'number' &&
        Number.isInteger(s.setNumber) &&
        s.setNumber >= 1
          ? s.setNumber
          : j + 1;

      const weightKg = parseNullableNumberRange(
        s.weightKg,
        `exercises[${i}].sets[${j}].weightKg`,
        0,
        1500,
      );
      const reps = parseNullableNumberRange(
        s.reps,
        `exercises[${i}].sets[${j}].reps`,
        0,
        1000,
        true,
      );
      const timeSeconds = parseNullableNumberRange(
        s.timeSeconds,
        `exercises[${i}].sets[${j}].timeSeconds`,
        0,
        86400,
        true,
      );
      const distanceM = parseNullableNumberRange(
        s.distanceM,
        `exercises[${i}].sets[${j}].distanceM`,
        0,
        1_000_000,
      );
      const restSeconds = parseNullableNumberRange(
        s.restSeconds,
        `exercises[${i}].sets[${j}].restSeconds`,
        0,
        3600,
        true,
      );
      const executionQualityPct = parseNullableNumberRange(
        s.executionQualityPct,
        `exercises[${i}].sets[${j}].executionQualityPct`,
        0,
        100,
        true,
      );

      const isCompleted = s.isCompleted !== false;

      const repQualities: Array<{ repIndex: number; qualityPct: number }> = [];
      if (Array.isArray(s.repQualities)) {
        const seenReps = new Set<number>();
        for (let r = 0; r < s.repQualities.length; r += 1) {
          const rq = s.repQualities[r];
          if (
            !rq ||
            typeof rq.repIndex !== 'number' ||
            !Number.isInteger(rq.repIndex) ||
            rq.repIndex < 1 ||
            rq.repIndex > 1000
          ) {
            throw ApiError.validation(
              `exercises[${i}].sets[${j}].repQualities[${r}].repIndex must be an integer >= 1`,
            );
          }
          if (
            typeof rq.qualityPct !== 'number' ||
            !Number.isFinite(rq.qualityPct) ||
            rq.qualityPct < 0 ||
            rq.qualityPct > 100
          ) {
            throw ApiError.validation(
              `exercises[${i}].sets[${j}].repQualities[${r}].qualityPct must be 0..100`,
            );
          }
          if (!seenReps.has(rq.repIndex)) {
            seenReps.add(rq.repIndex);
            repQualities.push({
              repIndex: rq.repIndex,
              qualityPct: Math.round(rq.qualityPct),
            });
          }
        }
      }

      sets.push({
        setNumber,
        weightKg,
        reps,
        timeSeconds,
        distanceM,
        restSeconds,
        executionQualityPct,
        isCompleted,
        repQualities,
      });
    }

    normalized.push({
      exerciseId,
      orderIndex:
        typeof raw.orderIndex === 'number' &&
        Number.isInteger(raw.orderIndex) &&
        raw.orderIndex >= 0
          ? raw.orderIndex
          : i,
      notes,
      sets,
    });
  }

  return normalized;
}

function insertSessionExercises(
  db: ReturnType<typeof getDb>,
  sessionId: string,
  exercises: NormalizedExercisePayload[],
  nowIso: string,
): void {
  const insertEx = db.prepare(`
    INSERT INTO workout_exercises (id, session_id, exercise_id, order_index, notes)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertSet = db.prepare(`
    INSERT INTO workout_sets (
      id, workout_exercise_id, set_number, weight_kg, reps, time_seconds,
      distance_m, rest_seconds, execution_quality_pct, is_completed, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertRepQ = db.prepare(`
    INSERT INTO workout_set_rep_qualities (id, workout_set_id, rep_index, quality_pct)
    VALUES (?, ?, ?, ?)
  `);

  exercises.forEach((ex, idx) => {
    const workoutExerciseId = `wex_${crypto.randomUUID()}`;
    insertEx.run(workoutExerciseId, sessionId, ex.exerciseId, idx, ex.notes);

    ex.sets.forEach((setRow, sIdx) => {
      const setId = `ws_${crypto.randomUUID()}`;
      insertSet.run(
        setId,
        workoutExerciseId,
        sIdx + 1,
        setRow.weightKg,
        setRow.reps,
        setRow.timeSeconds,
        setRow.distanceM,
        setRow.restSeconds,
        setRow.executionQualityPct,
        setRow.isCompleted ? 1 : 0,
        nowIso,
      );

      for (const rq of setRow.repQualities) {
        insertRepQ.run(
          `wrq_${crypto.randomUUID()}`,
          setId,
          rq.repIndex,
          rq.qualityPct,
        );
      }
    });
  });
}

function resolveScheduleForDayId(
  userId: string,
  scheduleDayId: string,
): { scheduleId: string; scheduleDayId: string } {
  const db = getDb();
  const row = db
    .prepare(`
      SELECT sd.id AS schedule_day_id, s.id AS schedule_id
      FROM schedule_days sd
      JOIN schedules s ON s.id = sd.schedule_id
      WHERE sd.id = ? AND s.user_id = ?
    `)
    .get(scheduleDayId, userId) as
    | { schedule_day_id: string; schedule_id: string }
    | undefined;

  if (!row) {
    throw ApiError.validation('scheduleDayId does not belong to current user');
  }
  return { scheduleId: row.schedule_id, scheduleDayId: row.schedule_day_id };
}

export function saveWorkoutSession(
  userId: string,
  input: SaveWorkoutSessionInput,
): { session: WorkoutSession; created: boolean } {
  if (!isValidYmd(input.sessionDate)) {
    throw ApiError.validation('sessionDate must be YYYY-MM-DD');
  }
  if (typeof input.title !== 'string' || !input.title.trim()) {
    throw ApiError.validation('title is required');
  }
  const title = input.title.trim().slice(0, 120);

  const isJolly = Boolean(input.isJolly);
  let jollyMode: JollyMode | null = null;
  if (isJolly) {
    if (
      input.jollyMode !== undefined &&
      input.jollyMode !== null &&
      input.jollyMode !== 'extra' &&
      input.jollyMode !== 'instead'
    ) {
      throw ApiError.validation('jollyMode must be "extra" or "instead"');
    }
    jollyMode = input.jollyMode ?? 'extra';
  }

  const cid =
    typeof input.cid === 'string' && input.cid.trim()
      ? input.cid.trim().slice(0, 128)
      : null;

  if (cid) {
    const db = getDb();
    const existing = db
      .prepare('SELECT id FROM workout_sessions WHERE user_id = ? AND cid = ?')
      .get(userId, cid) as { id: string } | undefined;
    if (existing) {
      const session = getWorkoutSessionById(userId, existing.id);
      if (session) {
        return { session, created: false };
      }
    }
  }

  const durationMinutes = parseNullableNumberRange(
    input.durationMinutes,
    'durationMinutes',
    0,
    600,
    true,
  );
  const userWeightKg = parseNullableNumberRange(
    input.userWeightKg,
    'userWeightKg',
    20,
    400,
  );
  const notes =
    typeof input.notes === 'string' ? input.notes.trim().slice(0, 4000) : '';

  let scheduleId: string | null = null;
  let scheduleDayId: string | null = null;
  if (!isJolly && input.scheduleDayId) {
    const resolved = resolveScheduleForDayId(userId, input.scheduleDayId);
    scheduleId = resolved.scheduleId;
    scheduleDayId = resolved.scheduleDayId;
  }

  const exercises = validateAndNormalizeExercises(userId, input.exercises);
  const nowIso = new Date().toISOString();
  const startedAt =
    typeof input.startedAt === 'string' && input.startedAt.trim()
      ? input.startedAt.trim()
      : nowIso;
  const completedAt =
    input.completedAt === undefined ? nowIso : input.completedAt;

  const sessionId = `sess_${crypto.randomUUID()}`;

  withTransaction((db) => {
    db.prepare(`
      INSERT INTO workout_sessions (
        id, user_id, session_date, schedule_id, schedule_day_id,
        is_jolly, jolly_mode, title, started_at, completed_at,
        duration_minutes, user_weight_kg, notes, cid
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sessionId,
      userId,
      input.sessionDate,
      scheduleId,
      scheduleDayId,
      isJolly ? 1 : 0,
      jollyMode,
      title,
      startedAt,
      completedAt,
      durationMinutes,
      userWeightKg,
      notes,
      cid,
    );

    insertSessionExercises(db, sessionId, exercises, nowIso);
  });

  const saved = getWorkoutSessionById(userId, sessionId);
  if (!saved) {
    throw ApiError.internal('Failed to load saved workout session');
  }
  return { session: saved, created: true };
}

export function updateWorkoutSession(
  userId: string,
  sessionId: string,
  input: UpdateWorkoutSessionInput,
): WorkoutSession {
  const existing = getWorkoutSessionById(userId, sessionId);
  if (!existing) {
    throw ApiError.notFound('Workout session not found');
  }

  const setClauses: string[] = [];
  const params: Array<string | number | null> = [];

  if (input.sessionDate !== undefined) {
    if (!isValidYmd(input.sessionDate)) {
      throw ApiError.validation('sessionDate must be YYYY-MM-DD');
    }
    setClauses.push('session_date = ?');
    params.push(input.sessionDate);
  }

  if (input.title !== undefined) {
    if (typeof input.title !== 'string' || !input.title.trim()) {
      throw ApiError.validation('title must be a non-empty string');
    }
    setClauses.push('title = ?');
    params.push(input.title.trim().slice(0, 120));
  }

  const nextIsJolly =
    input.isJolly !== undefined ? Boolean(input.isJolly) : existing.isJolly;
  if (input.isJolly !== undefined || input.jollyMode !== undefined) {
    let nextJollyMode: JollyMode | null = existing.jollyMode;
    if (!nextIsJolly) {
      nextJollyMode = null;
    } else {
      const candidate =
        input.jollyMode !== undefined ? input.jollyMode : existing.jollyMode;
      if (candidate !== null && candidate !== 'extra' && candidate !== 'instead') {
        throw ApiError.validation('jollyMode must be "extra" or "instead"');
      }
      nextJollyMode = candidate ?? 'extra';
    }
    setClauses.push('is_jolly = ?', 'jolly_mode = ?');
    params.push(nextIsJolly ? 1 : 0, nextJollyMode);
    if (nextIsJolly) {
      setClauses.push('schedule_id = NULL', 'schedule_day_id = NULL');
    }
  }

  if (input.durationMinutes !== undefined) {
    const durationMinutes = parseNullableNumberRange(
      input.durationMinutes,
      'durationMinutes',
      0,
      600,
      true,
    );
    setClauses.push('duration_minutes = ?');
    params.push(durationMinutes);
  }

  if (input.userWeightKg !== undefined) {
    const userWeightKg = parseNullableNumberRange(
      input.userWeightKg,
      'userWeightKg',
      20,
      400,
    );
    setClauses.push('user_weight_kg = ?');
    params.push(userWeightKg);
  }

  if (input.notes !== undefined) {
    if (typeof input.notes !== 'string') {
      throw ApiError.validation('notes must be a string');
    }
    setClauses.push('notes = ?');
    params.push(input.notes.trim().slice(0, 4000));
  }

  if (input.completedAt !== undefined) {
    setClauses.push('completed_at = ?');
    params.push(input.completedAt);
  }

  const normalizedExercises =
    input.exercises !== undefined
      ? validateAndNormalizeExercises(userId, input.exercises)
      : null;

  const nowIso = new Date().toISOString();

  withTransaction((db) => {
    if (setClauses.length > 0) {
      params.push(sessionId, userId);
      db.prepare(
        `UPDATE workout_sessions SET ${setClauses.join(', ')} WHERE id = ? AND user_id = ?`,
      ).run(...params);
    }

    if (normalizedExercises) {
      db.prepare('DELETE FROM workout_exercises WHERE session_id = ?').run(
        sessionId,
      );
      insertSessionExercises(db, sessionId, normalizedExercises, nowIso);
    }
  });

  const updated = getWorkoutSessionById(userId, sessionId);
  if (!updated) {
    throw ApiError.notFound('Workout session not found');
  }
  return updated;
}

export function deleteWorkoutSession(userId: string, sessionId: string): void {
  const result = withTransaction((db) =>
    db
      .prepare('DELETE FROM workout_sessions WHERE id = ? AND user_id = ?')
      .run(sessionId, userId),
  );
  if (result.changes === 0) {
    throw ApiError.notFound('Workout session not found');
  }
}

export function applyExerciseSwap(
  userId: string,
  input: SwapExerciseInput,
): SwapExerciseResult {
  if (!isValidYmd(input.dateKey)) {
    throw ApiError.validation('dateKey must be YYYY-MM-DD');
  }
  if (
    typeof input.scheduleDayExerciseId !== 'string' ||
    !input.scheduleDayExerciseId.trim()
  ) {
    throw ApiError.validation('scheduleDayExerciseId is required');
  }
  if (typeof input.toExerciseId !== 'string' || !input.toExerciseId.trim()) {
    throw ApiError.validation('toExerciseId is required');
  }
  if (input.scope !== 'session' && input.scope !== 'schedule') {
    throw ApiError.validation('scope must be "session" or "schedule"');
  }

  const scheduleDayExerciseId = input.scheduleDayExerciseId.trim();
  const toExerciseId = input.toExerciseId.trim();

  const toExercise: Exercise | null = getExerciseById(userId, toExerciseId);
  if (!toExercise) {
    throw ApiError.validation('Target exercise not found');
  }

  const db = getDb();
  const slotRow = db
    .prepare(`
      SELECT sde.id
      FROM schedule_day_exercises sde
      JOIN schedule_days sd ON sd.id = sde.schedule_day_id
      JOIN schedules s ON s.id = sd.schedule_id
      WHERE sde.id = ? AND s.user_id = ?
    `)
    .get(scheduleDayExerciseId, userId) as { id: string } | undefined;

  if (!slotRow) {
    throw ApiError.notFound('Planned exercise slot not found');
  }

  withTransaction((tx) => {
    if (input.scope === 'session') {
      tx.prepare(`
        INSERT INTO session_swaps (user_id, date_key, schedule_day_exercise_id, exercise_id)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, date_key, schedule_day_exercise_id) DO UPDATE SET
          exercise_id = excluded.exercise_id
      `).run(userId, input.dateKey, scheduleDayExerciseId, toExerciseId);
    } else {
      tx.prepare(
        'UPDATE schedule_day_exercises SET exercise_id = ? WHERE id = ?',
      ).run(toExerciseId, scheduleDayExerciseId);
      tx.prepare(
        'DELETE FROM session_swaps WHERE user_id = ? AND date_key = ? AND schedule_day_exercise_id = ?',
      ).run(userId, input.dateKey, scheduleDayExerciseId);
    }
  });

  const prefillMap = getLastPerformanceByExerciseIds(
    userId,
    [toExerciseId],
    addDaysYmd(input.dateKey, -1),
  );

  return {
    ok: true,
    toExercise,
    prefill: prefillMap[toExerciseId] ?? null,
  };
}
