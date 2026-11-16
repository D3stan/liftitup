import type {
  ExercisePrefill,
  JollyMode,
  RotationSchedule,
  ScheduleDay,
  ScheduleDayExercise,
  ScheduleEvent,
  ScheduleEventType,
  TrackingType,
  WorkoutExercise,
  WorkoutSession,
  WorkoutSet,
  WorkoutSetRepQuality,
} from '@/types/domain';
import { query, queryOne } from './connection';

type DbScheduleRow = {
  id: string;
  user_id: string;
  name: string;
  is_active: number;
  rotation_anchor_date: string;
  rotation_anchor_index: number;
  created_at: string;
  updated_at: string;
};

type DbScheduleDayRow = {
  id: string;
  schedule_id: string;
  position: number;
  label: string;
  is_rest_day: number;
};

type DbScheduleDayExerciseRow = {
  id: string;
  schedule_day_id: string;
  exercise_id: string;
  exercise_name: string;
  tracking_type: TrackingType;
  order_index: number;
  target_sets: number;
  target_reps: number | null;
  target_reps_min: number | null;
  target_reps_max: number | null;
  target_time_seconds: number | null;
  target_weight_kg: number | null;
  target_distance_m: number | null;
  rest_seconds: number;
  notes: string;
};

type DbScheduleEventRow = {
  id: string;
  user_id: string;
  schedule_id: string;
  event_date: string;
  event_type: ScheduleEventType;
  shift_days: number | null;
  jolly_label: string | null;
  created_at: string;
};

type DbWorkoutSessionRow = {
  id: string;
  user_id: string;
  session_date: string;
  schedule_id: string | null;
  schedule_day_id: string | null;
  is_jolly: number;
  jolly_mode: JollyMode | null;
  title: string;
  started_at: string;
  completed_at: string | null;
  duration_minutes: number | null;
  user_weight_kg: number | null;
  notes: string;
  apple_watch_kcal: number | null;
  apple_watch_avg_hr: number | null;
  apple_watch_max_hr: number | null;
  cid: string | null;
};

type DbWorkoutExerciseRow = {
  id: string;
  session_id: string;
  exercise_id: string;
  exercise_name: string;
  tracking_type: TrackingType;
  order_index: number;
  notes: string;
};

type DbWorkoutSetRow = {
  id: string;
  workout_exercise_id: string;
  set_number: number;
  weight_kg: number | null;
  reps: number | null;
  time_seconds: number | null;
  distance_m: number | null;
  rest_seconds: number | null;
  actual_rest_seconds: number | null;
  rest_approximate: number;
  execution_quality_pct: number | null;
  is_completed: number;
  created_at: string;
};

type DbRepQualityRow = {
  id: string;
  workout_set_id: string;
  rep_index: number;
  quality_pct: number;
};

function mapWorkoutSessionRow(
  s: DbWorkoutSessionRow,
  exercises: WorkoutExercise[],
): WorkoutSession {
  return {
    id: s.id,
    userId: s.user_id,
    sessionDate: s.session_date,
    scheduleId: s.schedule_id,
    scheduleDayId: s.schedule_day_id,
    isJolly: Boolean(s.is_jolly),
    jollyMode: s.jolly_mode,
    title: s.title,
    startedAt: s.started_at,
    completedAt: s.completed_at,
    durationMinutes:
      s.duration_minutes === null ? null : Number(s.duration_minutes),
    userWeightKg: s.user_weight_kg === null ? null : Number(s.user_weight_kg),
    notes: s.notes ?? '',
    appleWatchKcal:
      s.apple_watch_kcal === null ? null : Number(s.apple_watch_kcal),
    appleWatchAvgHr:
      s.apple_watch_avg_hr === null ? null : Number(s.apple_watch_avg_hr),
    appleWatchMaxHr:
      s.apple_watch_max_hr === null ? null : Number(s.apple_watch_max_hr),
    cid: s.cid,
    exercises,
  };
}

