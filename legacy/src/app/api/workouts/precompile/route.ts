import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/lib/auth/session';
import { getPrecompiledSessionForUser } from '@/lib/db/queries';
import { EXERCISES } from '@/lib/hypertrophy/exercises';

export async function GET(req: NextRequest) {
  const user = resolveUserFromRequest(req);
  const dayParam = req.nextUrl.searchParams.get('dayOfWeek');
  const dateParam = req.nextUrl.searchParams.get('date') || undefined;

  const dayOfWeek =
    dayParam !== null && dayParam !== '' ? Number(dayParam) : undefined;

  const session = getPrecompiledSessionForUser(user.id, {
    dayOfWeek,
    date: dateParam,
  });

  return NextResponse.json({
    session,
    exercises: EXERCISES,
  });
}
