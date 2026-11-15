import { NextRequest, NextResponse } from 'next/server';
import { parseJsonBody, withApiHandler } from '@/lib/api/handler';
import { requireAuth } from '@/lib/auth/session';
import { applyExerciseSwap } from '@/lib/workouts/queries';
import type { SwapExerciseInput } from '@/lib/workouts/types';

export const POST = withApiHandler(
  'workouts.swap',
  async (req: NextRequest, ctx) => {
    const { user } = requireAuth(req, ctx);
    const body = await parseJsonBody<SwapExerciseInput>(req);
    const result = applyExerciseSwap(user.id, body);
    ctx.log.info('exercise swapped', {
      dateKey: body.dateKey,
      scope: body.scope,
      toExerciseId: result.toExercise.id,
    });
    return NextResponse.json(result);
  },
);
