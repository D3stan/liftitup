import crypto from 'node:crypto';
import type {
  Exercise,
  JollyMode,
  ScheduleDay,
  TrackingType,
  WorkoutSession,
} from '@/types/domain';
import { ApiError } from '@/lib/api/handler';
import { query, queryOne, withTransaction } from '@/lib/db/connection';
import { getUserById, localDateForTimezone } from '@/lib/db/users';
import {
  getActiveSchedule,
  getLastPerformanceByExerciseIds,
  getWorkoutSessionById,
  getWorkoutSessionsByDate,
  listScheduleEvents,
  listWorkoutSessions,
} from '@/lib/db/workouts';
import {
  getExerciseById,
  getExerciseStepMetaByIds,
} from '@/lib/exercises/repository';
import { linkBestUnlinkedHealthWorkoutToSessionInTx } from '@/lib/integrations/appleHealth';
import { projectCalendar } from '@/lib/schedule/queue';
import { MAX_MEASURED_REST_SECONDS } from './rest';
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

type SessionSwapRow = {
  schedule_day_exercise_id: string;
  exercise_id: string;
  exercise_name: string;
  tracking_type: TrackingType;
};

async function getSessionSwapsForDate(
  userId: string,
  dateKey: string,
): Promise<Map<string, SessionSwapRow>> {
  const { rows } = await query<SessionSwapRow>(
    `
      SELECT
        ss.schedule_day_exercise_id,
        ss.exercise_id,
        e.name AS exercise_name,
        e.tracking_type
      FROM session_swaps ss
      JOIN exercises e ON e.id = ss.exercise_id
      WHERE ss.user_id = $1 AND ss.date_key = $2
    `,
    [userId, dateKey],
  );

  const map = new Map<string, SessionSwapRow>();
  for (const row of rows) {
    map.set(row.schedule_day_exercise_id, row);
  }
  return map;
}

