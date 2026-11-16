import type { UserProfile } from '@/types/domain';
import { ApiError } from '@/lib/api/handler';
import { safeRecordEvent } from '@/lib/admin/events';
import {
  syncUserProfileWeightFromBodyMetrics,
  upsertManualBodyMetricInTx,
} from '@/lib/db/bodyMetrics';
import { withTransaction } from '@/lib/db/connection';
import {
  isValidRestClockMode,
  isValidTimezone,
  isValidWorkoutViewMode,
  localDateForTimezone,
  updateUserSettings,
  type UpdateUserSettingsInput,
} from '@/lib/db/users';
import { isValidAppTheme, isValidThemeVariant } from '@/lib/theme';

export interface SettingsPatchBody {
  displayName?: unknown;
  heightCm?: unknown;
  weightKg?: unknown;
  age?: unknown;
  trainingYears?: unknown;
  unit?: unknown;
  timezone?: unknown;
  theme?: unknown;
  themeVariant?: unknown;
  enableSetQuality?: unknown;
  restClockMode?: unknown;
  defaultWorkoutView?: unknown;
  defaultWeightStepKg?: unknown;
  appleFitnessEnabled?: unknown;
}

function parseNullableNumber(
  val: unknown,
  field: string,
  min: number,
  max: number,
  integerOnly = false,
): number | null {
  if (val === null) return null;
  if (typeof val !== 'number' || !Number.isFinite(val)) {
    throw ApiError.validation(`${field} must be a finite number or null`);
  }
  if (integerOnly && !Number.isInteger(val)) {
    throw ApiError.validation(`${field} must be an integer`);
  }
  if (val < min || val > max) {
    throw ApiError.validation(`${field} must be between ${min} and ${max}`);
  }
  return val;
}

/**
 * Validates a settings PATCH payload using LiftItUp's canonical rules.
 * Shared by `PATCH /api/settings` and MCP `update_settings`.
 */
