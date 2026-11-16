import { NextRequest, NextResponse } from 'next/server';
import { ApiError, withApiHandler } from '@/lib/api/handler';
import { requireAuth } from '@/lib/auth/session';
import { localDateForTimezone } from '@/lib/db/users';
import {
  addDaysIso,
  daysBetweenIso,
  getMondayOfWeekIso,
  isValidIsoDate,
  projectUserCalendar,
} from '@/lib/schedule/repo';

const MAX_RANGE_DAYS = 93;

export const GET = withApiHandler('calendar.get', async (req: NextRequest, ctx) => {
  const { user } = await requireAuth(req, ctx);

  const sp = req.nextUrl.searchParams;
  const rawToday = sp.get('today');
  const today =
    rawToday && isValidIsoDate(rawToday)
      ? rawToday
      : localDateForTimezone(user.timezone);

  const rawStart = sp.get('start');
  const rawEnd = sp.get('end');

  if (rawStart !== null && !isValidIsoDate(rawStart)) {
    throw ApiError.validation('start must be YYYY-MM-DD');
  }
  if (rawEnd !== null && !isValidIsoDate(rawEnd)) {
    throw ApiError.validation('end must be YYYY-MM-DD');
  }

  const rangeStart = rawStart ?? getMondayOfWeekIso(today);
  const rangeEnd = rawEnd ?? addDaysIso(rangeStart, 6);

  if (rangeStart > rangeEnd) {
    throw ApiError.validation('start must be on or before end');
  }
  if (daysBetweenIso(rangeStart, rangeEnd) > MAX_RANGE_DAYS) {
    throw ApiError.validation(`Range cannot exceed ${MAX_RANGE_DAYS} days`);
  }

  const projected = await projectUserCalendar({
    userId: user.id,
    today,
    rangeStart,
    rangeEnd,
  });

  return NextResponse.json(projected);
});
