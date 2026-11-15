import { NextRequest, NextResponse } from 'next/server';
import { ApiError, parseJsonBody, withApiHandler } from '@/lib/api/handler';
import { requireAuth } from '@/lib/auth/session';
import { localDateForTimezone } from '@/lib/db/users';
import { getActiveSchedule } from '@/lib/db/workouts';
import {
  createScheduleEvent,
  deleteScheduleEventsByDateOrId,
  isValidIsoDate,
  projectUserCalendar,
} from '@/lib/schedule/repo';
import type { ScheduleEventType } from '@/types/domain';

interface CreateEventBody {
  eventDate?: unknown;
  eventType?: unknown;
  shiftDays?: unknown;
  jollyLabel?: unknown;
  today?: unknown;
}

const ALLOWED_TYPES = new Set<ScheduleEventType>([
  'skip',
  'postpone',
  'reset',
  'jolly_extra',
  'jolly_instead',
]);

export const POST = withApiHandler(
  'schedule.events.create',
  async (req: NextRequest, ctx) => {
    const { user } = requireAuth(req, ctx);
    const body = await parseJsonBody<CreateEventBody>(req);

    const today =
      typeof body.today === 'string' && isValidIsoDate(body.today)
        ? body.today
        : localDateForTimezone(user.timezone);

    const eventDate =
      body.eventDate === undefined ? today : body.eventDate;
    if (typeof eventDate !== 'string' || !isValidIsoDate(eventDate)) {
      throw ApiError.validation('eventDate must be YYYY-MM-DD');
    }

    if (
      typeof body.eventType !== 'string' ||
      !ALLOWED_TYPES.has(body.eventType as ScheduleEventType)
    ) {
      throw ApiError.validation(
        'eventType must be one of skip, postpone, reset, jolly_extra, jolly_instead',
      );
    }
    const eventType = body.eventType as ScheduleEventType;

    let shiftDays: 1 | 2 | 3 | null = null;
    if (eventType === 'postpone') {
      const raw = body.shiftDays === undefined ? 1 : body.shiftDays;
      if (raw !== 1 && raw !== 2 && raw !== 3) {
        throw ApiError.validation('shiftDays must be 1, 2, or 3');
      }
      shiftDays = raw;
    }

    let jollyLabel: string | null = null;
    if (body.jollyLabel !== undefined && body.jollyLabel !== null) {
      if (typeof body.jollyLabel !== 'string') {
        throw ApiError.validation('jollyLabel must be a string');
      }
      const trimmed = body.jollyLabel.trim();
      if (trimmed.length > 60) {
        throw ApiError.validation('jollyLabel must be at most 60 characters');
      }
      jollyLabel = trimmed || null;
    }

    const schedule = getActiveSchedule(user.id);
    if (!schedule) {
      throw ApiError.badRequest('No active rotation schedule');
    }

    if (eventType === 'jolly_instead') {
      const projected = projectUserCalendar({
        userId: user.id,
        today,
        rangeStart: eventDate,
        rangeEnd: eventDate,
      });
      const targetDay = projected.days[0];
      if (!targetDay || targetDay.status === 'rest' || targetDay.plannedDay?.isRestDay) {
        throw ApiError.badRequest('Jolly instead is not available on a rest day');
      }
    }

    const event = createScheduleEvent({
      userId: user.id,
      scheduleId: schedule.id,
      eventDate,
      eventType,
      shiftDays,
      jollyLabel,
    });

    return NextResponse.json({ event }, { status: 201 });
  },
);

export const DELETE = withApiHandler(
  'schedule.events.delete',
  (req: NextRequest, ctx) => {
    const { user } = requireAuth(req, ctx);
    const schedule = getActiveSchedule(user.id);
    if (!schedule) {
      throw ApiError.badRequest('No active rotation schedule');
    }

    const id = req.nextUrl.searchParams.get('id') ?? undefined;
    const eventDate = req.nextUrl.searchParams.get('date') ?? undefined;

    if (!id && !eventDate) {
      throw ApiError.validation('id or date query parameter is required');
    }
    if (eventDate && !isValidIsoDate(eventDate)) {
      throw ApiError.validation('date must be YYYY-MM-DD');
    }

    const deleted = deleteScheduleEventsByDateOrId({
      userId: user.id,
      scheduleId: schedule.id,
      id,
      eventDate,
    });

    return NextResponse.json({ ok: true, deleted });
  },
);
