import { NextRequest, NextResponse } from 'next/server';
import { withApiHandler } from '@/lib/api/handler';
import { requireAuth } from '@/lib/auth/session';
import { getWorkoutDayView } from '@/lib/workouts/queries';

export const GET = withApiHandler<{ date: string }>(
  'workouts.day.get',
  async (req: NextRequest, ctx) => {
    const { user } = requireAuth(req, ctx);
    const todayParam = req.nextUrl.searchParams.get('today') ?? undefined;
    const data = getWorkoutDayView(user.id, ctx.params.date, todayParam);
    return NextResponse.json(data);
  },
);
