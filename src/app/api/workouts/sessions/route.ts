import { NextRequest, NextResponse } from 'next/server';
import { parseJsonBody, withApiHandler } from '@/lib/api/handler';
import { safeRecordEvent } from '@/lib/admin/events';
import { requireAuth } from '@/lib/auth/session';
import { saveWorkoutSession } from '@/lib/workouts/queries';
import type { SaveWorkoutSessionInput } from '@/lib/workouts/types';

export const POST = withApiHandler(
  'workouts.sessions.create',
  async (req: NextRequest, ctx) => {
    const { user, authMethod } = await requireAuth(req, ctx);
    const body = await parseJsonBody<
      SaveWorkoutSessionInput & { viewMode?: unknown }
    >(req);
    const { session, created } = await saveWorkoutSession(user.id, body);
    if (created) {
      if (body.viewMode === 'focus') {
        await safeRecordEvent({
          userId: user.id,
          eventType: 'focus_mode_used',
          detail: { sessionId: session.id },
        });
      }
      await safeRecordEvent({
        userId: user.id,
        eventType: 'workout_logged',
        detail: {
          sessionId: session.id,
          authMethod,
          viewMode: body.viewMode === 'focus' ? 'focus' : 'list',
        },
      });
    }
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
