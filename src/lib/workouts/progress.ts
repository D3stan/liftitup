import type { TrackingType, UserProfile, WeightUnit } from '@/types/domain';
import { ApiError } from '@/lib/api/handler';
import {
  listBodyMetrics,
  resolveDailyBodyWeights,
} from '@/lib/db/bodyMetrics';
import { isPgMemActive, query } from '@/lib/db/connection';
import { localDateForTimezone } from '@/lib/db/users';
import { listWorkoutSessions } from '@/lib/db/workouts';
import { computeSessionRestSummary, type SessionRestSummary } from './rest';

export type ProgressRange = '4w' | '12w' | 'all';

export interface ProgressExerciseOption {
  id: string;
  name: string;
  trackingType: TrackingType;
  sessionCount: number;
}

export interface ExerciseProgressPoint {
  date: string;
  primaryValue: number;
  volumeKg: number | null;
  setsCount: number;
  bestReps: number | null;
  bestTimeSeconds: number | null;
  bestDistanceM: number | null;
}

export interface WeeklyBarPoint {
  weekStart: string;
  value: number;
}

export interface BodyWeightPoint {
  date: string;
  weightKg: number;
  source: string;
}

export interface ProgressResponse {
  range: ProgressRange;
  unit: WeightUnit;
  exercises: ProgressExerciseOption[];
  selectedExercise: ProgressExerciseOption | null;
  exerciseSeries: ExerciseProgressPoint[];
  weeklySessions: WeeklyBarPoint[];
  weeklySets: WeeklyBarPoint[];
  bodyWeightSeries: BodyWeightPoint[];
}

export interface ExercisePersonalRecord {
  exerciseId: string;
  exerciseName: string;
  trackingType: TrackingType;
  bestWeightKg: number | null;
  bestReps: number | null;
  bestTimeSeconds: number | null;
  bestDistanceM: number | null;
  bestSessionVolumeKg: number | null;
  bestEstimated1RmKg: number | null;
  bestDate: string | null;
}

export interface SessionRestReportItem {
  sessionId: string;
  sessionDate: string;
  title: string;
  durationMinutes: number | null;
  summary: SessionRestSummary;
}

export interface ExerciseRestStatsItem {
  exerciseId: string;
  exerciseName: string;
  measuredSetCount: number;
  approximateSetCount: number;
  avgActualRestSeconds: number;
  minActualRestSeconds: number;
  maxActualRestSeconds: number;
}

export interface ProgressAndRestReport extends ProgressResponse {
  personalRecords: ExercisePersonalRecord[];
  restSummary: {
    sessionCount: number;
    sessionsWithMeasuredRest: number;
    sessionsAllRestsMeasured: number;
    sessionsWithApproximateRest: number;
    totalMeasuredSets: number;
    overallAvgActualRestSeconds: number | null;
    perSession: SessionRestReportItem[];
    perExercise: ExerciseRestStatsItem[];
  };
}

function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function mondayOfWeek(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  dt.setUTCDate(dt.getUTCDate() + diff);
  return dt.toISOString().slice(0, 10);
}

function buildWeekBuckets(
  fromDate: string | null,
  toDate: string,
  countsByWeek: Map<string, number>,
): WeeklyBarPoint[] {
  if (!fromDate) {
    return Array.from(countsByWeek.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([weekStart, value]) => ({ weekStart, value }));
  }

  const startMonday = mondayOfWeek(fromDate);
  const endMonday = mondayOfWeek(toDate);
  const result: WeeklyBarPoint[] = [];
  let cursor = startMonday;
  while (cursor <= endMonday) {
    result.push({
      weekStart: cursor,
      value: countsByWeek.get(cursor) ?? 0,
    });
    cursor = addDaysIso(cursor, 7);
  }
  return result;
}

type RawSetRow = {
  session_date: string;
  weight_kg: number | null;
  reps: number | null;
  time_seconds: number | null;
  distance_m: number | null;
};