export function validateSettingsPatch(
  body: SettingsPatchBody,
): UpdateUserSettingsInput {
  const patch: UpdateUserSettingsInput = {};

  if (body.displayName !== undefined) {
    if (typeof body.displayName !== 'string' || !body.displayName.trim()) {
      throw ApiError.validation('displayName must be a non-empty string');
    }
    if (body.displayName.trim().length > 60) {
      throw ApiError.validation('displayName must be at most 60 characters');
    }
    patch.displayName = body.displayName.trim();
  }

  if (body.heightCm !== undefined) {
    patch.heightCm = parseNullableNumber(body.heightCm, 'heightCm', 100, 250);
  }

  if (body.weightKg !== undefined) {
    if (typeof body.weightKg !== 'number' || !Number.isFinite(body.weightKg)) {
      throw ApiError.validation('weightKg must be a finite number');
    }
    if (body.weightKg < 25 || body.weightKg > 300) {
      throw ApiError.validation('weightKg must be between 25 and 300');
    }
    patch.weightKg = body.weightKg;
  }

  if (body.age !== undefined) {
    patch.age = parseNullableNumber(body.age, 'age', 12, 100, true);
  }

  if (body.trainingYears !== undefined) {
    patch.trainingYears = parseNullableNumber(
      body.trainingYears,
      'trainingYears',
      0,
      80,
    );
  }

  if (body.unit !== undefined) {
    if (body.unit !== 'kg' && body.unit !== 'lb') {
      throw ApiError.validation('unit must be "kg" or "lb"');
    }
    patch.unit = body.unit;
  }

  if (body.timezone !== undefined) {
    if (
      typeof body.timezone !== 'string' ||
      !isValidTimezone(body.timezone.trim())
    ) {
      throw ApiError.validation('timezone must be a valid IANA timezone');
    }
    patch.timezone = body.timezone.trim();
  }

  if (body.theme !== undefined) {
    if (!isValidAppTheme(body.theme)) {
      throw ApiError.validation(
        'theme must be "notebook", "cutecore", "analog-horror", "brazilian-phonk", "future-funk", or "lofi-art"',
      );
    }
    patch.theme = body.theme;
  }

  if (body.themeVariant !== undefined) {
    if (!isValidThemeVariant(body.themeVariant)) {
      throw ApiError.validation('themeVariant must be "light" or "dark"');
    }
    patch.themeVariant = body.themeVariant;
  }

  if (body.enableSetQuality !== undefined) {
    if (typeof body.enableSetQuality !== 'boolean') {
      throw ApiError.validation('enableSetQuality must be a boolean');
    }
    patch.enableSetQuality = body.enableSetQuality;
  }

  if (body.restClockMode !== undefined) {
    if (!isValidRestClockMode(body.restClockMode)) {
      throw ApiError.validation(
        'restClockMode must be "stopwatch" or "countdown"',
      );
    }
    patch.restClockMode = body.restClockMode;
  }

  if (body.defaultWorkoutView !== undefined) {
    if (!isValidWorkoutViewMode(body.defaultWorkoutView)) {
      throw ApiError.validation('defaultWorkoutView must be "list" or "focus"');
    }
    patch.defaultWorkoutView = body.defaultWorkoutView;
  }

  if (body.defaultWeightStepKg !== undefined) {
    if (body.defaultWeightStepKg === null) {
      patch.defaultWeightStepKg = null;
    } else if (
      typeof body.defaultWeightStepKg !== 'number' ||
      !Number.isFinite(body.defaultWeightStepKg) ||
      body.defaultWeightStepKg <= 0 ||
      body.defaultWeightStepKg > 100
    ) {
      throw ApiError.validation(
        'defaultWeightStepKg must be a positive number up to 100, or null',
      );
    } else {
      patch.defaultWeightStepKg = body.defaultWeightStepKg;
    }
  }

  if (body.appleFitnessEnabled !== undefined) {
    if (typeof body.appleFitnessEnabled !== 'boolean') {
      throw ApiError.validation('appleFitnessEnabled must be a boolean');
    }
    patch.appleFitnessEnabled = body.appleFitnessEnabled;
  }

  return patch;
}

/**
 * Validates and transactionally applies user settings updates, syncing
 * body_metrics + profile weight when `weightKg` changes and recording telemetry events.
 */
export async function applyUserSettingsPatch(
  user: UserProfile,
  body: SettingsPatchBody,
): Promise<UserProfile> {
  const patch = validateSettingsPatch(body);

  const updated = await withTransaction(async () => {
    const nextUser = await updateUserSettings(user.id, patch);
    if (!nextUser) {
      throw ApiError.notFound('User not found');
    }
    if (patch.weightKg !== undefined) {
      await upsertManualBodyMetricInTx({
        userId: user.id,
        measuredOn: localDateForTimezone(nextUser.timezone),
        weightKg: patch.weightKg,
        source: 'settings',
      });
      const syncedWeightKg = await syncUserProfileWeightFromBodyMetrics(
        user.id,
      );
      return { ...nextUser, weightKg: syncedWeightKg };
    }
    return nextUser;
  });

  if (patch.theme !== undefined || patch.themeVariant !== undefined) {
    await safeRecordEvent({
      userId: user.id,
      eventType: 'theme_changed',
      detail: { theme: updated.theme, themeVariant: updated.themeVariant },
    });
  }
  if (patch.restClockMode !== undefined) {
    await safeRecordEvent({
      userId: user.id,
      eventType: 'rest_clock_mode_changed',
      detail: { restClockMode: updated.restClockMode },
    });
  }
  if (patch.defaultWorkoutView !== undefined) {
    await safeRecordEvent({
      userId: user.id,
      eventType: 'workout_view_mode_changed',
      detail: { defaultWorkoutView: updated.defaultWorkoutView },
    });
  }

  return updated;
}