export async function getWorkoutDayView(
  userId: string,
  date: string,
  clientToday?: string,
): Promise<WorkoutDayViewResponse> {
  if (!isValidYmd(date)) {
    throw ApiError.validation('date must be YYYY-MM-DD');
  }

  const user = await getUserById(userId);
  if (!user) {
    throw ApiError.unauthorized();
  }

  const today =
    clientToday && isValidYmd(clientToday)
      ? clientToday
      : localDateForTimezone(user.timezone);

  const schedule = await getActiveSchedule(userId);
  let plannedDay: ScheduleDay | null = null;
  let calendarStatus: WorkoutDayViewResponse['calendarDay']['status'] =
    'unscheduled';
  let skippedLabel: string | null = null;
  let dayEvents: WorkoutDayViewResponse['calendarDay']['events'] = [];

  if (schedule && schedule.days.length > 0) {
    const simFrom =
      schedule.rotationAnchorDate < date ? schedule.rotationAnchorDate : date;
    const simTo = date > today ? date : today;
    const events = await listScheduleEvents(userId, schedule.id, { to: simTo });
    const simSessions = await listWorkoutSessions(userId, {
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
          const swaps = await getSessionSwapsForDate(userId, date);
          plannedDay = {
            ...fullDay,
            exercises: fullDay.exercises.map((ex) => {
              const swap = swaps.get(ex.id);
              if (!swap) return ex;
              return {
                ...ex,
                swappedFromExerciseId: ex.exerciseId,
                swappedFromExerciseName: ex.exerciseName ?? null,
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

  const sessions = await getWorkoutSessionsByDate(userId, date);

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

  const exIdList = Array.from(exerciseIds);
  const [prefillByExerciseId, exerciseStepsById] = await Promise.all([
    getLastPerformanceByExerciseIds(userId, exIdList, addDaysYmd(date, -1)),
    getExerciseStepMetaByIds(userId, exIdList),
  ]);

  return {
    date,
    today,
    user: {
      id: user.id,
      unit: user.unit,
      weightKg: user.weightKg,
      enableSetQuality: user.enableSetQuality,
      alwaysShowRir: user.alwaysShowRir,
      enableSetNoteTags: user.enableSetNoteTags,
      enableSetNoteHint: user.enableSetNoteHint,
      restClockMode: user.restClockMode,
      defaultWorkoutView: user.defaultWorkoutView,
      defaultWeightStepKg: user.defaultWeightStepKg,
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
    exerciseStepsById,
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
    actualRestSeconds: number | null;
    restApproximate: boolean;
    executionQualityPct: number | null;
    rir: number | null;
    notes: string;
    isWarmup: boolean;
    isCompleted: boolean;
    repQualities: Array<{ repIndex: number; qualityPct: number }>;
  }>;
}

async function validateAndNormalizeExercises(
  userId: string,
  exercises: unknown,
): Promise<NormalizedExercisePayload[]> {
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
      const found = await getExerciseById(userId, exerciseId);
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
      const rawActualRest = parseNullableNumberRange(
        s.actualRestSeconds,
        `exercises[${i}].sets[${j}].actualRestSeconds`,
        0,
        86400,
        true,
      );
      const actualRestSeconds =
        rawActualRest !== null && rawActualRest <= MAX_MEASURED_REST_SECONDS
          ? rawActualRest
          : null;
      const restApproximate =
        actualRestSeconds !== null && Boolean(s.restApproximate);
      const executionQualityPct = parseNullableNumberRange(
        s.executionQualityPct,
        `exercises[${i}].sets[${j}].executionQualityPct`,
        0,
        100,
        true,
      );
      const rawRir = parseNullableNumberRange(
        s.rir,
        `exercises[${i}].sets[${j}].rir`,
        0,
        10,
      );
      if (rawRir !== null && Math.abs(rawRir * 2 - Math.round(rawRir * 2)) > 1e-6) {
        throw ApiError.validation(
          `exercises[${i}].sets[${j}].rir must be in 0.5 increments between 0 and 10`,
        );
      }
      const rir = rawRir === null ? null : Math.round(rawRir * 2) / 2;
      const setNotes =
        typeof s.notes === 'string' ? s.notes.trim().slice(0, 500) : '';
      const isWarmup = Boolean(s.isWarmup);

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
        actualRestSeconds,
        restApproximate,
        executionQualityPct,
        rir,
        notes: setNotes,
        isWarmup,
        isCompleted,
        repQualities,
      });
    }

    const orderedSets = [
      ...sets.filter((s) => s.isWarmup),
      ...sets.filter((s) => !s.isWarmup),
    ].map((s, idx) => ({ ...s, setNumber: idx + 1 }));

    normalized.push({
      exerciseId,
      orderIndex:
        typeof raw.orderIndex === 'number' &&
        Number.isInteger(raw.orderIndex) &&
        raw.orderIndex >= 0
          ? raw.orderIndex
          : i,
      notes,
      sets: orderedSets,
    });
  }

  return normalized;
}

async function insertSessionExercises(
  sessionId: string,
  exercises: NormalizedExercisePayload[],
  nowIso: string,
): Promise<void> {
  const insertExSql = `
    INSERT INTO workout_exercises (id, session_id, exercise_id, order_index, notes)
    VALUES ($1, $2, $3, $4, $5)
  `;
  const insertSetSql = `
    INSERT INTO workout_sets (
      id, workout_exercise_id, set_number, weight_kg, reps, time_seconds,
      distance_m, rest_seconds, actual_rest_seconds, rest_approximate,
      execution_quality_pct, rir, notes, is_warmup, is_completed, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
  `;
  const insertRepQSql = `
    INSERT INTO workout_set_rep_qualities (id, workout_set_id, rep_index, quality_pct)
    VALUES ($1, $2, $3, $4)
  `;

  for (let idx = 0; idx < exercises.length; idx += 1) {
    const ex = exercises[idx];
    const workoutExerciseId = `wex_${crypto.randomUUID()}`;
    await query(insertExSql, [workoutExerciseId, sessionId, ex.exerciseId, idx, ex.notes]);

    for (let sIdx = 0; sIdx < ex.sets.length; sIdx += 1) {
      const setRow = ex.sets[sIdx];
      const setId = `ws_${crypto.randomUUID()}`;
      await query(insertSetSql, [
        setId,
        workoutExerciseId,
        sIdx + 1,
        setRow.weightKg,
        setRow.reps,
        setRow.timeSeconds,
        setRow.distanceM,
        setRow.restSeconds,
        setRow.actualRestSeconds,
        setRow.restApproximate ? 1 : 0,
        setRow.executionQualityPct,
        setRow.rir,
        setRow.notes,
        setRow.isWarmup ? 1 : 0,
        setRow.isCompleted ? 1 : 0,
        nowIso,
      ]);

      for (const rq of setRow.repQualities) {
        await query(insertRepQSql, [
          `wrq_${crypto.randomUUID()}`,
          setId,
          rq.repIndex,
          rq.qualityPct,
        ]);
      }
    }
  }
}

async function resolveScheduleForDayId(
  userId: string,
  scheduleDayId: string,
): Promise<{ scheduleId: string; scheduleDayId: string }> {
  const row = await queryOne<{ schedule_day_id: string; schedule_id: string }>(
    `
      SELECT sd.id AS schedule_day_id, s.id AS schedule_id
      FROM schedule_days sd
      JOIN schedules s ON s.id = sd.schedule_id
      WHERE sd.id = $1 AND s.user_id = $2
    `,
    [scheduleDayId, userId],
  );

  if (!row) {
    throw ApiError.validation('scheduleDayId does not belong to current user');
  }
  return { scheduleId: row.schedule_id, scheduleDayId: row.schedule_day_id };
}

function isPgUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const record = err as { code?: unknown; cause?: unknown };
  if (record.code === '23505') return true;
  if (record.cause && isPgUniqueViolation(record.cause)) return true;
  return false;
}

async function findWorkoutSessionByCid(
  userId: string,
  cid: string,
): Promise<WorkoutSession | null> {
  const existing = await queryOne<{ id: string }>(
    'SELECT id FROM workout_sessions WHERE user_id = $1 AND cid = $2',
    [userId, cid],
  );
  if (!existing) return null;
  return getWorkoutSessionById(userId, existing.id);
}

export async function saveWorkoutSession(
  userId: string,
  input: SaveWorkoutSessionInput,
): Promise<{ session: WorkoutSession; created: boolean }> {
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
    const existingSession = await findWorkoutSessionByCid(userId, cid);
    if (existingSession) {
      return { session: existingSession, created: false };
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
    const resolved = await resolveScheduleForDayId(userId, input.scheduleDayId);
    scheduleId = resolved.scheduleId;
    scheduleDayId = resolved.scheduleDayId;
  }

  const exercises = await validateAndNormalizeExercises(userId, input.exercises);
  const nowIso = new Date().toISOString();
  const startedAt =
    typeof input.startedAt === 'string' && input.startedAt.trim()
      ? input.startedAt.trim()
      : nowIso;
  const completedAt =
    input.completedAt === undefined ? nowIso : input.completedAt;

  const sessionId = `sess_${crypto.randomUUID()}`;

  try {
    await withTransaction(async () => {
      await query(
        `
        INSERT INTO workout_sessions (
          id, user_id, session_date, schedule_id, schedule_day_id,
          is_jolly, jolly_mode, title, started_at, completed_at,
          duration_minutes, user_weight_kg, notes, cid
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `,
        [
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
        ],
      );

      await insertSessionExercises(sessionId, exercises, nowIso);

      await linkBestUnlinkedHealthWorkoutToSessionInTx(userId, {
        id: sessionId,
        startedAt,
        completedAt,
        durationMinutes,
      });
    });
  } catch (err) {
    if (cid && isPgUniqueViolation(err)) {
      const existingSession = await findWorkoutSessionByCid(userId, cid);
      if (existingSession) {
        return { session: existingSession, created: false };
      }
    }
    throw err;
  }

  const saved = await getWorkoutSessionById(userId, sessionId);
  if (!saved) {
    throw ApiError.internal('Failed to load saved workout session');
  }
  return { session: saved, created: true };
}

export async function updateWorkoutSession(
  userId: string,
  sessionId: string,
  input: UpdateWorkoutSessionInput,
): Promise<WorkoutSession> {
  const existing = await getWorkoutSessionById(userId, sessionId);
  if (!existing) {
    throw ApiError.notFound('Workout session not found');
  }

  const setClauses: string[] = [];
  const params: Array<string | number | null> = [];

  if (input.sessionDate !== undefined) {
    if (!isValidYmd(input.sessionDate)) {
      throw ApiError.validation('sessionDate must be YYYY-MM-DD');
    }
    params.push(input.sessionDate);
    setClauses.push(`session_date = $${params.length}`);
  }

  if (input.title !== undefined) {
    if (typeof input.title !== 'string' || !input.title.trim()) {
      throw ApiError.validation('title must be a non-empty string');
    }
    params.push(input.title.trim().slice(0, 120));
    setClauses.push(`title = $${params.length}`);
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
    params.push(nextIsJolly ? 1 : 0);
    setClauses.push(`is_jolly = $${params.length}`);
    params.push(nextJollyMode);
    setClauses.push(`jolly_mode = $${params.length}`);
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
    params.push(durationMinutes);
    setClauses.push(`duration_minutes = $${params.length}`);
  }

  if (input.userWeightKg !== undefined) {
    const userWeightKg = parseNullableNumberRange(
      input.userWeightKg,
      'userWeightKg',
      20,
      400,
    );
    params.push(userWeightKg);
    setClauses.push(`user_weight_kg = $${params.length}`);
  }

  if (input.notes !== undefined) {
    if (typeof input.notes !== 'string') {
      throw ApiError.validation('notes must be a string');
    }
    params.push(input.notes.trim().slice(0, 4000));
    setClauses.push(`notes = $${params.length}`);
  }

  if (input.startedAt !== undefined) {
    if (
      typeof input.startedAt !== 'string' ||
      !input.startedAt.trim() ||
      !Number.isFinite(Date.parse(input.startedAt))
    ) {
      throw ApiError.validation('startedAt must be a valid ISO timestamp');
    }
    params.push(input.startedAt.trim());
    setClauses.push(`started_at = $${params.length}`);
  }

  if (input.completedAt !== undefined) {
    if (
      input.completedAt !== null &&
      (typeof input.completedAt !== 'string' ||
        !input.completedAt.trim() ||
        !Number.isFinite(Date.parse(input.completedAt)))
    ) {
      throw ApiError.validation('completedAt must be a valid ISO timestamp or null');
    }
    params.push(input.completedAt === null ? null : input.completedAt.trim());
    setClauses.push(`completed_at = $${params.length}`);
  }

  const normalizedExercises =
    input.exercises !== undefined
      ? await validateAndNormalizeExercises(userId, input.exercises)
      : null;

  const nowIso = new Date().toISOString();

  await withTransaction(async () => {
    if (setClauses.length > 0) {
      params.push(sessionId, userId);
      await query(
        `UPDATE workout_sessions SET ${setClauses.join(', ')} WHERE id = $${params.length - 1} AND user_id = $${params.length}`,
        params,
      );
    }

    if (normalizedExercises) {
      await query('DELETE FROM workout_exercises WHERE session_id = $1', [
        sessionId,
      ]);
      await insertSessionExercises(sessionId, normalizedExercises, nowIso);
    }
  });

  const updated = await getWorkoutSessionById(userId, sessionId);
  if (!updated) {
    throw ApiError.notFound('Workout session not found');
  }
  return updated;
}

export async function deleteWorkoutSession(
  userId: string,
  sessionId: string,
): Promise<void> {
  const result = await withTransaction(async () =>
    query('DELETE FROM workout_sessions WHERE id = $1 AND user_id = $2', [
      sessionId,
      userId,
    ]),
  );
  if (result.rowCount === 0) {
    throw ApiError.notFound('Workout session not found');
  }
}

export interface BulkDeleteSessionTarget {
  id: string;
  sessionDate: string;
  title: string;
}

/**
 * Resolves workout sessions owned by `userId` matching explicit IDs or an inclusive date range.
 */
export async function findWorkoutSessionsForBulkDelete(
  userId: string,
  filter: { sessionIds?: string[]; from?: string; to?: string },
): Promise<BulkDeleteSessionTarget[]> {
  const clauses = ['user_id = $1'];
  const params: unknown[] = [userId];

  if (filter.sessionIds && filter.sessionIds.length > 0) {
    const uniqueIds = Array.from(
      new Set(filter.sessionIds.map((id) => id.trim()).filter(Boolean)),
    );
    if (uniqueIds.length === 0) {
      throw ApiError.validation('sessionIds must contain at least one ID');
    }
    const startIdx = params.length + 1;
    const placeholders = uniqueIds.map((_, i) => `$${startIdx + i}`).join(', ');
    params.push(...uniqueIds);
    clauses.push(`id IN (${placeholders})`);
  }

  if (filter.from !== undefined) {
    if (!isValidYmd(filter.from)) {
      throw ApiError.validation('from must be YYYY-MM-DD');
    }
    params.push(filter.from);
    clauses.push(`session_date >= $${params.length}`);
  }

  if (filter.to !== undefined) {
    if (!isValidYmd(filter.to)) {
      throw ApiError.validation('to must be YYYY-MM-DD');
    }
    params.push(filter.to);
    clauses.push(`session_date <= $${params.length}`);
  }

  if (params.length === 1) {
    throw ApiError.validation(
      'Provide sessionIds or a from/to date filter for bulk deletion',
    );
  }

  const { rows } = await query<{
    id: string;
    session_date: string;
    title: string;
  }>(
    `SELECT id, session_date, title
     FROM workout_sessions
     WHERE ${clauses.join(' AND ')}
     ORDER BY session_date DESC, started_at DESC`,
    params,
  );

  return rows.map((r) => ({
    id: r.id,
    sessionDate: r.session_date,
    title: r.title,
  }));
}

/**
 * Transactionally deletes multiple workout sessions owned by `userId` in explicit
 * child-to-parent cleanup order (clearing Apple Health links, sets, exercises, then sessions).
 */
export async function deleteWorkoutSessionsBulk(
  userId: string,
  sessionIds: string[],
): Promise<number> {
  const uniqueIds = Array.from(
    new Set(sessionIds.map((id) => id.trim()).filter(Boolean)),
  );
  if (uniqueIds.length === 0) return 0;

  return await withTransaction(async () => {
    const placeholders = uniqueIds.map((_, i) => `$${i + 2}`).join(', ');
    const params = [userId, ...uniqueIds];

    const ownedRes = await query<{ id: string }>(
      `SELECT id FROM workout_sessions WHERE user_id = $1 AND id IN (${placeholders})`,
      params,
    );
    const ownedIds = ownedRes.rows.map((r) => r.id);
    if (ownedIds.length === 0) return 0;

    const ownedPlaceholders = ownedIds.map((_, i) => `$${i + 1}`).join(', ');
    const ownedUserPlaceholders = ownedIds.map((_, i) => `$${i + 2}`).join(', ');

    await query(
      `UPDATE apple_health_workouts
       SET linked_session_id = NULL
       WHERE user_id = $1 AND linked_session_id IN (${ownedUserPlaceholders})`,
      [userId, ...ownedIds],
    );

    await query(
      `DELETE FROM workout_set_rep_qualities
       WHERE workout_set_id IN (
         SELECT ws.id
         FROM workout_sets ws
         JOIN workout_exercises we ON we.id = ws.workout_exercise_id
         WHERE we.session_id IN (${ownedPlaceholders})
       )`,
      ownedIds,
    );

    await query(
      `DELETE FROM workout_sets
       WHERE workout_exercise_id IN (
         SELECT id FROM workout_exercises WHERE session_id IN (${ownedPlaceholders})
       )`,
      ownedIds,
    );

    await query(
      `DELETE FROM workout_exercises WHERE session_id IN (${ownedPlaceholders})`,
      ownedIds,
    );

    const delRes = await query(
      `DELETE FROM workout_sessions WHERE user_id = $1 AND id IN (${ownedUserPlaceholders})`,
      [userId, ...ownedIds],
    );
    return Number(delRes.rowCount ?? ownedIds.length);
  });
}

export async function applyExerciseSwap(
  userId: string,
  input: SwapExerciseInput,
): Promise<SwapExerciseResult> {
  if (!isValidYmd(input.dateKey)) {
    throw ApiError.validation('dateKey must be YYYY-MM-DD');
  }
  if (
    typeof input.scheduleDayExerciseId !== 'string' ||
    !input.scheduleDayExerciseId.trim()
  ) {
    throw ApiError.validation('scheduleDayExerciseId is required');
  }
  if (
    input.scope !== 'session' &&
    input.scope !== 'schedule' &&
    input.scope !== 'revert'
  ) {
    throw ApiError.validation('scope must be "session", "schedule", or "revert"');
  }

  const scheduleDayExerciseId = input.scheduleDayExerciseId.trim();

  const slotRow = await queryOne<{ id: string; exercise_id: string }>(
    `
      SELECT sde.id, sde.exercise_id
      FROM schedule_day_exercises sde
      JOIN schedule_days sd ON sd.id = sde.schedule_day_id
      JOIN schedules s ON s.id = sd.schedule_id
      WHERE sde.id = $1 AND s.user_id = $2
    `,
    [scheduleDayExerciseId, userId],
  );

  if (!slotRow) {
    throw ApiError.notFound('Planned exercise slot not found');
  }

  if (input.scope === 'revert') {
    await withTransaction(async () => {
      await query(
        'DELETE FROM session_swaps WHERE user_id = $1 AND date_key = $2 AND schedule_day_exercise_id = $3',
        [userId, input.dateKey, scheduleDayExerciseId],
      );
    });

    const plannedExercise: Exercise | null = await getExerciseById(
      userId,
      slotRow.exercise_id,
    );
    if (!plannedExercise) {
      throw ApiError.notFound('Planned exercise not found');
    }

    const prefillMap = await getLastPerformanceByExerciseIds(
      userId,
      [slotRow.exercise_id],
      addDaysYmd(input.dateKey, -1),
    );

    return {
      ok: true,
      toExercise: plannedExercise,
      prefill: prefillMap[slotRow.exercise_id] ?? null,
    };
  }

  if (typeof input.toExerciseId !== 'string' || !input.toExerciseId.trim()) {
    throw ApiError.validation('toExerciseId is required');
  }
  const toExerciseId = input.toExerciseId.trim();

  const toExercise: Exercise | null = await getExerciseById(userId, toExerciseId);
  if (!toExercise) {
    throw ApiError.validation('Target exercise not found');
  }

  await withTransaction(async () => {
    if (input.scope === 'session') {
      if (toExerciseId === slotRow.exercise_id) {
        await query(
          'DELETE FROM session_swaps WHERE user_id = $1 AND date_key = $2 AND schedule_day_exercise_id = $3',
          [userId, input.dateKey, scheduleDayExerciseId],
        );
      } else {
        await query(
          `
          INSERT INTO session_swaps (user_id, date_key, schedule_day_exercise_id, exercise_id)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT(user_id, date_key, schedule_day_exercise_id) DO UPDATE SET
            exercise_id = EXCLUDED.exercise_id
        `,
          [userId, input.dateKey, scheduleDayExerciseId, toExerciseId],
        );
      }
    } else {
      await query(
        'UPDATE schedule_day_exercises SET exercise_id = $1 WHERE id = $2',
        [toExerciseId, scheduleDayExerciseId],
      );
      await query(
        'DELETE FROM session_swaps WHERE user_id = $1 AND schedule_day_exercise_id = $2 AND date_key >= $3',
        [userId, scheduleDayExerciseId, input.dateKey],
      );
    }
  });

  const prefillMap = await getLastPerformanceByExerciseIds(
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
