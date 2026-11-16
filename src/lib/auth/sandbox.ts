import crypto from 'node:crypto';
import type { TrackingType, UserProfile } from '@/types/domain';
import { isPgMemActive, query, withTransaction } from '@/lib/db/connection';
import { recordGuestPurgeRun } from '@/lib/admin/metrics';
import { ensureDailySnapshotIfDue } from '@/lib/admin/snapshot';
import {
  recordBodyMetric,
  syncUserProfileWeightFromBodyMetrics,
} from '@/lib/db/bodyMetrics';
import {
  createUser,
  deleteExpiredGuests,
  localDateForTimezone,
  sanitizeTimezone,
} from '@/lib/db/users';
import { createCustomExercise } from '@/lib/exercises/repository';
import { logger } from '@/lib/logger';

const GUEST_TTL_HOURS = 24;
const PURGE_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

let lastPurgeAtMs = 0;

/**
 * Purges guest sandboxes inactive for >24 hours, throttled to at most once per hour per process.
 */
export async function purgeExpiredGuestsIfDue(force = false): Promise<number> {
  const now = Date.now();
  if (!force && now - lastPurgeAtMs < PURGE_INTERVAL_MS) {
    return 0;
  }
  lastPurgeAtMs = now;
  try {
    const purged = await deleteExpiredGuests(GUEST_TTL_HOURS);
    await recordGuestPurgeRun(purged);
    if (purged > 0) {
      logger.info('purged expired guest sandboxes', { purgedCount: purged });
    }
    if (!force && !isPgMemActive()) {
      await ensureDailySnapshotIfDue();
    }
    return purged;
  } catch (err) {
    logger.warn('failed to purge expired guest sandboxes', { err });
    return 0;
  }
}

function addDaysYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

interface SampleTemplateExercise {
  exerciseId: string;
  trackingType: TrackingType;
  targetSets: number;
  targetReps?: number;
  targetRepsMin?: number;
  targetRepsMax?: number;
  targetTimeSeconds?: number;
  targetWeightKg?: number;
  restSeconds: number;
  notes?: string;
}

interface SampleDayTemplate {
  label: string;
  isRestDay: boolean;
  exercises: SampleTemplateExercise[];
}

/**
 * Creates an isolated temporary guest user (`is_guest = 1`) seeded with a
 * fictional 6-day Push/Pull/Legs/Rest/Upper/Lower rotation (including calisthenics
 * and a custom exercise), ~3 weeks of workout history with notes, and body_metrics.
 */