function computePrimaryValue(
  trackingType: TrackingType,
  rows: RawSetRow[],
): number {
  switch (trackingType) {
    case 'weight_reps':
    case 'weighted_bodyweight':
    case 'weight_time': {
      const weights = rows
        .map((r) => r.weight_kg)
        .filter((v): v is number => v !== null && Number.isFinite(v));
      if (weights.length > 0) return Math.max(...weights);
      const times = rows
        .map((r) => r.time_seconds)
        .filter((v): v is number => v !== null && Number.isFinite(v));
      return times.length > 0 ? Math.max(...times) : 0;
    }
    case 'assisted_bodyweight': {
      const weights = rows
        .map((r) => r.weight_kg)
        .filter((v): v is number => v !== null && Number.isFinite(v));
      return weights.length > 0 ? Math.min(...weights) : 0;
    }
    case 'bodyweight_reps': {
      const reps = rows
        .map((r) => r.reps)
        .filter((v): v is number => v !== null && Number.isFinite(v));
      return reps.length > 0 ? Math.max(...reps) : 0;
    }
    case 'time': {
      const times = rows
        .map((r) => r.time_seconds)
        .filter((v): v is number => v !== null && Number.isFinite(v));
      return times.length > 0 ? Math.max(...times) : 0;
    }
    case 'distance':
    case 'distance_time': {
      const dists = rows
        .map((r) => r.distance_m)
        .filter((v): v is number => v !== null && Number.isFinite(v));
      return dists.length > 0 ? Math.max(...dists) : 0;
    }
  }
}

/**
 * Computes LiftItUp's progress series, weekly cadence, and daily body weights.
 * Shared by `GET /api/progress` and MCP `get_progress_and_rest`.
 */
