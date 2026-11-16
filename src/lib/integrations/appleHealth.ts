import crypto from 'node:crypto';
import type {
  AppleHealthReceiveKind,
  AppleHealthWorkout,
  UserProfile,
} from '@/types/domain';
import { ApiError } from '@/lib/api/handler';
import {
  recordBodyMetric,
  syncUserProfileWeightFromBodyMetrics,
} from '@/lib/db/bodyMetrics';
import { query, queryOne, withTransaction } from '@/lib/db/connection';
import { recordAppleHealthLastReceived } from '@/lib/db/users';
import {
  AppleHealthValidationError,
  compareOverlapScores,
  computeIntervalOverlap,
  extractIngestMeta,
  findBestMatchingHealthWorkout,
  parseAppleHealthFileStrict,
  parseOptionalWeight,
  rankMatchingSessions,
  validateAppleHealthIngestPayload,
  type AppleHealthSource,
  type ValidatedAppleHealthIngest,
} from './appleHealthValidation';

export {
  AppleHealthValidationError,
  compareOverlapScores,
  computeIntervalOverlap,
  extractIngestMeta,
  findBestMatchingHealthWorkout,
  MAX_APPLE_HEALTH_ITEMS,
  OVERLAP_TOLERANCE_MS,
  parseAppleHealthFileStrict,
  parseOptionalWeight,
  rankMatchingSessions,
  validateAppleHealthIngestPayload,
  type AppleHealthSource,
  type IntervalSessionInput,
  type IntervalWorkoutInput,
  type OverlapScore,
  type ValidatedAppleHealthIngest,
  type ValidatedAppleHealthItem,
  type ValidatedWeightItem,
  type ValidatedWorkoutItem,
} from './appleHealthValidation';

type DbAppleHealthRow = {
  id: string;
  user_id: string;
  workout_type: string;
  started_at: string;
  duration_minutes: number;
  active_calories: number | null;
  avg_heart_rate: number | null;
  max_heart_rate: number | null;
  bodyweight_kg: number | null;
  linked_session_id: string | null;
  source: string;
  created_at: string;
};

type DbSessionOverlapRow = {
  id: string;
  session_date: string;
  started_at: string;
  completed_at: string | null;
  duration_minutes: number | null;
  apple_watch_kcal: number | null;
  apple_watch_avg_hr: number | null;
  apple_watch_max_hr: number | null;
};

function mapAppleHealthRow(row: DbAppleHealthRow): AppleHealthWorkout {
  return {
    id: row.id,
    userId: row.user_id,
    workoutType: row.workout_type,
    startedAt: row.started_at,
    durationMinutes: Number(row.duration_minutes),
    activeCalories:
      row.active_calories !== null && row.active_calories !== undefined
        ? Number(row.active_calories)
        : null,
    avgHeartRate:
      row.avg_heart_rate !== null && row.avg_heart_rate !== undefined
        ? Number(row.avg_heart_rate)
        : null,
    maxHeartRate:
      row.max_heart_rate !== null && row.max_heart_rate !== undefined
        ? Number(row.max_heart_rate)
        : null,
    bodyweightKg:
      row.bodyweight_kg !== null && row.bodyweight_kg !== undefined
        ? Number(row.bodyweight_kg)
        : null,
    linkedSessionId: row.linked_session_id,
    source: row.source,
    createdAt: row.created_at,
  };
}

function addDaysYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export async function listAppleHealthWorkouts(
  userId: string,
  limit = 25,
): Promise<AppleHealthWorkout[]> {
  const safeLimit = Math.max(1, Math.min(200, Math.round(limit)));
  const { rows } = await query<DbAppleHealthRow>(
    `SELECT * FROM apple_health_workouts
     WHERE user_id = $1
     ORDER BY started_at DESC, created_at DESC
     LIMIT $2`,
    [userId, safeLimit],
  );
  return rows.map(mapAppleHealthRow);
}

/**
 * Shared Phase 5 helper: finds the best overlapping session (±15 min tolerance)
 * for a newly-arrived or retried Apple Health workout, and links it without
 * overwriting another workout's metrics unless the new workout overlaps strictly better.
 */