export async function getActiveSchedule(
  userId: string,
): Promise<RotationSchedule | null> {
  const schedRow = await queryOne<DbScheduleRow>(
    'SELECT * FROM schedules WHERE user_id = $1 AND is_active = 1 ORDER BY updated_at DESC LIMIT 1',
    [userId],
  );

  if (!schedRow) return null;

  const dayRes = await query<DbScheduleDayRow>(
    'SELECT * FROM schedule_days WHERE schedule_id = $1 ORDER BY position ASC',
    [schedRow.id],
  );
  const dayRows = dayRes.rows;

  const dayIds = dayRows.map((d) => d.id);
  const exercisesByDay = new Map<string, ScheduleDayExercise[]>();

  if (dayIds.length > 0) {
    const placeholders = dayIds.map((_, i) => `$${i + 1}`).join(',');
    const exRes = await query<DbScheduleDayExerciseRow>(
      `
      SELECT sde.*, e.name AS exercise_name, e.tracking_type AS tracking_type
      FROM schedule_day_exercises sde
      JOIN exercises e ON e.id = sde.exercise_id
      WHERE sde.schedule_day_id IN (${placeholders})
      ORDER BY sde.order_index ASC
      `,
      dayIds,
    );

    for (const r of exRes.rows) {
      const list = exercisesByDay.get(r.schedule_day_id) ?? [];
      list.push({
        id: r.id,
        scheduleDayId: r.schedule_day_id,
        exerciseId: r.exercise_id,
        exerciseName: r.exercise_name,
        trackingType: r.tracking_type,
        orderIndex: Number(r.order_index),
        targetSets: Number(r.target_sets),
        targetReps: r.target_reps === null ? null : Number(r.target_reps),
        targetRepsMin:
          r.target_reps_min === null ? null : Number(r.target_reps_min),
        targetRepsMax:
          r.target_reps_max === null ? null : Number(r.target_reps_max),
        targetTimeSeconds:
          r.target_time_seconds === null ? null : Number(r.target_time_seconds),
        targetWeightKg:
          r.target_weight_kg === null ? null : Number(r.target_weight_kg),
        targetDistanceM:
          r.target_distance_m === null ? null : Number(r.target_distance_m),
        restSeconds: Number(r.rest_seconds),
        notes: r.notes ?? '',
      });
      exercisesByDay.set(r.schedule_day_id, list);
    }
  }

  const days: ScheduleDay[] = dayRows.map((d) => ({
    id: d.id,
    scheduleId: d.schedule_id,
    position: Number(d.position),
    label: d.label,
    isRestDay: Boolean(d.is_rest_day),
    exercises: exercisesByDay.get(d.id) ?? [],
  }));

  return {
    id: schedRow.id,
    userId: schedRow.user_id,
    name: schedRow.name,
    isActive: Boolean(schedRow.is_active),
    rotationAnchorDate: schedRow.rotation_anchor_date,
    rotationAnchorIndex: Number(schedRow.rotation_anchor_index),
    createdAt: schedRow.created_at,
    updatedAt: schedRow.updated_at,
    days,
  };
}

export async function listScheduleEvents(
  userId: string,
  scheduleId: string,
  opts?: { from?: string; to?: string },
): Promise<ScheduleEvent[]> {
  const clauses = ['user_id = $1', 'schedule_id = $2'];
  const params: Array<string> = [userId, scheduleId];
  let idx = 3;

  if (opts?.from) {
    clauses.push(`event_date >= $${idx++}`);
    params.push(opts.from);
  }
  if (opts?.to) {
    clauses.push(`event_date <= $${idx++}`);
    params.push(opts.to);
  }

  const res = await query<DbScheduleEventRow>(
    `SELECT * FROM schedule_events WHERE ${clauses.join(' AND ')} ORDER BY event_date ASC, created_at ASC`,
    params,
  );

  return res.rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    scheduleId: r.schedule_id,
    eventDate: r.event_date,
    eventType: r.event_type,
    shiftDays:
      r.shift_days === 1 || r.shift_days === 2 || r.shift_days === 3
        ? r.shift_days
        : null,
    jollyLabel: r.jolly_label,
    createdAt: r.created_at,
  }));
}

