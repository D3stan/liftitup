import { NextRequest, NextResponse } from 'next/server';
import { withApiHandler } from '@/lib/api/handler';
import { requireAuth } from '@/lib/auth/session';
import {
  getUserProgressReport,
  type BodyWeightPoint,
  type ExerciseProgressPoint,
  type ProgressExerciseOption,
  type ProgressResponse,
  type WeeklyBarPoint,
} from '@/lib/workouts/progress';

export type {
  BodyWeightPoint,
  ExerciseProgressPoint,
  ProgressExerciseOption,
  ProgressResponse,
  WeeklyBarPoint,
};

export const GET = withApiHandler(
  'progress.get',
  async (req: NextRequest, ctx) => {
    const { user } = await requireAuth(req, ctx);
    const sp = req.nextUrl.searchParams;
    const payload = await getUserProgressReport(user, {
      range: sp.get('range'),
      today: sp.get('today'),
      exerciseId: sp.get('exerciseId'),
    });
    return NextResponse.json(payload);
  },
);
