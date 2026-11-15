import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/lib/auth/session';
import {
  getActiveSchedule,
  shiftScheduleDays,
  upsertUserSchedule,
} from '@/lib/db/queries';
import { EXERCISES, SCHEDULE_PRESETS } from '@/lib/hypertrophy/exercises';

export async function GET(req: NextRequest) {
  const user = resolveUserFromRequest(req);
  const schedule = getActiveSchedule(user.id);

  return NextResponse.json({
    schedule,
    presets: SCHEDULE_PRESETS,
    exercises: EXERCISES,
  });
}

export async function PUT(req: NextRequest) {
  try {
    const user = resolveUserFromRequest(req);
    const body = await req.json();

    if (body.action === 'shift') {
      const shifted = shiftScheduleDays(user.id, Number(body.shiftBy) || 1);
      return NextResponse.json({ schedule: shifted });
    }

    if (body.presetKey && SCHEDULE_PRESETS[body.presetKey]) {
      const preset = SCHEDULE_PRESETS[body.presetKey];
      const updated = upsertUserSchedule(user.id, {
        name: preset.name,
        splitType: preset.splitType,
        days: preset.days,
      });
      return NextResponse.json({ schedule: updated });
    }

    const schedulePayload = body.schedule || body;
    const updated = upsertUserSchedule(user.id, {
      name: schedulePayload.name,
      splitType: schedulePayload.splitType,
      days: schedulePayload.days,
    });

    return NextResponse.json({ schedule: updated });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : 'Failed to update schedule',
      },
      { status: 400 }
    );
  }
}
