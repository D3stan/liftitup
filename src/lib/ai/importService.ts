import crypto from 'node:crypto';
import type { Exercise, RotationSchedule, UserProfile } from '@/types/domain';
import { recordBodyMetric } from '@/lib/db/bodyMetrics';
import { withTransaction } from '@/lib/db/connection';
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

function toMatchableExercises(userId: string): MatchableExercise[] {
  return listExercises(userId, { includeHidden: true }).map((ex) => ({
    id: ex.id,
    name: ex.name,
    trackingType: ex.trackingType,
    isCustom: ex.isCustom,
    aliases: ex.aliases,
  }));
}

export function getAiPromptContext(user: UserProfile): AiPromptContextResponse {
  const schedule = getActiveSchedule(user.id);
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

export function validateImportForUser(
  user: UserProfile,
  rawText: string,
): AiValidateResult {
  const validation = validateAiImportPayload(rawText);
  if (!validation.valid || !validation.payload) {
    return {
      valid: false,
      errors: validation.errors,
      preview: null,
    };
  }

  const catalog = toMatchableExercises(user.id);
  const preview = buildImportPreview(validation.payload, catalog);
  return {
    valid: true,
    errors: [],
    preview,
  };
}

export function applyAiImport(
  user: UserProfile,
  rawText: string,
): AiConfirmResult {
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

  return withTransaction((db) => {
    const existing = toMatchableExercises(user.id);
    const preview = buildImportPreview(payload, existing);

    // 1. Update user profile & record body weight metric
    updateUserSettings(user.id, {
      heightCm: payload.profile.heightCm,
      weightKg: payload.profile.weightKg,
      age: payload.profile.age,
      trainingYears: payload.profile.trainingYears,
      unit: payload.profile.unit,
    });

    recordBodyMetric({
      userId: user.id,
      measuredOn: today,
      weightKg: payload.profile.weightKg,
      source: 'ai_import',
    });

    // 2. Auto-create unknown exercises as custom exercises (deduped case-insensitively)
    const createdCustomExercises: Exercise[] = [];
    const customIdByLowerName = new Map<string, string>();

    for (const item of preview.newCustomExercises) {
      const created = createCustomExercise(user.id, {
        name: item.name,
        trackingType: item.trackingType,
      });
      createdCustomExercises.push(created);
      customIdByLowerName.set(item.name.trim().toLowerCase(), created.id);
    }

    // 3. Deactivate any existing active schedules and create new one anchored today
    const now = new Date().toISOString();
    db.prepare(
      'UPDATE schedules SET is_active = 0, updated_at = ? WHERE user_id = ? AND is_active = 1',
    ).run(now, user.id);

    const scheduleId = `sched_${crypto.randomUUID()}`;
    db.prepare(`
      INSERT INTO schedules (
        id, user_id, name, is_active, rotation_anchor_date, rotation_anchor_index,
        created_at, updated_at
      ) VALUES (?, ?, ?, 1, ?, 0, ?, ?)
    `).run(scheduleId, user.id, payload.schedule.name, today, now, now);

    const insertDay = db.prepare(`
      INSERT INTO schedule_days (id, schedule_id, position, label, is_rest_day)
      VALUES (?, ?, ?, ?, ?)
    `);

    const insertDayEx = db.prepare(`
      INSERT INTO schedule_day_exercises (
        id, schedule_day_id, exercise_id, order_index,
        target_sets, target_reps, target_reps_min, target_reps_max,
        target_time_seconds, target_weight_kg, target_distance_m,
        rest_seconds, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    payload.schedule.days.forEach((day, position) => {
      const dayId = `sday_${crypto.randomUUID()}`;
      insertDay.run(dayId, scheduleId, position, day.label, day.isRestDay ? 1 : 0);

      day.exercises.forEach((ex, orderIndex) => {
        const matched = matchExerciseName(ex.name, existing);
        const exerciseId =
          matched?.id ?? customIdByLowerName.get(ex.name.trim().toLowerCase());
        if (!exerciseId) {
          throw new Error(`Failed to resolve exercise "${ex.name}"`);
        }

        insertDayEx.run(
          `sdex_${crypto.randomUUID()}`,
          dayId,
          exerciseId,
          orderIndex,
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

    return {
      valid: true,
      errors: [],
      preview,
      createdCustomExercises,
      schedule: getActiveSchedule(user.id),
      user: getUserById(user.id),
    };
  });
}
