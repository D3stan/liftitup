import { NextRequest, NextResponse } from 'next/server';
import { parseJsonBody, withApiHandler } from '@/lib/api/handler';
import { requireAuth } from '@/lib/auth/session';
import { saveWorkoutSession } from '@/lib/workouts/queries';
import type { SaveWorkoutSessionInput } from '@/lib/workouts/types';

export const POST = withApiHandler(
  'workouts.sessions.create',
  async (req: NextRequest, ctx) => {
    const { user } = await requireAuth(req, ctx);
    const body = await parseJsonBody<SaveWorkoutSessionInput>(req);
    const { session, created } = await saveWorkoutSession(user.id, body);
    ctx.log.info('workout session saved', {
      sessionId: session.id,
      sessionDate: session.sessionDate,
      isJolly: session.isJolly,
      exerciseCount: session.exercises.length,
      created,
    });
    return NextResponse.json({ session }, { status: created ? 201 : 200 });
  },
);