async function linkHealthWorkoutToBestSessionInTx(
  userId: string,
  workout: AppleHealthWorkout,
): Promise<AppleHealthWorkout> {
  // If already linked (from an earlier attempt of the same workout on retry),
  // keep the link if the session still exists and overlaps, and refresh its metrics.
  if (workout.linkedSessionId) {
    const linkedSess = await queryOne<DbSessionOverlapRow>(
      `SELECT id, session_date, started_at, completed_at, duration_minutes,
              apple_watch_kcal, apple_watch_avg_hr, apple_watch_max_hr
       FROM workout_sessions
       WHERE id = $1 AND user_id = $2`,
      [workout.linkedSessionId, userId],
    );
    if (
      linkedSess &&
      computeIntervalOverlap(workout, {
        startedAt: linkedSess.started_at,
        completedAt: linkedSess.completed_at,
        durationMinutes:
          linkedSess.duration_minutes !== null
            ? Number(linkedSess.duration_minutes)
            : null,
      }) !== null
    ) {
      await query(
        `UPDATE workout_sessions
         SET apple_watch_kcal = $1,
             apple_watch_avg_hr = $2,
             apple_watch_max_hr = $3
         WHERE id = $4 AND user_id = $5`,
        [
          workout.activeCalories,
          workout.avgHeartRate,
          workout.maxHeartRate,
          linkedSess.id,
          userId,
        ],
      );
      return workout;
    }

    // Linked session no longer exists or no longer overlaps after duration update: unlink first.
    await query(
      'UPDATE apple_health_workouts SET linked_session_id = NULL WHERE id = $1 AND user_id = $2',
      [workout.id, userId],
    );
    workout = { ...workout, linkedSessionId: null };
  }

  const utcDate = new Date(workout.startedAt).toISOString().slice(0, 10);
  const minDate = addDaysYmd(utcDate, -2);
  const maxDate = addDaysYmd(utcDate, 2);

  const { rows: sessionRows } = await query<DbSessionOverlapRow>(
    `SELECT id, session_date, started_at, completed_at, duration_minutes,
            apple_watch_kcal, apple_watch_avg_hr, apple_watch_max_hr
     FROM workout_sessions
     WHERE user_id = $1 AND session_date >= $2 AND session_date <= $3
     ORDER BY started_at DESC`,
    [userId, minDate, maxDate],
  );

  if (sessionRows.length === 0) {
    return workout;
  }

  const candidates = sessionRows.map((s) => ({
    id: s.id,
    startedAt: s.started_at,
    completedAt: s.completed_at,
    durationMinutes:
      s.duration_minutes !== null ? Number(s.duration_minutes) : null,
    hasExistingMetrics:
      s.apple_watch_kcal !== null ||
      s.apple_watch_avg_hr !== null ||
      s.apple_watch_max_hr !== null,
  }));

  const ranked = rankMatchingSessions(workout, candidates);
  if (ranked.length === 0) {
    return workout;
  }

  const candidateIds = ranked.map((r) => r.session.id);
  const placeholders = candidateIds.map((_, i) => `$${i + 3}`).join(',');
  const { rows: linkedAhRows } = await query<DbAppleHealthRow>(
    `SELECT * FROM apple_health_workouts
     WHERE user_id = $1 AND id <> $2 AND linked_session_id IN (${placeholders})`,
    [userId, workout.id, ...candidateIds],
  );

  const linkedBySessionId = new Map<string, AppleHealthWorkout>();
  for (const r of linkedAhRows) {
    if (r.linked_session_id) {
      linkedBySessionId.set(r.linked_session_id, mapAppleHealthRow(r));
    }
  }

  for (const { session, score } of ranked) {
    const existingAh = linkedBySessionId.get(session.id);

    if (existingAh) {
      const existingScore = computeIntervalOverlap(existingAh, session);
      const isStrictlyBetter =
        existingScore === null || compareOverlapScores(score, existingScore) > 0;
      if (!isStrictlyBetter) {
        continue;
      }

      // Unlink the strictly worse prior Apple Health workout before linking the better one
      await query(
        'UPDATE apple_health_workouts SET linked_session_id = NULL WHERE id = $1 AND user_id = $2',
        [existingAh.id, userId],
      );
    } else if (session.hasExistingMetrics) {
      // Session already has Apple Watch metrics with no linked Apple Health row to compare;
      // do not overwrite them silently.
      continue;
    }

    await query(
      'UPDATE apple_health_workouts SET linked_session_id = $1 WHERE id = $2 AND user_id = $3',
      [session.id, workout.id, userId],
    );
    await query(
      `UPDATE workout_sessions
       SET apple_watch_kcal = $1,
           apple_watch_avg_hr = $2,
           apple_watch_max_hr = $3
       WHERE id = $4 AND user_id = $5`,
      [
        workout.activeCalories,
        workout.avgHeartRate,
        workout.maxHeartRate,
        session.id,
        userId,
      ],
    );

    return { ...workout, linkedSessionId: session.id };
  }

  return workout;
}

