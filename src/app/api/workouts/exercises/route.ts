import { NextRequest, NextResponse } from 'next/server';
import { withApiHandler } from '@/lib/api/handler';
import { requireAuth } from '@/lib/auth/session';
import { listExercises } from '@/lib/exercises/repository';
import type { TrackingType } from '@/types/domain';

export const GET = withApiHandler(
  'workouts.exercises.list',
  async (req: NextRequest, ctx) => {
    const { user } = await requireAuth(req, ctx);
    const q = req.nextUrl.searchParams.get('q') ?? undefined;
    const category = req.nextUrl.searchParams.get('category') ?? undefined;
    const trackingType =
      (req.nextUrl.searchParams.get('trackingType') as TrackingType | null) ??
      undefined;

    const exercises = await listExercises(user.id, {
      query: q,
      category,
      trackingType,
      includeHidden: false,
    });

    return NextResponse.json({ exercises });
  },
);
