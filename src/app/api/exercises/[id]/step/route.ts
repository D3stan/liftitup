import { NextRequest, NextResponse } from 'next/server';
import { ApiError, parseJsonBody, withApiHandler } from '@/lib/api/handler';
import { requireAuth } from '@/lib/auth/session';
import { setExerciseWeightStepForUser } from '@/lib/exercises/repository';
import { parseNullableWeightStepKg } from '../../_validation';

interface StepParams {
  id: string;
}

interface PutStepBody {
  weightStepKg?: unknown;
}

export const PUT = withApiHandler<StepParams>(
  'exercises.step.put',
  async (req: NextRequest, ctx) => {
    const { user } = await requireAuth(req, ctx);
    const body = await parseJsonBody<PutStepBody>(req);
    if (body.weightStepKg === undefined) {
      throw ApiError.validation('weightStepKg is required (number or null)');
    }
    const weightStepKg = parseNullableWeightStepKg(body.weightStepKg);
    const updated = await setExerciseWeightStepForUser(
      user.id,
      ctx.params.id,
      weightStepKg,
    );
    if (!updated) {
      throw ApiError.notFound('Exercise not found');
    }
    return NextResponse.json({ exercise: updated });
  },
);

export const DELETE = withApiHandler<StepParams>(
  'exercises.step.delete',
  async (req: NextRequest, ctx) => {
    const { user } = await requireAuth(req, ctx);
    const updated = await setExerciseWeightStepForUser(
      user.id,
      ctx.params.id,
      null,
    );
    if (!updated) {
      throw ApiError.notFound('Exercise not found');
    }
    return NextResponse.json({ exercise: updated });
  },
);