/**
 * Shared Phase 5 helper (reused by saveWorkoutSession, handleLogWorkoutSession, and Phase 11):
 * looks for an unlinked Apple Health workout that overlaps the newly saved session
 * within ±15 minutes, picks the best overlap, links it, and copies HR/calories onto the session.
 */
export async function linkBestUnlinkedHealthWorkoutToSessionInTx(
  userId: string,
  session: {
    id: string;
    startedAt: string;
    completedAt: string | null;
    durationMinutes: number | null;
    appleWatchKcal?: number | null;
    appleWatchAvgHr?: number | null;
    appleWatchMaxHr?: number | null;
  },
): Promise<AppleHealthWorkout | null> {
  if (
    session.appleWatchKcal != null ||
    session.appleWatchAvgHr != null ||
    session.appleWatchMaxHr != null
  ) {
    return null;
  }

  const { rows: unlinkedRows } = await query<DbAppleHealthRow>(
    `SELECT * FROM apple_health_workouts
     WHERE user_id = $1 AND linked_session_id IS NULL
     ORDER BY started_at DESC, created_at DESC`,
    [userId],
  );

  if (unlinkedRows.length === 0) {
    return null;
  }

  const unlinked = unlinkedRows.map(mapAppleHealthRow);
  const match = findBestMatchingHealthWorkout(session, unlinked);
  if (!match) {
    return null;
  }

  const best = match.workout;
  const linkRes = await query(
    `UPDATE apple_health_workouts
     SET linked_session_id = $1
     WHERE id = $2 AND user_id = $3 AND linked_session_id IS NULL`,
    [session.id, best.id, userId],
  );
  if (linkRes.rowCount === 0) {
    return null;
  }

  await query(
    `UPDATE workout_sessions
     SET apple_watch_kcal = $1,
         apple_watch_avg_hr = $2,
         apple_watch_max_hr = $3
     WHERE id = $4 AND user_id = $5`,
    [
      best.activeCalories,
      best.avgHeartRate,
      best.maxHeartRate,
      session.id,
      userId,
    ],
  );

  return {
    ...best,
    linkedSessionId: session.id,
  };
}

export type AppleHealthDryRunResult = {
  ok: true;
  dryRun: true;
  message: string;
  kind: AppleHealthReceiveKind;
  itemCount: number;
};

export type AppleHealthIngestResult = {
  ok: true;
  dryRun: false;
  syncedCount: number;
  workoutCount: number;
  weightCount: number;
  linkedCount: number;
  latestSynced: AppleHealthWorkout | null;
  user: UserProfile;
  workouts: AppleHealthWorkout[];
};

export function validateAppleHealthRequestOrThrow(
  body: unknown,
  options: { timezone: string; defaultSource?: AppleHealthSource },
): ValidatedAppleHealthIngest {
  try {
    return validateAppleHealthIngestPayload(body, options);
  } catch (err) {
    if (err instanceof AppleHealthValidationError) {
      throw ApiError.validation(err.message);
    }
    throw err;
  }
}

/**
 * Shared Phase 5 validation + dry-run + ingest service helper, called by
 * `POST /api/integrations/apple-health` and reused by Phase 11 MCP tools.
 */
