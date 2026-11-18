import crypto from 'node:crypto';
import type { Exercise, RotationSchedule, UserProfile } from '@/types/domain';
import {
  recordBodyMetric,
  syncUserProfileWeightFromBodyMetrics,
} from '@/lib/db/bodyMetrics';
import { query, withTransaction } from '@/lib/db/connection';
import {
  getUserById,
  localDateForTimezone,
  updateUserSettings,
} from '@/lib/db/users';
import { getActiveSchedule } from '@/lib/db/workouts';
import {
  createCustomExercise,
  listExercises,
} from '@/lib/exercises/repository';
import {
  buildEditPlanPrompt,
  buildImportPreview,
  matchExerciseName,
  validateAiImportPayload,
  type AiImportPreview,
  type AiValidationError,
  type MatchableExercise,
} from './importSchema';

export interface AiPromptContextResponse {
  user: UserProfile;
  schedule: RotationSchedule | null;
  editPrompt: string;
}

export interface AiValidateResult {
  valid: boolean;
  errors: AiValidationError[];
  preview: AiImportPreview | null;
}

export interface AiConfirmResult extends AiValidateResult {
  createdCustomExercises?: Exercise[];
  schedule?: RotationSchedule | null;
  user?: UserProfile | null;
}

async function toMatchableExercises(userId: string): Promise<MatchableExercise[]> {
  const exercises = await listExercises(userId, { includeHidden: true });
  return exercises.map((ex) => ({
    id: ex.id,
    name: ex.name,
    trackingType: ex.trackingType,
    isCustom: ex.isCustom,
    aliases: ex.aliases,
  }));
}

export async function getAiPromptContext(
  user: UserProfile,
): Promise<AiPromptContextResponse> {
  const schedule = await getActiveSchedule(user.id);
  const editPrompt = buildEditPlanPrompt({
    profile: {
      heightCm: user.heightCm,
      weightKg: user.weightKg,
      age: user.age,
      trainingYears: user.trainingYears,
      unit: user.unit,
    },
    schedule: schedule
      ? {
          name: schedule.name,
          days: schedule.days.map((d) => ({
            label: d.label,
            isRestDay: d.isRestDay,
            exercises: d.exercises.map((ex) => ({
              name: ex.exerciseName ?? ex.exerciseId,
              trackingType: ex.trackingType ?? 'weight_reps',
              targetSets: ex.targetSets,
              ...(ex.targetWarmupSets > 0
                ? { targetWarmupSets: ex.targetWarmupSets }
                : {}),
              ...(ex.targetReps !== null ? { targetReps: ex.targetReps } : {}),
              ...(ex.targetRepsMin !== null
                ? { targetRepsMin: ex.targetRepsMin }
                : {}),
              ...(ex.targetRepsMax !== null
                ? { targetRepsMax: ex.targetRepsMax }
                : {}),
              ...(ex.targetTimeSeconds !== null
                ? { targetTimeSeconds: ex.targetTimeSeconds }
                : {}),
              ...(ex.targetWeightKg !== null
                ? { targetWeightKg: ex.targetWeightKg }
                : {}),
              ...(ex.targetDistanceM !== null
                ? { targetDistanceM: ex.targetDistanceM }
                : {}),
              restSeconds: ex.restSeconds,
              ...(ex.notes ? { notes: ex.notes } : {}),
            })),
          })),
        }
      : null,
  });

  return { user, schedule, editPrompt };
}

export async function validateImportForUser(
  user: UserProfile,
  rawText: string,
): Promise<AiValidateResult> {
  const validation = validateAiImportPayload(rawText);
  if (!validation.valid || !validation.payload) {
    return {
      valid: false,
      errors: validation.errors,
      preview: null,
    };
  }

  const catalog = await toMatchableExercises(user.id);
  const preview = buildImportPreview(validation.payload, catalog);
  return {
    valid: true,
    errors: [],
    preview,
  };
}