export async function getUserProgressReport(
  user: UserProfile,
  opts: {
    range?: string | null;
    today?: string | null;
    exerciseId?: string | null;
  } = {},
): Promise<ProgressResponse> {
  const rawRange = opts.range || '12w';
  if (rawRange !== '4w' && rawRange !== '12w' && rawRange !== 'all') {
    throw ApiError.validation('range must be 4w, 12w, or all');
  }
  const range: ProgressRange = rawRange;

  const today =
    opts.today && /^\d{4}-\d{2}-\d{2}$/.test(opts.today)
      ? opts.today
      : localDateForTimezone(user.timezone);

  const fromDate =
    range === '4w'
      ? addDaysIso(today, -27)
      : range === '12w'
        ? addDaysIso(today, -83)
        : null;

  let exercises: ProgressExerciseOption[];
  if (isPgMemActive()) {
    const { rows: pairRows } = await query<{
      id: string;
      name: string;
      tracking_type: TrackingType;
      session_id: string;
    }>(
      `
      SELECT DISTINCT
        e.id AS id,
        e.name AS name,
        e.tracking_type AS tracking_type,
        ws.id AS session_id
      FROM workout_sessions ws
      JOIN workout_exercises we ON we.session_id = ws.id
      JOIN exercises e ON e.id = we.exercise_id
      JOIN workout_sets wset ON wset.workout_exercise_id = we.id AND wset.is_completed = 1 AND wset.is_warmup = 0
      WHERE ws.user_id = $1
      `,
      [user.id],
    );
    const byExercise = new Map<
      string,
      { id: string; name: string; trackingType: TrackingType; sessions: Set<string> }
    >();
    for (const r of pairRows) {
      let entry = byExercise.get(r.id);
      if (!entry) {
        entry = {
          id: r.id,
          name: r.name,
          trackingType: r.tracking_type,
          sessions: new Set<string>(),
        };
        byExercise.set(r.id, entry);
      }
      entry.sessions.add(r.session_id);
    }
    exercises = Array.from(byExercise.values())
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        trackingType: entry.trackingType,
        sessionCount: entry.sessions.size,
      }))
      .sort(
        (a, b) => b.sessionCount - a.sessionCount || a.name.localeCompare(b.name),
      );
  } else {
    const { rows: exerciseRows } = await query<{
      id: string;
      name: string;
      tracking_type: TrackingType;
      session_count: number;
    }>(
      `
      SELECT
        e.id AS id,
        e.name AS name,
        e.tracking_type AS tracking_type,
        COUNT(DISTINCT ws.id)::int AS session_count
      FROM workout_sessions ws
      JOIN workout_exercises we ON we.session_id = ws.id
      JOIN exercises e ON e.id = we.exercise_id
      JOIN workout_sets wset ON wset.workout_exercise_id = we.id AND wset.is_completed = 1 AND wset.is_warmup = 0
      WHERE ws.user_id = $1
      GROUP BY e.id, e.name, e.tracking_type
      ORDER BY session_count DESC, e.name ASC
      `,
      [user.id],
    );

    exercises = exerciseRows.map((r) => ({
      id: r.id,
      name: r.name,
      trackingType: r.tracking_type,
      sessionCount: Number(r.session_count),
    }));
  }

  const selectedExercise =
    (opts.exerciseId
      ? exercises.find((e) => e.id === opts.exerciseId)
      : undefined) ??
    exercises[0] ??
    null;

  const exerciseSeries: ExerciseProgressPoint[] = [];
  if (selectedExercise) {
    const dateClause = fromDate ? 'AND ws.session_date >= $3' : '';
    const params: Array<string> = fromDate
      ? [user.id, selectedExercise.id, fromDate]
      : [user.id, selectedExercise.id];

    const { rows: setRows } = await query<RawSetRow>(
      `
      SELECT
        ws.session_date AS session_date,
        wset.weight_kg AS weight_kg,
        wset.reps AS reps,
        wset.time_seconds AS time_seconds,
        wset.distance_m AS distance_m
      FROM workout_sessions ws
      JOIN workout_exercises we ON we.session_id = ws.id
      JOIN workout_sets wset ON wset.workout_exercise_id = we.id AND wset.is_completed = 1 AND wset.is_warmup = 0
      WHERE ws.user_id = $1 AND we.exercise_id = $2 ${dateClause}
      ORDER BY ws.session_date ASC, wset.set_number ASC
      `,
      params,
    );

    const byDate = new Map<string, RawSetRow[]>();
    for (const row of setRows) {
      const list = byDate.get(row.session_date) ?? [];
      list.push(row);
      byDate.set(row.session_date, list);
    }

    const supportsVolume =
      selectedExercise.trackingType === 'weight_reps' ||
      selectedExercise.trackingType === 'weighted_bodyweight';

    for (const [date, rows] of Array.from(byDate.entries()).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const primaryValue = computePrimaryValue(
        selectedExercise.trackingType,
        rows,
      );

      let volumeKg: number | null = null;
      if (supportsVolume) {
        let total = 0;
        for (const r of rows) {
          if (r.weight_kg !== null && r.reps !== null) {
            total += Number(r.weight_kg) * Number(r.reps);
          }
        }
        volumeKg = Math.round(total * 10) / 10;
      }

      const repsVals = rows
        .map((r) => r.reps)
        .filter((v): v is number => v !== null)
        .map(Number);
      const timeVals = rows
        .map((r) => r.time_seconds)
        .filter((v): v is number => v !== null)
        .map(Number);
      const distVals = rows
        .map((r) => r.distance_m)
        .filter((v): v is number => v !== null)
        .map(Number);

      exerciseSeries.push({
        date,
        primaryValue,
        volumeKg,
        setsCount: rows.length,
        bestReps: repsVals.length > 0 ? Math.max(...repsVals) : null,
        bestTimeSeconds: timeVals.length > 0 ? Math.max(...timeVals) : null,
        bestDistanceM: distVals.length > 0 ? Math.max(...distVals) : null,
      });
    }
  }

  const sessionDateClause = fromDate ? 'AND ws.session_date >= $2' : '';
  const sessionParams: Array<string> = fromDate
    ? [user.id, fromDate]
    : [user.id];

  const { rows: sessionRows } = await query<{
    id: string;
    session_date: string;
    completed_sets: number;
  }>(
    `
    SELECT
      ws.id AS id,
      ws.session_date AS session_date,
      COUNT(wset.id)::int AS completed_sets
    FROM workout_sessions ws
    LEFT JOIN workout_exercises we ON we.session_id = ws.id
    LEFT JOIN workout_sets wset ON wset.workout_exercise_id = we.id AND wset.is_completed = 1 AND wset.is_warmup = 0
    WHERE ws.user_id = $1 ${sessionDateClause}
    GROUP BY ws.id, ws.session_date
    ORDER BY ws.session_date ASC
    `,
    sessionParams,
  );

  const sessionsByWeek = new Map<string, number>();
  const setsByWeek = new Map<string, number>();

  for (const s of sessionRows) {
    const wk = mondayOfWeek(s.session_date);
    sessionsByWeek.set(wk, (sessionsByWeek.get(wk) ?? 0) + 1);
    setsByWeek.set(wk, (setsByWeek.get(wk) ?? 0) + Number(s.completed_sets));
  }

  const weeklySessions = buildWeekBuckets(fromDate, today, sessionsByWeek);
  const weeklySets = buildWeekBuckets(fromDate, today, setsByWeek);

  const bodyMetrics = await listBodyMetrics(user.id, {
    from: fromDate ?? undefined,
  });
  const resolvedDaily = resolveDailyBodyWeights(bodyMetrics);
  const bodyWeightSeries: BodyWeightPoint[] = resolvedDaily.map((m) => ({
    date: m.measuredOn,
    weightKg: m.weightKg,
    source: m.source,
  }));

  return {
    range,
    unit: user.unit,
    exercises,
    selectedExercise,
    exerciseSeries,
    weeklySessions,
    weeklySets,
    bodyWeightSeries,
  };
}

