import { NextRequest, NextResponse } from 'next/server';
import { parseJsonBody, withApiHandler } from '@/lib/api/handler';
import { requireAuth } from '@/lib/auth/session';
import {
  createScheduleEventForUser,
  deleteScheduleEventForUser,
  type CreateScheduleEventInput,
} from '@/lib/schedule/service';

export const POST = withApiHandler(
  'schedule.events.create',
  async (req: NextRequest, ctx) => {
    const { user } = await requireAuth(req, ctx);
    const body = await parseJsonBody<CreateScheduleEventInput>(req);
    const event = await createScheduleEventForUser(user, body);
    return NextResponse.json({ event }, { status: 201 });
  },
);

export const DELETE = withApiHandler(
  'schedule.events.delete',
  async (req: NextRequest, ctx) => {
    const { user } = await requireAuth(req, ctx);
    const id = req.nextUrl.searchParams.get('id') ?? undefined;
    const eventDate = req.nextUrl.searchParams.get('date') ?? undefined;
    const deleted = await deleteScheduleEventForUser(user, { id, eventDate });
    return NextResponse.json({ ok: true, deleted });
  },
);