export async function ingestAppleHealthPayload(
  user: UserProfile,
  body: unknown,
  options?: { authMethod?: 'session' | 'api_key' },
): Promise<AppleHealthDryRunResult | AppleHealthIngestResult> {
  let meta: { dryRun: boolean; source: AppleHealthSource };
  try {
    meta = extractIngestMeta(body);
  } catch (err) {
    if (err instanceof AppleHealthValidationError) {
      throw ApiError.validation(err.message);
    }
    throw err;
  }

  const validated = validateAppleHealthRequestOrThrow(body, {
    timezone: user.timezone,
    defaultSource: meta.source,
  });

  const isAllowedFileImport =
    options?.authMethod === 'session' &&
    validated.items.every((item) => item.source === 'file_import');

  if (!validated.dryRun && !user.appleFitnessEnabled && !isAllowedFileImport) {
    throw ApiError.forbidden('Apple Health integration disabled');
  }

  if (validated.dryRun) {
    const ownerName = user.displayName || user.username;
    return {
      ok: true,
      dryRun: true,
      message: `ok, key belongs to ${ownerName}, payload valid`,
      kind: validated.summaryKind,
      itemCount: validated.items.length,
    };
  }

  const savedWorkouts: AppleHealthWorkout[] = [];
  let weightCount = 0;
  let linkedCount = 0;
  let latestUser = user;

  await withTransaction(async () => {
    for (const item of validated.items) {
      if (item.kind === 'weight') {
        await recordBodyMetric({
          userId: user.id,
          measuredOn: item.measuredDate,
          weightKg: item.bodyweightKg,
          source: 'apple_health',
        });
        weightCount += 1;
        continue;
      }

      const id = `ah_${crypto.randomUUID()}`;
      const createdAt = new Date().toISOString();

      const upsertedRow = await queryOne<DbAppleHealthRow>(
        `INSERT INTO apple_health_workouts (
           id, user_id, workout_type, started_at, duration_minutes,
           active_calories, avg_heart_rate, max_heart_rate, bodyweight_kg,
           linked_session_id, source, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, $10, $11)
         ON CONFLICT (user_id, started_at, workout_type) DO UPDATE SET
           duration_minutes = EXCLUDED.duration_minutes,
           active_calories = EXCLUDED.active_calories,
           avg_heart_rate = EXCLUDED.avg_heart_rate,
           max_heart_rate = EXCLUDED.max_heart_rate,
           bodyweight_kg = EXCLUDED.bodyweight_kg,
           source = EXCLUDED.source
         RETURNING *`,
        [
          id,
          user.id,
          item.workoutType,
          item.startedAt,
          item.durationMinutes,
          item.activeCalories,
          item.avgHeartRate,
          item.maxHeartRate,
          item.bodyweightKg,
          item.source,
          createdAt,
        ],
      );

      let workout = mapAppleHealthRow(upsertedRow!);
      workout = await linkHealthWorkoutToBestSessionInTx(user.id, workout);
      if (workout.linkedSessionId !== null) {
        linkedCount += 1;
      }

      if (item.bodyweightKg !== null) {
        await recordBodyMetric({
          userId: user.id,
          measuredOn: item.measuredDate,
          weightKg: item.bodyweightKg,
          source: 'apple_health',
        });
        weightCount += 1;
      }

      savedWorkouts.push(workout);
    }

    if (weightCount > 0) {
      await syncUserProfileWeightFromBodyMetrics(user.id);
    }

    const updatedLastReceived = await recordAppleHealthLastReceived(user.id, {
      receivedAt: new Date().toISOString(),
      kind: validated.summaryKind,
      linked: savedWorkouts.length > 0 ? linkedCount > 0 : null,
    });
    if (updatedLastReceived) {
      latestUser = updatedLastReceived;
    }
  });

  const workouts = await listAppleHealthWorkouts(user.id);
  return {
    ok: true,
    dryRun: false,
    syncedCount: validated.items.length,
    workoutCount: savedWorkouts.length,
    weightCount,
    linkedCount,
    latestSynced: savedWorkouts[0] ?? null,
    user: latestUser,
    workouts,
  };
}
