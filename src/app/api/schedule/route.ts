import { NextResponse } from 'next/server';
import { parseJsonBody, withApiHandler } from '@/lib/api/handler';
import { requireAuth } from '@/lib/auth';
import { getActiveSchedule } from '@/lib/db';
import {
  replaceActiveScheduleForUser,
  type PutScheduleBody,
} from '@/lib/schedule/service';

export const GET = withApiHandler('api.schedule.get', async (req, ctx) => {
  const auth = await requireAuth(req, ctx);
  const schedule = await getActiveSchedule(auth.user.id);
  return NextResponse.json({ schedule });
});

export const PUT = withApiHandler('api.schedule.put', async (req, ctx) => {
  const auth = await requireAuth(req, ctx);
  const body = await parseJsonBody<PutScheduleBody>(req);
  const updated = await replaceActiveScheduleForUser(auth.user, body);
  ctx.log.info('Active schedule replaced', {
    scheduleId: updated?.id ?? null,
    dayCount: updated?.days.length ?? 0,
    anchorDate: updated?.rotationAnchorDate ?? null,
    anchorIndex: updated?.rotationAnchorIndex ?? 0,
  });

  return NextResponse.json({ schedule: updated });
});
