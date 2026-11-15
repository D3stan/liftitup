import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/lib/auth/session';
import {
  getAppleHealthWorkouts,
  saveAppleHealthWorkout,
  updateUser,
} from '@/lib/db/queries';
import type { AppleHealthWorkout } from '@/types/domain';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
};

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function GET(req: NextRequest) {
  const user = resolveUserFromRequest(req);
  const workouts = getAppleHealthWorkouts(user.id);
  return NextResponse.json(
    {
      enabled: user.appleFitnessEnabled,
      user,
      workouts,
    },
    { headers: CORS_HEADERS }
  );
}

export async function POST(req: NextRequest) {
  try {
    const user = resolveUserFromRequest(req);
    const body = await req.json();

    // Handle Opt-In / Opt-Out toggle
    if (body.action === 'toggle' || typeof body.enabled === 'boolean') {
      const updatedUser = updateUser(user.id, {
        appleFitnessEnabled: Boolean(body.enabled),
      });
      return NextResponse.json(
        {
          ok: true,
          enabled: updatedUser.appleFitnessEnabled,
          user: updatedUser,
          workouts: getAppleHealthWorkouts(user.id),
        },
        { headers: CORS_HEADERS }
      );
    }

    // Handle batch file import or array of workouts
    const incomingList: Record<string, unknown>[] = Array.isArray(body.workouts)
      ? body.workouts
      : Array.isArray(body)
      ? body
      : [body];

    const defaultSource: AppleHealthWorkout['source'] =
      body.source === 'file_import' ? 'file_import' : 'shortcut_webhook';

    let latestUser = user;
    let xpAwarded = 0;
    const savedWorkouts: AppleHealthWorkout[] = [];

    for (const item of incomingList.slice(0, 25)) {
      const source: AppleHealthWorkout['source'] =
        item.source === 'file_import' || item.source === 'demo_seed'
          ? item.source
          : defaultSource;

      const result = saveAppleHealthWorkout(user.id, {
        workoutType:
          typeof item.workoutType === 'string' && item.workoutType.trim()
            ? item.workoutType.trim()
            : 'Traditional Strength Training',
        startedAt:
          typeof item.startedAt === 'string' && item.startedAt.trim()
            ? item.startedAt.trim()
            : new Date().toISOString(),
        durationMinutes: Math.max(
          5,
          Number(item.durationMinutes ?? item.duration ?? 54)
        ),
        activeCalories: Math.max(
          20,
          Number(item.activeCalories ?? item.kcal ?? item.calories ?? 410)
        ),
        avgHeartRate:
          item.avgHeartRate !== undefined && item.avgHeartRate !== null
            ? Number(item.avgHeartRate)
            : 129,
        maxHeartRate:
          item.maxHeartRate !== undefined && item.maxHeartRate !== null
            ? Number(item.maxHeartRate)
            : 165,
        bodyweightKg:
          item.bodyweightKg !== undefined && item.bodyweightKg !== null
            ? Number(item.bodyweightKg)
            : null,
        source,
      });

      savedWorkouts.push(result.workout);
      latestUser = result.user;
      xpAwarded += 35;
    }

    const allWorkouts = getAppleHealthWorkouts(user.id);

    return NextResponse.json(
      {
        ok: true,
        syncedCount: savedWorkouts.length,
        xpAwarded,
        latestSynced: savedWorkouts[0] || null,
        user: latestUser,
        workouts: allWorkouts,
      },
      { headers: CORS_HEADERS }
    );
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Failed to process Apple Fitness webhook / import',
      },
      { status: 400, headers: CORS_HEADERS }
    );
  }
}