export async function applyAiImport(
  user: UserProfile,
  rawText: string,
): Promise<AiConfirmResult> {
  const validation = validateAiImportPayload(rawText);
  if (!validation.valid || !validation.payload) {
    return {
      valid: false,
      errors: validation.errors,
      preview: null,
    };
  }

  const payload = validation.payload;
  const today = localDateForTimezone(user.timezone);

  return await withTransaction(async () => {
    const existing = await toMatchableExercises(user.id);
    const preview = buildImportPreview(payload, existing);

    // 1. Update user profile & record body weight metric
    await updateUserSettings(user.id, {
      heightCm: payload.profile.heightCm,
      age: payload.profile.age,
      trainingYears: payload.profile.trainingYears,
      unit: payload.profile.unit,
    });

    await recordBodyMetric({
      userId: user.id,
      measuredOn: today,
      weightKg: payload.profile.weightKg,
      source: 'ai_import',
    });

    await syncUserProfileWeightFromBodyMetrics(user.id);

    // 2. Auto-create unknown exercises as custom exercises (deduped case-insensitively)
    const createdCustomExercises: Exercise[] = [];
    const customIdByLowerName = new Map<string, string>();

    for (const item of preview.newCustomExercises) {
      const created = await createCustomExercise(user.id, {
        name: item.name,
        trackingType: item.trackingType,
      });
      createdCustomExercises.push(created);
      customIdByLowerName.set(item.name.trim().toLowerCase(), created.id);
    }

    // 3. Deactivate any existing active schedules and create new one anchored today
    const now = new Date().toISOString();
    await query(
      'UPDATE schedules SET is_active = 0, updated_at = $1 WHERE user_id = $2 AND is_active = 1',
      [now, user.id],
    );

    const scheduleId = `sched_${crypto.randomUUID()}`;
    await query(
      `
      INSERT INTO schedules (
        id, user_id, name, is_active, rotation_anchor_date, rotation_anchor_index,
        created_at, updated_at
      ) VALUES ($1, $2, $3, 1, $4, 0, $5, $6)
    `,
      [scheduleId, user.id, payload.schedule.name, today, now, now],
    );

    const insertDaySql = `
      INSERT INTO schedule_days (id, schedule_id, position, label, is_rest_day)
      VALUES ($1, $2, $3, $4, $5)
    `;

    const insertDayExSql = `
      INSERT INTO schedule_day_exercises (
        id, schedule_day_id, exercise_id, order_index,
        target_sets, target_warmup_sets, target_reps, target_reps_min, target_reps_max,
        target_time_seconds, target_weight_kg, target_distance_m,
        rest_seconds, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    `;

    for (let position = 0; position < payload.schedule.days.length; position += 1) {
      const day = payload.schedule.days[position];
      const dayId = `sday_${crypto.randomUUID()}`;
      await query(insertDaySql, [dayId, scheduleId, position, day.label, day.isRestDay ? 1 : 0]);

      for (let orderIndex = 0; orderIndex < day.exercises.length; orderIndex += 1) {
        const ex = day.exercises[orderIndex];
        const matched = matchExerciseName(ex.name, existing);
        const exerciseId =
          matched?.id ?? customIdByLowerName.get(ex.name.trim().toLowerCase());
        if (!exerciseId) {
          throw new Error(`Failed to resolve exercise "${ex.name}"`);
        }

        await query(insertDayExSql, [
          `sdex_${crypto.randomUUID()}`,
          dayId,
          exerciseId,
          orderIndex,
          ex.targetSets,
          ex.targetWarmupSets,
          ex.targetReps,
          ex.targetRepsMin,
          ex.targetRepsMax,
          ex.targetTimeSeconds,
          ex.targetWeightKg,
          ex.targetDistanceM,
          ex.restSeconds,
          ex.notes,
        ]);
      }
    }

    return {
      valid: true,
      errors: [],
      preview,
      createdCustomExercises,
      schedule: await getActiveSchedule(user.id),
      user: await getUserById(user.id),
    };
  });
}