async function hydrateSessions(
  sessionRows: DbWorkoutSessionRow[],
): Promise<WorkoutSession[]> {
  if (sessionRows.length === 0) return [];
  const sessionIds = sessionRows.map((s) => s.id);
  const sPlaceholders = sessionIds.map((_, i) => `$${i + 1}`).join(',');

  const exRes = await query<DbWorkoutExerciseRow>(
    `
    SELECT we.*, e.name AS exercise_name, e.tracking_type AS tracking_type
    FROM workout_exercises we
    JOIN exercises e ON e.id = we.exercise_id
    WHERE we.session_id IN (${sPlaceholders})
    ORDER BY we.order_index ASC
    `,
    sessionIds,
  );
  const exRows = exRes.rows;

  const setsByEx = new Map<string, WorkoutSet[]>();
  const exIds = exRows.map((e) => e.id);

  if (exIds.length > 0) {
    const ePlaceholders = exIds.map((_, i) => `$${i + 1}`).join(',');
    const setRes = await query<DbWorkoutSetRow>(
      `
      SELECT * FROM workout_sets
      WHERE workout_exercise_id IN (${ePlaceholders})
      ORDER BY set_number ASC
      `,
      exIds,
    );
    const setRows = setRes.rows;

    const setIds = setRows.map((s) => s.id);
    const repQBySet = new Map<string, WorkoutSetRepQuality[]>();

    if (setIds.length > 0) {
      const qPlaceholders = setIds.map((_, i) => `$${i + 1}`).join(',');
      const rqRes = await query<DbRepQualityRow>(
        `
        SELECT * FROM workout_set_rep_qualities
        WHERE workout_set_id IN (${qPlaceholders})
        ORDER BY rep_index ASC
        `,
        setIds,
      );

      for (const rq of rqRes.rows) {
        const list = repQBySet.get(rq.workout_set_id) ?? [];
        list.push({
          id: rq.id,
          workoutSetId: rq.workout_set_id,
          repIndex: Number(rq.rep_index),
          qualityPct: Number(rq.quality_pct),
        });
        repQBySet.set(rq.workout_set_id, list);
      }
    }

    for (const s of setRows) {
      const list = setsByEx.get(s.workout_exercise_id) ?? [];
      const repQualities = repQBySet.get(s.id);
      list.push({
        id: s.id,
        workoutExerciseId: s.workout_exercise_id,
        setNumber: Number(s.set_number),
        weightKg: s.weight_kg === null ? null : Number(s.weight_kg),
        reps: s.reps === null ? null : Number(s.reps),
        timeSeconds: s.time_seconds === null ? null : Number(s.time_seconds),
        distanceM: s.distance_m === null ? null : Number(s.distance_m),
        restSeconds: s.rest_seconds === null ? null : Number(s.rest_seconds),
        actualRestSeconds:
          s.actual_rest_seconds === null || s.actual_rest_seconds === undefined
            ? null
            : Number(s.actual_rest_seconds),
        restApproximate: Boolean(s.rest_approximate),
        executionQualityPct:
          s.execution_quality_pct === null
            ? null
            : Number(s.execution_quality_pct),
        isCompleted: Boolean(s.is_completed),
        createdAt: s.created_at,
        ...(repQualities && repQualities.length > 0 ? { repQualities } : {}),
      });
      setsByEx.set(s.workout_exercise_id, list);
    }
  }

  const exBySession = new Map<string, WorkoutExercise[]>();
  for (const ex of exRows) {
    const list = exBySession.get(ex.session_id) ?? [];
    list.push({
      id: ex.id,
      sessionId: ex.session_id,
      exerciseId: ex.exercise_id,
      exerciseName: ex.exercise_name,
      trackingType: ex.tracking_type,
      orderIndex: Number(ex.order_index),
      notes: ex.notes ?? '',
      sets: setsByEx.get(ex.id) ?? [],
    });
    exBySession.set(ex.session_id, list);
  }

  return sessionRows.map((s) =>
    mapWorkoutSessionRow(s, exBySession.get(s.id) ?? []),
  );
}