/**
 * Full progress + personal records + Phase 3 rest statistics report for MCP `get_progress_and_rest`.
 */
export async function getUserProgressAndRestReport(
  user: UserProfile,
  opts: {
    range?: string | null;
    exerciseId?: string | null;
    sessionLimit?: number;
  } = {},
): Promise<ProgressAndRestReport> {
  const progress = await getUserProgressReport(user, {
    range: opts.range,
    exerciseId: opts.exerciseId,
  });

  const today = localDateForTimezone(user.timezone);
  const fromDate =
    progress.range === '4w'
      ? addDaysIso(today, -27)
      : progress.range === '12w'
        ? addDaysIso(today, -83)
        : undefined;

  const sessionLimit = Math.max(
    1,
    Math.min(100, Math.round(opts.sessionLimit ?? 30)),
  );
  const sessions = await listWorkoutSessions(user.id, {
    from: fromDate,
    limit: sessionLimit,
    includeExercises: true,
  });

  const perSession: SessionRestReportItem[] = [];
  const exRestMap = new Map<
    string,
    {
      exerciseId: string;
      exerciseName: string;
      values: number[];
      approximateCount: number;
    }
  >();
  const prMap = new Map<
    string,
    {
      exerciseId: string;
      exerciseName: string;
      trackingType: TrackingType;
      bestWeightKg: number | null;
      bestReps: number | null;
      bestTimeSeconds: number | null;
      bestDistanceM: number | null;
      bestSessionVolumeKg: number | null;
      bestEstimated1RmKg: number | null;
      bestDate: string | null;
    }
  >();

  let sessionsWithMeasuredRest = 0;
  let sessionsAllRestsMeasured = 0;
  let sessionsWithApproximateRest = 0;
  let totalMeasuredSets = 0;
  let totalMeasuredSeconds = 0;

  for (const session of sessions) {
    const summary = computeSessionRestSummary(session);
    perSession.push({
      sessionId: session.id,
      sessionDate: session.sessionDate,
      title: session.title,
      durationMinutes: session.durationMinutes,
      summary,
    });

    if (summary.measuredCount > 0) {
      sessionsWithMeasuredRest += 1;
      totalMeasuredSets += summary.measuredCount;
      totalMeasuredSeconds += summary.totalRestSeconds;
    }
    if (summary.allRestsMeasured) {
      sessionsAllRestsMeasured += 1;
    }
    if (summary.hasAnyApproximate) {
      sessionsWithApproximateRest += 1;
    }

    for (const ex of session.exercises) {
      if (opts.exerciseId && ex.exerciseId !== opts.exerciseId) {
        continue;
      }

      const exName = ex.exerciseName ?? ex.exerciseId;
      const exTracking = ex.trackingType ?? 'weight_reps';

      let pr = prMap.get(ex.exerciseId);
      if (!pr) {
        pr = {
          exerciseId: ex.exerciseId,
          exerciseName: exName,
          trackingType: exTracking,
          bestWeightKg: null,
          bestReps: null,
          bestTimeSeconds: null,
          bestDistanceM: null,
          bestSessionVolumeKg: null,
          bestEstimated1RmKg: null,
          bestDate: null,
        };
        prMap.set(ex.exerciseId, pr);
      }

      let sessionVolume = 0;
      let hasVolume = false;

      for (const s of ex.sets) {
        if (!s.isCompleted || s.isWarmup) continue;

        if (
          s.actualRestSeconds !== null &&
          s.actualRestSeconds !== undefined
        ) {
          let exRest = exRestMap.get(ex.exerciseId);
          if (!exRest) {
            exRest = {
              exerciseId: ex.exerciseId,
              exerciseName: exName,
              values: [],
              approximateCount: 0,
            };
            exRestMap.set(ex.exerciseId, exRest);
          }
          exRest.values.push(s.actualRestSeconds);
          if (s.restApproximate) {
            exRest.approximateCount += 1;
          }
        }

        if (s.weightKg !== null) {
          const isAssisted = exTracking === 'assisted_bodyweight';
          const better =
            pr.bestWeightKg === null ||
            (isAssisted
              ? s.weightKg < pr.bestWeightKg
              : s.weightKg > pr.bestWeightKg);
          if (better) {
            pr.bestWeightKg = s.weightKg;
            pr.bestDate = session.sessionDate;
          }
          if (
            !isAssisted &&
            s.reps !== null &&
            s.reps >= 1 &&
            s.reps <= 30
          ) {
            const est1Rm =
              s.reps === 1
                ? s.weightKg
                : Math.round(s.weightKg * (1 + s.reps / 30) * 10) / 10;
            if (pr.bestEstimated1RmKg === null || est1Rm > pr.bestEstimated1RmKg) {
              pr.bestEstimated1RmKg = est1Rm;
            }
          }
        }
        if (s.reps !== null) {
          if (pr.bestReps === null || s.reps > pr.bestReps) {
            pr.bestReps = s.reps;
            if (!pr.bestDate) pr.bestDate = session.sessionDate;
          }
        }
        if (s.timeSeconds !== null) {
          if (pr.bestTimeSeconds === null || s.timeSeconds > pr.bestTimeSeconds) {
            pr.bestTimeSeconds = s.timeSeconds;
            if (!pr.bestDate) pr.bestDate = session.sessionDate;
          }
        }
        if (s.distanceM !== null) {
          if (pr.bestDistanceM === null || s.distanceM > pr.bestDistanceM) {
            pr.bestDistanceM = s.distanceM;
            if (!pr.bestDate) pr.bestDate = session.sessionDate;
          }
        }
        if (s.weightKg !== null && s.reps !== null) {
          sessionVolume += s.weightKg * s.reps;
          hasVolume = true;
        }
      }

      if (hasVolume) {
        const roundedVol = Math.round(sessionVolume * 10) / 10;
        if (
          pr.bestSessionVolumeKg === null ||
          roundedVol > pr.bestSessionVolumeKg
        ) {
          pr.bestSessionVolumeKg = roundedVol;
        }
      }
    }
  }

  const perExercise: ExerciseRestStatsItem[] = Array.from(exRestMap.values())
    .map((entry) => {
      const sum = entry.values.reduce((acc, v) => acc + v, 0);
      return {
        exerciseId: entry.exerciseId,
        exerciseName: entry.exerciseName,
        measuredSetCount: entry.values.length,
        approximateSetCount: entry.approximateCount,
        avgActualRestSeconds: Math.round(sum / entry.values.length),
        minActualRestSeconds: Math.min(...entry.values),
        maxActualRestSeconds: Math.max(...entry.values),
      };
    })
    .sort((a, b) => b.measuredSetCount - a.measuredSetCount);

  return {
    ...progress,
    personalRecords: Array.from(prMap.values()),
    restSummary: {
      sessionCount: sessions.length,
      sessionsWithMeasuredRest,
      sessionsAllRestsMeasured,
      sessionsWithApproximateRest,
      totalMeasuredSets,
      overallAvgActualRestSeconds:
        totalMeasuredSets > 0
          ? Math.round(totalMeasuredSeconds / totalMeasuredSets)
          : null,
      perSession,
      perExercise,
    },
  };
}
