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
import { getDb } from './connection';

interface DbScheduleRow {
  id: string;
  user_id: string;
  name: string;
  is_active: number;
  rotation_anchor_date: string;
  rotation_anchor_index: number;
  created_at: string;
  updated_at: string;
}

interface DbScheduleDayRow {
  id: string;
  schedule_id: string;
  position: number;
  label: string;
  is_rest_day: number;
}

interface DbScheduleDayExerciseRow {
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
}

interface DbScheduleEventRow {
  id: string;
  user_id: string;
  schedule_id: string;
  event_date: string;
  event_type: ScheduleEventType;
  shift_days: number | null;
  jolly_label: string | null;
  created_at: string;
}

interface DbWorkoutSessionRow {
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
}

interface DbWorkoutExerciseRow {
  id: string;
  session_id: string;
  exercise_id: string;
  exercise_name: string;
  tracking_type: TrackingType;
  order_index: number;
  notes: string;
}

interface DbWorkoutSetRow {
  id: string;
  workout_exercise_id: string;
  set_number: number;
  weight_kg: number | null;
  reps: number | null;
  time_seconds: number | null;
  distance_m: number | null;
  rest_seconds: number | null;
  execution_quality_pct: number | null;
  is_completed: number;
  created_at: string;
}

interface DbRepQualityRow {
  id: string;
  workout_set_id: string;
  rep_index: number;
  quality_pct: number;
}

