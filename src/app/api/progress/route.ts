import { NextRequest, NextResponse } from 'next/server';
import { ApiError, withApiHandler } from '@/lib/api/handler';
import { requireAuth } from '@/lib/auth/session';
import { listBodyMetrics } from '@/lib/db/bodyMetrics';
import { query } from '@/lib/db/connection';
import { localDateForTimezone } from '@/lib/db/users';
import type { TrackingType, WeightUnit } from '@/types/domain';

type ProgressRange = '4w' | '12w' | 'all';

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

function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/**
 * Returns the Monday (YYYY-MM-DD) of the ISO week containing `isoDate`.
 */
function mondayOfWeek(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay(); // 0=Sun..6=Sat
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

export const GET = withApiHandler(
  'progress.get',
  async (req: NextRequest, ctx) => {
    const { user } = await requireAuth(req, ctx);
    const sp = req.nextUrl.searchParams;

    const rawRange = sp.get('range') || '12w';
    if (rawRange !== '4w' && rawRange !== '12w' && rawRange !== 'all') {
      throw ApiError.validation('range must be 4w, 12w, or all');
    }
    const range: ProgressRange = rawRange;

    const rawToday = sp.get('today');
    const today =
      rawToday && /^\d{4}-\d{2}-\d{2}$/.test(rawToday)
        ? rawToday
        : localDateForTimezone(user.timezone);

    const fromDate =
      range === '4w'
        ? addDaysIso(today, -27)
        : range === '12w'
          ? addDaysIso(today, -83)
          : null;

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
      JOIN workout_sets wset ON wset.workout_exercise_id = we.id AND wset.is_completed = 1
      WHERE ws.user_id = $1
      GROUP BY e.id, e.name, e.tracking_type
      ORDER BY session_count DESC, e.name ASC
      `,
      [user.id],
    );

    const exercises: ProgressExerciseOption[] = exerciseRows.map((r) => ({
      id: r.id,
      name: r.name,
      trackingType: r.tracking_type,
      sessionCount: Number(r.session_count),
    }));

    const requestedExerciseId = sp.get('exerciseId');
    const selectedExercise =
      (requestedExerciseId
        ? exercises.find((e) => e.id === requestedExerciseId)
        : undefined) ??
      exercises[0] ??
      null;

    // 1. Per-exercise progression series
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
        JOIN workout_sets wset ON wset.workout_exercise_id = we.id AND wset.is_completed = 1
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
              total += r.weight_kg * r.reps;
            }
          }
          volumeKg = Math.round(total * 10) / 10;
        }

        const repsVals = rows
          .map((r) => r.reps)
          .filter((v): v is number => v !== null);
        const timeVals = rows
          .map((r) => r.time_seconds)
          .filter((v): v is number => v !== null);
        const distVals = rows
          .map((r) => r.distance_m)
          .filter((v): v is number => v !== null);

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

    // 2. Weekly sessions & weekly sets
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
      LEFT JOIN workout_sets wset ON wset.workout_exercise_id = we.id AND wset.is_completed = 1
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

    // 3. Body weight history
    const bodyMetrics = await listBodyMetrics(user.id, {
      from: fromDate ?? undefined,
    });
    const bodyWeightSeries: BodyWeightPoint[] = bodyMetrics.map((m) => ({
      date: m.measuredOn,
      weightKg: m.weightKg,
      source: m.source,
    }));

    const payload: ProgressResponse = {
      range,
      unit: user.unit,
      exercises,
      selectedExercise,
      exerciseSeries,
      weeklySessions,
      weeklySets,
      bodyWeightSeries,
    };

    return NextResponse.json(payload);
  },
);
