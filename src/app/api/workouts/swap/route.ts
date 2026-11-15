import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/lib/auth/session';
import { swapScheduleSlotExercise } from '@/lib/db/queries';

export async function POST(req: NextRequest) {
  try {
    const user = resolveUserFromRequest(req);
    const body = await req.json();

    const swap = swapScheduleSlotExercise({
      userId: user.id,
      fromExerciseId: body.fromExerciseId,
      toExerciseId: body.toExerciseId,
      scheduleSlotId: body.scheduleSlotId,
      currentWeightKg: body.currentWeightKg,
      targetReps: body.targetReps,
      targetRir: body.targetRir,
      targetSets: body.targetSets,
      scope: body.scope === 'schedule' ? 'schedule' : 'session',
      dateKey: body.date,
    });

    return NextResponse.json({ swap });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Failed to swap exercise variation',
      },
      { status: 400 }
    );
  }
}