export async function listWorkoutSessions(
  userId: string,
  opts?: {
    from?: string;
    to?: string;
    limit?: number;
    includeExercises?: boolean;
  },
): Promise<WorkoutSession[]> {
  const clauses = ['user_id = $1'];
  const params: Array<string | number> = [userId];
  let idx = 2;

  if (opts?.from) {
    clauses.push(`session_date >= $${idx++}`);
    params.push(opts.from);
  }
  if (opts?.to) {
    clauses.push(`session_date <= $${idx++}`);
    params.push(opts.to);
  }

  let limitSql = '';
  if (opts?.limit && opts.limit > 0) {
    limitSql = `LIMIT $${idx++}`;
    params.push(opts.limit);
  }

  const res = await query<DbWorkoutSessionRow>(
    `SELECT * FROM workout_sessions WHERE ${clauses.join(' AND ')} ORDER BY session_date DESC, started_at DESC ${limitSql}`,
    params,
  );

  if (opts?.includeExercises === false) {
    return res.rows.map((s) => mapWorkoutSessionRow(s, []));
  }

  return hydrateSessions(res.rows);
}

export async function getWorkoutSessionById(
  userId: string,
  sessionId: string,
): Promise<WorkoutSession | null> {
  const row = await queryOne<DbWorkoutSessionRow>(
    'SELECT * FROM workout_sessions WHERE id = $1 AND user_id = $2',
    [sessionId, userId],
  );

  if (!row) return null;
  const hydrated = await hydrateSessions([row]);
  return hydrated[0] ?? null;
}

export async function getWorkoutSessionsByDate(
  userId: string,
  sessionDate: string,
): Promise<WorkoutSession[]> {
  const res = await query<DbWorkoutSessionRow>(
    'SELECT * FROM workout_sessions WHERE user_id = $1 AND session_date = $2 ORDER BY started_at ASC',
    [userId, sessionDate],
  );

  return hydrateSessions(res.rows);
}

/**
 * Returns the most recent logged completed sets per exerciseId (useful for prefill and swap sheets).
 */
export async function getLastPerformanceByExerciseIds(
  userId: string,
  exerciseIds: string[],
  beforeDate?: string,
): Promise<Record<string, ExercisePrefill>> {
  if (exerciseIds.length === 0) return {};
  const result: Record<string, ExercisePrefill> = {};

  const dateFilter = beforeDate ? 'AND ws.session_date <= $3' : '';
  const matchSql = `
    SELECT we.id AS workout_exercise_id, ws.session_date
    FROM workout_exercises we
    JOIN workout_sessions ws ON ws.id = we.session_id
    WHERE ws.user_id = $1
      AND ws.completed_at IS NOT NULL
      AND we.exercise_id = $2
      ${dateFilter}
    ORDER BY ws.session_date DESC, ws.started_at DESC
    LIMIT 1
  `;

  const setsSql = `
    SELECT set_number, weight_kg, reps, time_seconds, distance_m, rest_seconds,
           actual_rest_seconds, rest_approximate
    FROM workout_sets
    WHERE workout_exercise_id = $1 AND is_completed = 1
    ORDER BY set_number ASC
  `;

  for (const exerciseId of exerciseIds) {
    const matchParams = beforeDate
      ? [userId, exerciseId, beforeDate]
      : [userId, exerciseId];
    const match = await queryOne<{
      workout_exercise_id: string;
      session_date: string;
    }>(matchSql, matchParams);

    if (!match) continue;

    const setRes = await query<{
      set_number: number;
      weight_kg: number | null;
      reps: number | null;
      time_seconds: number | null;
      distance_m: number | null;
      rest_seconds: number | null;
      actual_rest_seconds: number | null;
      rest_approximate: number;
    }>(setsSql, [match.workout_exercise_id]);

    result[exerciseId] = {
      exerciseId,
      lastSessionDate: match.session_date,
      sets: setRes.rows.map((s) => ({
        setNumber: Number(s.set_number),
        weightKg: s.weight_kg === null ? null : Number(s.weight_kg),
        reps: s.reps === null ? null : Number(s.reps),
        timeSeconds: s.time_seconds === null ? null : Number(s.time_seconds),
        distanceM: s.distance_m === null ? null : Number(s.distance_m),
        restSeconds: s.rest_seconds === null ? null : Number(s.rest_seconds),
        actualRestSeconds:
          s.actual_rest_seconds === null || s.actual_rest_seconds === undefined
            ? null
            : Number(s.actual_rest_seconds),
        restApproximate: Boolean(s.rest_approximate),
      })),
    };
  }

  return result;
}
