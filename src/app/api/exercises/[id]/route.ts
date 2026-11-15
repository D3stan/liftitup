import { NextRequest, NextResponse } from 'next/server';
import { ApiError, parseJsonBody, withApiHandler } from '@/lib/api/handler';
import { requireAuth } from '@/lib/auth/session';
import {
  deleteCustomExercise,
  getExerciseById,
  setExerciseHidden,
  updateCustomExercise,
  type UpdateCustomExerciseInput,
} from '@/lib/exercises/repository';
import { isValidTrackingType } from '../_validation';

interface ExerciseParams {
  id: string;
}

interface PatchExerciseBody {
  name?: unknown;
  trackingType?: unknown;
  equipment?: unknown;
  category?: unknown;
  defaultRestSeconds?: unknown;
  hidden?: unknown;
}

export const GET = withApiHandler<ExerciseParams>(
  'exercises.get',
  async (req: NextRequest, ctx) => {
    const { user } = requireAuth(req, ctx);
    const exercise = getExerciseById(user.id, ctx.params.id);
    if (!exercise) {
      throw ApiError.notFound('Exercise not found');
    }
    return NextResponse.json({ exercise });
  },
);

export const PATCH = withApiHandler<ExerciseParams>(
  'exercises.patch',
  async (req: NextRequest, ctx) => {
    const { user } = requireAuth(req, ctx);
    const exerciseId = ctx.params.id;
    const existing = getExerciseById(user.id, exerciseId);
    if (!existing) {
      throw ApiError.notFound('Exercise not found');
    }

    const body = await parseJsonBody<PatchExerciseBody>(req);

    if (body.hidden !== undefined) {
      if (typeof body.hidden !== 'boolean') {
        throw ApiError.validation('hidden must be a boolean');
      }
      setExerciseHidden(user.id, exerciseId, body.hidden);
    }

    const hasCustomEdits =
      body.name !== undefined ||
      body.trackingType !== undefined ||
      body.equipment !== undefined ||
      body.category !== undefined ||
      body.defaultRestSeconds !== undefined;

    if (hasCustomEdits) {
      if (!existing.isCustom || existing.userId !== user.id) {
        throw ApiError.forbidden('Only custom exercises can be edited');
      }

      const patch: UpdateCustomExerciseInput = {};

      if (body.name !== undefined) {
        if (typeof body.name !== 'string' || !body.name.trim()) {
          throw ApiError.validation('Exercise name must be a non-empty string');
        }
        const trimmed = body.name.trim();
        if (trimmed.length > 100) {
          throw ApiError.validation('Exercise name must be at most 100 characters');
        }
        patch.name = trimmed;
      }

      if (body.trackingType !== undefined) {
        if (!isValidTrackingType(body.trackingType)) {
          throw ApiError.validation('Invalid trackingType');
        }
        patch.trackingType = body.trackingType;
      }

      if (body.equipment !== undefined) {
        if (typeof body.equipment !== 'string' || !body.equipment.trim()) {
          throw ApiError.validation('equipment must be a non-empty string');
        }
        patch.equipment = body.equipment.trim().slice(0, 40);
      }

      if (body.category !== undefined) {
        if (typeof body.category !== 'string' || !body.category.trim()) {
          throw ApiError.validation('category must be a non-empty string');
        }
        patch.category = body.category.trim().slice(0, 40);
      }

      if (body.defaultRestSeconds !== undefined) {
        if (
          typeof body.defaultRestSeconds !== 'number' ||
          !Number.isInteger(body.defaultRestSeconds) ||
          body.defaultRestSeconds < 0 ||
          body.defaultRestSeconds > 600
        ) {
          throw ApiError.validation(
            'defaultRestSeconds must be an integer between 0 and 600',
          );
        }
        patch.defaultRestSeconds = body.defaultRestSeconds;
      }

      updateCustomExercise(user.id, exerciseId, patch);
    }

    const updated = getExerciseById(user.id, exerciseId);
    return NextResponse.json({ exercise: updated });
  },
);

export const DELETE = withApiHandler<ExerciseParams>(
  'exercises.delete',
  async (req: NextRequest, ctx) => {
    const { user } = requireAuth(req, ctx);
    const result = deleteCustomExercise(user.id, ctx.params.id);

    if (!result.deleted) {
      if (result.reason === 'not_found') {
        throw ApiError.notFound('Exercise not found');
      }
      if (result.reason === 'not_custom') {
        throw ApiError.forbidden(
          'Built-in exercises cannot be deleted; hide it instead',
        );
      }
      if (result.reason === 'referenced') {
        throw ApiError.conflict(
          'Exercise is used in logged workouts or split. Hide it instead.',
          { reason: 'referenced' },
        );
      }
    }

    ctx.log.info('Deleted custom exercise', { exerciseId: ctx.params.id });
    return NextResponse.json({ ok: true });
  },
);
