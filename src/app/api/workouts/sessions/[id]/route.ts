import { NextRequest, NextResponse } from 'next/server';
import { ApiError, parseJsonBody, withApiHandler } from '@/lib/api/handler';
import { requireAuth } from '@/lib/auth/session';
import { getWorkoutSessionById } from '@/lib/db/workouts';
import {
  deleteWorkoutSession,
  updateWorkoutSession,
} from '@/lib/workouts/queries';
import type { UpdateWorkoutSessionInput } from '@/lib/workouts/types';

export const GET = withApiHandler<{ id: string }>(
  'workouts.sessions.get',
  async (req: NextRequest, ctx) => {
    const { user } = await requireAuth(req, ctx);
    const session = await getWorkoutSessionById(user.id, ctx.params.id);
    if (!session) {
      throw ApiError.notFound('Workout session not found');
    }
    return NextResponse.json({ session });
  },
);

export const PATCH = withApiHandler<{ id: string }>(
  'workouts.sessions.update',
  async (req: NextRequest, ctx) => {
    const { user } = await requireAuth(req, ctx);
    const body = await parseJsonBody<UpdateWorkoutSessionInput>(req);
    const session = await updateWorkoutSession(user.id, ctx.params.id, body);
    ctx.log.info('workout session updated', {
      sessionId: session.id,
      sessionDate: session.sessionDate,
    });
    return NextResponse.json({ session });
  },
);

export const DELETE = withApiHandler<{ id: string }>(
  'workouts.sessions.delete',
  async (req: NextRequest, ctx) => {
    const { user } = await requireAuth(req, ctx);
    await deleteWorkoutSession(user.id, ctx.params.id);
    ctx.log.info('workout session deleted', { sessionId: ctx.params.id });
    return NextResponse.json({ ok: true });
  },
);
