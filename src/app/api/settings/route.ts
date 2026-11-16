import { NextRequest, NextResponse } from 'next/server';
import { ApiError, parseJsonBody, withApiHandler } from '@/lib/api/handler';
import { requireAuth } from '@/lib/auth/session';
import { recordBodyMetric } from '@/lib/db/bodyMetrics';
import { withTransaction } from '@/lib/db/connection';
import { getApiKeyByUserId } from '@/lib/db/sessions';
import {
  isValidTimezone,
  localDateForTimezone,
  updateUserSettings,
  type UpdateUserSettingsInput,
} from '@/lib/db/users';
import { isValidAppTheme, isValidThemeVariant } from '@/lib/theme';

interface SettingsPatchBody {
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

export const GET = withApiHandler('settings.get', async (req: NextRequest, ctx) => {
  const { user } = await requireAuth(req, ctx);
  const apiKey = await getApiKeyByUserId(user.id);
  return NextResponse.json({ user, apiKey });
});

export const PATCH = withApiHandler(
  'settings.patch',
  async (req: NextRequest, ctx) => {
    const { user } = await requireAuth(req, ctx);
    const body = await parseJsonBody<SettingsPatchBody>(req);
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
      if (typeof body.timezone !== 'string' || !isValidTimezone(body.timezone.trim())) {
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

    if (body.appleFitnessEnabled !== undefined) {
      if (typeof body.appleFitnessEnabled !== 'boolean') {
        throw ApiError.validation('appleFitnessEnabled must be a boolean');
      }
      patch.appleFitnessEnabled = body.appleFitnessEnabled;
    }

    const updated = await withTransaction(async () => {
      const nextUser = await updateUserSettings(user.id, patch);
      if (!nextUser) {
        throw ApiError.notFound('User not found');
      }
      if (patch.weightKg !== undefined) {
        await recordBodyMetric({
          userId: user.id,
          measuredOn: localDateForTimezone(nextUser.timezone),
          weightKg: patch.weightKg,
          source: 'settings',
        });
      }
      return nextUser;
    });

    const apiKey = await getApiKeyByUserId(user.id);
    return NextResponse.json({ user: updated, apiKey });
  },
);
