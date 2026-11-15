import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/lib/auth/session';
import {
  logWorkoutSessionWithImpact,
  undoWorkoutSession,
} from '@/lib/db/queries';

export async function POST(req: NextRequest) {
  try {
    const user = resolveUserFromRequest(req);
    const body = await req.json();

    if (body.action === 'undo' && body.sessionId) {
      const undone = undoWorkoutSession(user.id, body.sessionId);
      return NextResponse.json({ ok: undone, undoneSessionId: body.sessionId });
    }

    const impact = logWorkoutSessionWithImpact(user.id, {
      scheduleDayId: body.scheduleDayId,
      routineLabel: body.routineLabel,
      durationMinutes: body.durationMinutes,
      notes: body.notes,
      sets: body.sets || [],
      cid: body.cid,
    });

    return NextResponse.json({
      impact,
      session: impact.session,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : 'Failed to log workout session',
      },
      { status: 400 }
    );
  }
}
