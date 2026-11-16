import { NextRequest, NextResponse } from 'next/server';
import { ApiError, withApiHandler } from '@/lib/api/handler';
import { requireAuth } from '@/lib/auth/session';
import { getLastPerformanceByExerciseIds } from '@/lib/db/workouts';
import { isValidYmd } from '@/lib/workouts/queries';

export const GET = withApiHandler(
  'workouts.prefill.get',
  async (req: NextRequest, ctx) => {
    const { user } = await requireAuth(req, ctx);
    const rawIds = req.nextUrl.searchParams.get('exerciseIds') ?? '';
    const beforeDate = req.nextUrl.searchParams.get('beforeDate') ?? undefined;

    if (beforeDate !== undefined && !isValidYmd(beforeDate)) {
      throw ApiError.validation('beforeDate must be YYYY-MM-DD');
    }

    const ids = rawIds
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 50);

    const prefillByExerciseId = await getLastPerformanceByExerciseIds(
      user.id,
      ids,
      beforeDate,
    );
    return NextResponse.json({ prefillByExerciseId });
  },
);
