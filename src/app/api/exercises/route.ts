import { NextRequest, NextResponse } from 'next/server';
import { ApiError, parseJsonBody, withApiHandler } from '@/lib/api/handler';
import { requireAuth } from '@/lib/auth/session';
import {
  createCustomExercise,
  listExercises,
} from '@/lib/exercises/repository';
import type { TrackingType } from '@/types/domain';
import { isValidTrackingType } from './_validation';

interface CreateExerciseBody {
  name?: unknown;
  trackingType?: unknown;
  equipment?: unknown;
  category?: unknown;
  defaultRestSeconds?: unknown;
}

export const GET = withApiHandler('exercises.list', async (req: NextRequest, ctx) => {
  const { user } = requireAuth(req, ctx);
  const { searchParams } = req.nextUrl;

  const query = searchParams.get('q') ?? undefined;
  const category = searchParams.get('category')?.trim() || undefined;
  const trackingTypeParam = searchParams.get('trackingType')?.trim() || undefined;
  const includeHidden = searchParams.get('includeHidden') === '1';

  let trackingType: TrackingType | undefined;
  if (trackingTypeParam) {
    if (!isValidTrackingType(trackingTypeParam)) {
      throw ApiError.validation(`Invalid trackingType "${trackingTypeParam}"`);
    }
    trackingType = trackingTypeParam;
  }

  const exercises = listExercises(user.id, {
    query,
    category,
    trackingType,
    includeHidden,
  });

  return NextResponse.json({ exercises });
});

export const POST = withApiHandler('exercises.create', async (req: NextRequest, ctx) => {
  const { user } = requireAuth(req, ctx);
  const body = await parseJsonBody<CreateExerciseBody>(req);

  if (typeof body.name !== 'string' || !body.name.trim()) {
    throw ApiError.validation('Exercise name is required');
  }
  const name = body.name.trim();
  if (name.length > 100) {
    throw ApiError.validation('Exercise name must be at most 100 characters');
  }

  if (!isValidTrackingType(body.trackingType)) {
    throw ApiError.validation('Invalid trackingType');
  }

  let equipment = 'other';
  if (body.equipment !== undefined) {
    if (typeof body.equipment !== 'string' || !body.equipment.trim()) {
      throw ApiError.validation('equipment must be a non-empty string');
    }
    equipment = body.equipment.trim().slice(0, 40);
  }

  let category = 'other';
  if (body.category !== undefined) {
    if (typeof body.category !== 'string' || !body.category.trim()) {
      throw ApiError.validation('category must be a non-empty string');
    }
    category = body.category.trim().slice(0, 40);
  }

  let defaultRestSeconds = 120;
  if (body.defaultRestSeconds !== undefined) {
    if (
      typeof body.defaultRestSeconds !== 'number' ||
      !Number.isInteger(body.defaultRestSeconds) ||
      body.defaultRestSeconds < 0 ||
      body.defaultRestSeconds > 600
    ) {
      throw ApiError.validation('defaultRestSeconds must be an integer between 0 and 600');
    }
    defaultRestSeconds = body.defaultRestSeconds;
  }

  const exercise = createCustomExercise(user.id, {
    name,
    trackingType: body.trackingType,
    equipment,
    category,
    defaultRestSeconds,
  });

  ctx.log.info('Created custom exercise', { exerciseId: exercise.id });
  return NextResponse.json({ exercise }, { status: 201 });
});