export function getActiveSchedule(userId: string): RotationSchedule | null {
  const db = getDb();
  const schedRow = db
    .prepare(
      'SELECT * FROM schedules WHERE user_id = ? AND is_active = 1 ORDER BY updated_at DESC LIMIT 1',
    )
    .get(userId) as DbScheduleRow | undefined;

  if (!schedRow) return null;

  const dayRows = db
    .prepare(
      'SELECT * FROM schedule_days WHERE schedule_id = ? ORDER BY position ASC',
    )
    .all(schedRow.id) as unknown as DbScheduleDayRow[];

  const dayIds = dayRows.map((d) => d.id);
  const exercisesByDay = new Map<string, ScheduleDayExercise[]>();

  if (dayIds.length > 0) {
    const placeholders = dayIds.map(() => '?').join(',');
    const exRows = db
      .prepare(`
        SELECT sde.*, e.name AS exercise_name, e.tracking_type AS tracking_type
        FROM schedule_day_exercises sde
        JOIN exercises e ON e.id = sde.exercise_id
        WHERE sde.schedule_day_id IN (${placeholders})
        ORDER BY sde.order_index ASC
      `)
      .all(...dayIds) as unknown as DbScheduleDayExerciseRow[];

    for (const r of exRows) {
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

export function listScheduleEvents(
  userId: string,
  scheduleId: string,
  opts?: { from?: string; to?: string },
): ScheduleEvent[] {
  const db = getDb();
  const clauses = ['user_id = ?', 'schedule_id = ?'];
  const params: Array<string> = [userId, scheduleId];

  if (opts?.from) {
    clauses.push('event_date >= ?');
    params.push(opts.from);
  }
  if (opts?.to) {
    clauses.push('event_date <= ?');
    params.push(opts.to);
  }

  const rows = db
    .prepare(
      `SELECT * FROM schedule_events WHERE ${clauses.join(' AND ')} ORDER BY event_date ASC, created_at ASC`,
    )
    .all(...params) as unknown as DbScheduleEventRow[];

  return rows.map((r) => ({
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

function hydrateSessions(sessionRows: DbWorkoutSessionRow[]): WorkoutSession[] {
  if (sessionRows.length === 0) return [];
  const db = getDb();
  const sessionIds = sessionRows.map((s) => s.id);
  const sPlaceholders = sessionIds.map(() => '?').join(',');

  const exRows = db
    .prepare(`
      SELECT we.*, e.name AS exercise_name, e.tracking_type AS tracking_type
      FROM workout_exercises we
      JOIN exercises e ON e.id = we.exercise_id
      WHERE we.session_id IN (${sPlaceholders})
      ORDER BY we.order_index ASC
    `)
    .all(...sessionIds) as unknown as DbWorkoutExerciseRow[];

  const setsByEx = new Map<string, WorkoutSet[]>();
  const exIds = exRows.map((e) => e.id);

  if (exIds.length > 0) {
    const ePlaceholders = exIds.map(() => '?').join(',');
    const setRows = db
      .prepare(`
        SELECT * FROM workout_sets
        WHERE workout_exercise_id IN (${ePlaceholders})
        ORDER BY set_number ASC
      `)
      .all(...exIds) as unknown as DbWorkoutSetRow[];

    const setIds = setRows.map((s) => s.id);
    const repQBySet = new Map<string, WorkoutSetRepQuality[]>();

    if (setIds.length > 0) {
      const qPlaceholders = setIds.map(() => '?').join(',');
      const rqRows = db
        .prepare(`
          SELECT * FROM workout_set_rep_qualities
          WHERE workout_set_id IN (${qPlaceholders})
          ORDER BY rep_index ASC
        `)
        .all(...setIds) as unknown as DbRepQualityRow[];

      for (const rq of rqRows) {
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

  return sessionRows.map((s) => ({
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
    exercises: exBySession.get(s.id) ?? [],
  }));
}

export function listWorkoutSessions(
  userId: string,
  opts?: {
    from?: string;
    to?: string;
    limit?: number;
    includeExercises?: boolean;
  },
): WorkoutSession[] {
  const db = getDb();
  const clauses = ['user_id = ?'];
  const params: Array<string | number> = [userId];

  if (opts?.from) {
    clauses.push('session_date >= ?');
    params.push(opts.from);
  }
  if (opts?.to) {
    clauses.push('session_date <= ?');
    params.push(opts.to);
  }

  const limitSql = opts?.limit && opts.limit > 0 ? 'LIMIT ?' : '';
  if (limitSql) {
    params.push(opts!.limit!);
  }

  const rows = db
    .prepare(
      `SELECT * FROM workout_sessions WHERE ${clauses.join(' AND ')} ORDER BY session_date DESC, started_at DESC ${limitSql}`,
    )
    .all(...params) as unknown as DbWorkoutSessionRow[];

  if (opts?.includeExercises === false) {
    return rows.map((s) => ({
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
      userWeightKg:
        s.user_weight_kg === null ? null : Number(s.user_weight_kg),
      notes: s.notes ?? '',
      appleWatchKcal:
        s.apple_watch_kcal === null ? null : Number(s.apple_watch_kcal),
      appleWatchAvgHr:
        s.apple_watch_avg_hr === null ? null : Number(s.apple_watch_avg_hr),
      appleWatchMaxHr:
        s.apple_watch_max_hr === null ? null : Number(s.apple_watch_max_hr),
      cid: s.cid,
      exercises: [],
    }));
  }

  return hydrateSessions(rows);
}

export function getWorkoutSessionById(
  userId: string,
  sessionId: string,
): WorkoutSession | null {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM workout_sessions WHERE id = ? AND user_id = ?')
    .get(sessionId, userId) as DbWorkoutSessionRow | undefined;

  if (!row) return null;
  return hydrateSessions([row])[0] ?? null;
}

export function getWorkoutSessionsByDate(
  userId: string,
  sessionDate: string,
): WorkoutSession[] {
  const db = getDb();
  const rows = db
    .prepare(
      'SELECT * FROM workout_sessions WHERE user_id = ? AND session_date = ? ORDER BY started_at ASC',
    )
    .all(userId, sessionDate) as unknown as DbWorkoutSessionRow[];

  return hydrateSessions(rows);
}

/**
 * Returns the most recent logged completed sets per exerciseId (useful for prefill and swap sheets).
 */
export function getLastPerformanceByExerciseIds(
  userId: string,
  exerciseIds: string[],
  beforeDate?: string,
): Record<string, ExercisePrefill> {
  if (exerciseIds.length === 0) return {};
  const db = getDb();
  const result: Record<string, ExercisePrefill> = {};

  const dateFilter = beforeDate ? 'AND ws.session_date <= ?' : '';
  const stmt = db.prepare(`
    SELECT we.id AS workout_exercise_id, ws.session_date
    FROM workout_exercises we
    JOIN workout_sessions ws ON ws.id = we.session_id
    WHERE ws.user_id = ?
      AND ws.completed_at IS NOT NULL
      AND we.exercise_id = ?
      ${dateFilter}
    ORDER BY ws.session_date DESC, ws.started_at DESC
    LIMIT 1
  `);

  const setsStmt = db.prepare(`
    SELECT set_number, weight_kg, reps, time_seconds, distance_m, rest_seconds
    FROM workout_sets
    WHERE workout_exercise_id = ? AND is_completed = 1
    ORDER BY set_number ASC
  `);

  for (const exerciseId of exerciseIds) {
    const match = (
      beforeDate
        ? stmt.get(userId, exerciseId, beforeDate)
        : stmt.get(userId, exerciseId)
    ) as { workout_exercise_id: string; session_date: string } | undefined;

    if (!match) continue;

    const setRows = setsStmt.all(match.workout_exercise_id) as unknown as Array<{
      set_number: number;
      weight_kg: number | null;
      reps: number | null;
      time_seconds: number | null;
      distance_m: number | null;
      rest_seconds: number | null;
    }>;

    result[exerciseId] = {
      exerciseId,
      lastSessionDate: match.session_date,
      sets: setRows.map((s) => ({
        setNumber: Number(s.set_number),
        weightKg: s.weight_kg === null ? null : Number(s.weight_kg),
        reps: s.reps === null ? null : Number(s.reps),
        timeSeconds: s.time_seconds === null ? null : Number(s.time_seconds),
        distanceM: s.distance_m === null ? null : Number(s.distance_m),
        restSeconds: s.rest_seconds === null ? null : Number(s.rest_seconds),
      })),
    };
  }

  return result;
}
