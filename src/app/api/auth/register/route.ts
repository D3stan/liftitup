import { NextRequest, NextResponse } from 'next/server';
import { ApiError, parseJsonBody, withApiHandler } from '@/lib/api/handler';
import { hashPassword } from '@/lib/auth/password';
import { createSessionCookieForUser } from '@/lib/auth/session';
import { withTransaction } from '@/lib/db/connection';
import { recordBodyMetric } from '@/lib/db/bodyMetrics';
import {
  createUser,
  getUserByUsername,
  localDateForTimezone,
  sanitizeTimezone,
} from '@/lib/db/users';
import type { WeightUnit } from '@/types/domain';

interface RegisterBody {
  username?: unknown;
  password?: unknown;
  displayName?: unknown;
  timezone?: unknown;
  unit?: unknown;
  heightCm?: unknown;
  weightKg?: unknown;
  age?: unknown;
  trainingYears?: unknown;
}

function optionalBoundedNumber(
  val: unknown,
  field: string,
  min: number,
  max: number,
): number | undefined {
  if (val === undefined || val === null) return undefined;
  if (typeof val !== 'number' || !Number.isFinite(val)) {
    throw ApiError.validation(`${field} must be a finite number`);
  }
  if (val < min || val > max) {
    throw ApiError.validation(`${field} must be between ${min} and ${max}`);
  }
  return val;
}

export const POST = withApiHandler(
  'auth.register',
  async (req: NextRequest, ctx) => {
    const body = await parseJsonBody<RegisterBody>(req);

    if (typeof body.username !== 'string') {
      throw ApiError.validation('username is required');
    }
    const username = body.username.trim().toLowerCase();
    if (username.length < 3 || username.length > 32) {
      throw ApiError.validation('username must be between 3 and 32 characters');
    }
    if (!/^[a-z0-9_.-]+$/.test(username)) {
      throw ApiError.validation(
        'username may only contain letters, numbers, "_", ".", and "-"',
      );
    }

    if (typeof body.password !== 'string') {
      throw ApiError.validation('password is required');
    }
    if (body.password.length < 8 || body.password.length > 128) {
      throw ApiError.validation('password must be between 8 and 128 characters');
    }

    let displayName = username;
    if (body.displayName !== undefined) {
      if (typeof body.displayName !== 'string') {
        throw ApiError.validation('displayName must be a string');
      }
      const trimmed = body.displayName.trim();
      if (trimmed.length > 60) {
        throw ApiError.validation('displayName must be at most 60 characters');
      }
      if (trimmed.length > 0) displayName = trimmed;
    }

    const unit: WeightUnit = body.unit === 'lb' ? 'lb' : 'kg';
    const timezone = sanitizeTimezone(
      typeof body.timezone === 'string' ? body.timezone : undefined,
    );
    const heightCm = optionalBoundedNumber(body.heightCm, 'heightCm', 100, 250);
    const weightKg = optionalBoundedNumber(body.weightKg, 'weightKg', 25, 300);
    const age = optionalBoundedNumber(body.age, 'age', 12, 100);
    const trainingYears = optionalBoundedNumber(
      body.trainingYears,
      'trainingYears',
      0,
      80,
    );

    const passwordHash = await hashPassword(body.password);

    const user = await withTransaction(async () => {
      if (await getUserByUsername(username)) {
        throw ApiError.conflict('Username is already taken');
      }

      const created = await createUser({
        username,
        displayName,
        passwordHash,
        heightCm: heightCm ?? null,
        weightKg: weightKg ?? 75,
        age: age === undefined ? null : Math.round(age),
        trainingYears: trainingYears ?? null,
        unit,
        timezone,
        isGuest: false,
      });

      if (weightKg !== undefined) {
        await recordBodyMetric({
          userId: created.id,
          measuredOn: localDateForTimezone(created.timezone),
          weightKg,
          source: 'settings',
        });
      }

      return created;
    });

    ctx.setUserId(user.id);
    const res = NextResponse.json({ user }, { status: 201 });
    return await createSessionCookieForUser(res, user.id);
  },
);