export async function createGuestSandbox(rawTimezone?: string): Promise<UserProfile> {
  await purgeExpiredGuestsIfDue();

  const timezone = sanitizeTimezone(rawTimezone);
  const today = localDateForTimezone(timezone);
  const anchorDate = addDaysYmd(today, -21);
  const nowIso = new Date().toISOString();

  return await withTransaction(async () => {
    const suffix = crypto.randomBytes(4).toString('hex');
    const user = await createUser({
      username: `guest_${suffix}`,
      displayName: 'Sample Athlete',
      passwordHash: '!guest-no-login!',
      heightCm: 177,
      weightKg: 74.5,
      age: 27,
      trainingYears: 2.5,
      unit: 'kg',
      timezone,
      enableSetQuality: false,
      appleFitnessEnabled: true,
      isGuest: true,
    });

    // Fictional custom exercise example for the sandbox
    const customRingPushup = await createCustomExercise(user.id, {
      name: 'Ring Tempo Push-Up',
      trackingType: 'bodyweight_reps',
      equipment: 'bodyweight',
      category: 'push',
      defaultRestSeconds: 90,
      aliases: ['tempo ring push up'],
    });

    // 6-day rotation queue (includes a rest day + calisthenics + weight_reps + time)
    const dayTemplates: SampleDayTemplate[] = [
      {
        label: 'Push',
        isRestDay: false,
        exercises: [
          {
            exerciseId: 'barbell-bench-press',
            trackingType: 'weight_reps',
            targetSets: 3,
            targetRepsMin: 6,
            targetRepsMax: 8,
            targetWeightKg: 80,
            restSeconds: 150,
            notes: 'Controlled 2s touch-and-go',
          },
          {
            exerciseId: 'incline-dumbbell-bench-press',
            trackingType: 'weight_reps',
            targetSets: 3,
            targetRepsMin: 8,
            targetRepsMax: 10,
            targetWeightKg: 28,
            restSeconds: 120,
          },
          {
            exerciseId: 'weighted-dip',
            trackingType: 'weighted_bodyweight',
            targetSets: 3,
            targetRepsMin: 8,
            targetRepsMax: 10,
            targetWeightKg: 10,
            restSeconds: 120,
          },
          {
            exerciseId: 'dumbbell-lateral-raise',
            trackingType: 'weight_reps',
            targetSets: 3,
            targetRepsMin: 12,
            targetRepsMax: 15,
            targetWeightKg: 12,
            restSeconds: 75,
          },
        ],
      },
      {
        label: 'Pull',
        isRestDay: false,
        exercises: [
          {
            exerciseId: 'pull-up',
            trackingType: 'bodyweight_reps',
            targetSets: 3,
            targetRepsMin: 8,
            targetRepsMax: 12,
            restSeconds: 120,
            notes: 'Chest to bar, full dead hang',
          },
          {
            exerciseId: 'barbell-bent-over-row',
            trackingType: 'weight_reps',
            targetSets: 3,
            targetRepsMin: 8,
            targetRepsMax: 10,
            targetWeightKg: 70,
            restSeconds: 120,
          },
          {
            exerciseId: 'cable-face-pull',
            trackingType: 'weight_reps',
            targetSets: 3,
            targetRepsMin: 12,
            targetRepsMax: 15,
            targetWeightKg: 22.5,
            restSeconds: 75,
          },
          {
            exerciseId: 'barbell-bicep-curl',
            trackingType: 'weight_reps',
            targetSets: 3,
            targetRepsMin: 10,
            targetRepsMax: 12,
            targetWeightKg: 30,
            restSeconds: 90,
          },
        ],
      },
      {
        label: 'Legs',
        isRestDay: false,
        exercises: [
          {
            exerciseId: 'barbell-back-squat',
            trackingType: 'weight_reps',
            targetSets: 3,
            targetRepsMin: 5,
            targetRepsMax: 8,
            targetWeightKg: 105,
            restSeconds: 180,
          },
          {
            exerciseId: 'romanian-deadlift',
            trackingType: 'weight_reps',
            targetSets: 3,
            targetRepsMin: 8,
            targetRepsMax: 10,
            targetWeightKg: 95,
            restSeconds: 150,
          },
          {
            exerciseId: 'leg-extension',
            trackingType: 'weight_reps',
            targetSets: 3,
            targetRepsMin: 12,
            targetRepsMax: 15,
            targetWeightKg: 55,
            restSeconds: 90,
          },
          {
            exerciseId: 'l-sit-floor',
            trackingType: 'time',
            targetSets: 3,
            targetTimeSeconds: 25,
            restSeconds: 75,
          },
        ],
      },
      {
        label: 'Rest',
        isRestDay: true,
        exercises: [],
      },
      {
        label: 'Upper',
        isRestDay: false,
        exercises: [
          {
            exerciseId: 'barbell-overhead-press',
            trackingType: 'weight_reps',
            targetSets: 3,
            targetRepsMin: 6,
            targetRepsMax: 8,
            targetWeightKg: 52.5,
            restSeconds: 150,
          },
          {
            exerciseId: 'seated-cable-row',
            trackingType: 'weight_reps',
            targetSets: 3,
            targetRepsMin: 10,
            targetRepsMax: 12,
            targetWeightKg: 60,
            restSeconds: 120,
          },
          {
            exerciseId: customRingPushup.id,
            trackingType: 'bodyweight_reps',
            targetSets: 3,
            targetRepsMin: 10,
            targetRepsMax: 14,
            restSeconds: 90,
            notes: '3-1-1 tempo',
          },
          {
            exerciseId: 'cable-tricep-pushdown-rope',
            trackingType: 'weight_reps',
            targetSets: 3,
            targetRepsMin: 12,
            targetRepsMax: 15,
            targetWeightKg: 25,
            restSeconds: 75,
          },
        ],
      },
      {
        label: 'Lower',
        isRestDay: false,
        exercises: [
          {
            exerciseId: 'leg-press',
            trackingType: 'weight_reps',
            targetSets: 3,
            targetRepsMin: 10,
            targetRepsMax: 12,
            targetWeightKg: 160,
            restSeconds: 150,
          },
          {
            exerciseId: 'lying-leg-curl',
            trackingType: 'weight_reps',
            targetSets: 3,
            targetRepsMin: 10,
            targetRepsMax: 12,
            targetWeightKg: 45,
            restSeconds: 90,
          },
          {
            exerciseId: 'standing-calf-raise-machine',
            trackingType: 'weight_reps',
            targetSets: 3,
            targetRepsMin: 12,
            targetRepsMax: 16,
            targetWeightKg: 70,
            restSeconds: 75,
          },
          {
            exerciseId: 'plank',
            trackingType: 'time',
            targetSets: 3,
            targetTimeSeconds: 60,
            restSeconds: 60,
          },
        ],
      },
    ];

    const scheduleId = `sch_${crypto.randomUUID()}`;
    await query(
      `
      INSERT INTO schedules (
        id, user_id, name, is_active, rotation_anchor_date, rotation_anchor_index,
        created_at, updated_at
      ) VALUES ($1, $2, $3, 1, $4, 0, $5, $6)
    `,
      [
        scheduleId,
        user.id,
        '6-Day Rotation (PPL / Upper-Lower)',
        anchorDate,
        nowIso,
        nowIso,
      ],
    );

    const insertDaySql = `
      INSERT INTO schedule_days (id, schedule_id, position, label, is_rest_day)
      VALUES ($1, $2, $3, $4, $5)
    `;
    const insertDayExSql = `
      INSERT INTO schedule_day_exercises (
        id, schedule_day_id, exercise_id, order_index,
        target_sets, target_reps, target_reps_min, target_reps_max,
        target_time_seconds, target_weight_kg, target_distance_m,
        rest_seconds, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL, $11, $12)
    `;

    const dayIds: string[] = [];
    for (let pos = 0; pos < dayTemplates.length; pos++) {
      const tpl = dayTemplates[pos];
      const dayId = `sday_${crypto.randomUUID()}`;
      dayIds.push(dayId);
      await query(insertDaySql, [dayId, scheduleId, pos, tpl.label, tpl.isRestDay ? 1 : 0]);

      for (let i = 0; i < tpl.exercises.length; i++) {
        const ex = tpl.exercises[i];
        await query(insertDayExSql, [
          `sdex_${crypto.randomUUID()}`,
          dayId,
          ex.exerciseId,
          i,
          ex.targetSets,
          ex.targetReps ?? null,
          ex.targetRepsMin ?? null,
          ex.targetRepsMax ?? null,
          ex.targetTimeSeconds ?? null,
          ex.targetWeightKg ?? null,
          ex.restSeconds,
          ex.notes ?? '',
        ]);
      }
    }

    // Seed ~3 weeks of fictional workout history from anchorDate (today - 21) up to today - 1
    const insertSessionSql = `
      INSERT INTO workout_sessions (
        id, user_id, session_date, schedule_id, schedule_day_id,
        is_jolly, jolly_mode, title, started_at, completed_at,
        duration_minutes, user_weight_kg, notes,
        apple_watch_kcal, apple_watch_avg_hr, apple_watch_max_hr, cid
      ) VALUES ($1, $2, $3, $4, $5, 0, NULL, $6, $7, $8, $9, $10, $11, NULL, NULL, NULL, NULL)
    `;
    const insertWorkoutExSql = `
      INSERT INTO workout_exercises (id, session_id, exercise_id, order_index, notes)
      VALUES ($1, $2, $3, $4, $5)
    `;
    const insertWorkoutSetSql = `
      INSERT INTO workout_sets (
        id, workout_exercise_id, set_number, weight_kg, reps,
        time_seconds, distance_m, rest_seconds, execution_quality_pct,
        is_completed, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8, 1, $9)
    `;

    const sessionNotesByOffset: Record<number, string> = {
      0: 'Solid start to the block, bar speed felt crisp.',
      7: 'Slight fatigue on last accessory set, kept rest strict.',
      16: 'Felt great today — added 2.5 kg on top compounds.',
    };

    let qIdx = 0;
    for (let offset = 0; offset <= 20; offset++) {
      const dateYmd = addDaysYmd(anchorDate, offset);
      const tpl = dayTemplates[qIdx];

      // Leave one past training day (offset 13) missed so the queue carries it to offset 14
      if (offset === 13 && !tpl.isRestDay) {
        continue;
      }

      const dayIdx = qIdx;
      qIdx = (qIdx + 1) % dayTemplates.length;

      if (tpl.isRestDay) continue;

      const weekIndex = Math.floor(offset / 7);
      const sessionId = `ws_${crypto.randomUUID()}`;
      const startedAt = `${dateYmd}T17:30:00.000Z`;
      const completedAt = `${dateYmd}T18:22:00.000Z`;
      const bodyWeight = Number((75.2 - weekIndex * 0.25).toFixed(1));

      await query(insertSessionSql, [
        sessionId,
        user.id,
        dateYmd,
        scheduleId,
        dayIds[dayIdx],
        tpl.label,
        startedAt,
        completedAt,
        52,
        bodyWeight,
        sessionNotesByOffset[offset] ?? '',
      ]);

      for (let i = 0; i < tpl.exercises.length; i++) {
        const ex = tpl.exercises[i];
        const weId = `we_${crypto.randomUUID()}`;
        const exNote =
          offset === 16 && i === 0
            ? 'Paused first rep cleanly'
            : offset === 7 && i === 0
              ? 'Warmup felt tight, took an extra minute'
              : '';
        await query(insertWorkoutExSql, [weId, sessionId, ex.exerciseId, i, exNote]);

        for (let setNum = 1; setNum <= ex.targetSets; setNum++) {
          const progWeight =
            ex.targetWeightKg !== undefined
              ? Number((ex.targetWeightKg + weekIndex * 2.5 - 2.5).toFixed(1))
              : null;
          const baseReps =
            ex.targetReps ?? ex.targetRepsMax ?? ex.targetRepsMin ?? null;
          const reps =
            baseReps !== null
              ? Math.max(1, baseReps - (setNum === ex.targetSets ? 1 : 0))
              : null;
          const timeSeconds =
            ex.targetTimeSeconds !== undefined
              ? ex.targetTimeSeconds + weekIndex * 3
              : null;
          const qualityPct =
            offset === 16 && i === 0 && setNum === ex.targetSets ? 85 : null;

          await query(insertWorkoutSetSql, [
            `wset_${crypto.randomUUID()}`,
            weId,
            setNum,
            progWeight,
            reps,
            timeSeconds,
            ex.restSeconds,
            qualityPct,
            completedAt,
          ]);
        }
      }
    }

    // Seed a few body_metrics entries over the 3 weeks
    const metricPoints: Array<{ offset: number; weightKg: number }> = [
      { offset: -21, weightKg: 75.2 },
      { offset: -14, weightKg: 74.9 },
      { offset: -7, weightKg: 74.7 },
      { offset: 0, weightKg: 74.5 },
    ];
    for (const pt of metricPoints) {
      await recordBodyMetric({
        userId: user.id,
        measuredOn: addDaysYmd(today, pt.offset),
        weightKg: pt.weightKg,
        source: 'sample',
      });
    }

    const syncedWeightKg = await syncUserProfileWeightFromBodyMetrics(user.id);
    return { ...user, weightKg: syncedWeightKg };
  });
}
