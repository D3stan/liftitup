import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ApiError, parseJsonBody, withApiHandler } from '@/lib/api/handler';
import { requireAuth } from '@/lib/auth/session';
import { recordBodyMetric } from '@/lib/db/bodyMetrics';
import { getDb, withTransaction } from '@/lib/db/connection';
import { localDateForTimezone, updateUserSettings } from '@/lib/db/users';
import type { AppleHealthWorkout } from '@/types/domain';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
};

interface DbAppleHealthRow {
  id: string;
  user_id: string;
  workout_type: string;
  started_at: string;
  duration_minutes: number;
  active_calories: number;
  avg_heart_rate: number | null;
  max_heart_rate: number | null;
  bodyweight_kg: number | null;
  linked_session_id: string | null;
  source: string;
  created_at: string;
}

function mapRow(row: DbAppleHealthRow): AppleHealthWorkout {
  return {
    id: row.id,
    userId: row.user_id,
    workoutType: row.workout_type,
    startedAt: row.started_at,
    durationMinutes: Number(row.duration_minutes),
    activeCalories: Number(row.active_calories),
    avgHeartRate: row.avg_heart_rate !== null ? Number(row.avg_heart_rate) : null,
    maxHeartRate: row.max_heart_rate !== null ? Number(row.max_heart_rate) : null,
    bodyweightKg: row.bodyweight_kg !== null ? Number(row.bodyweight_kg) : null,
    linkedSessionId: row.linked_session_id,
    source: row.source,
    createdAt: row.created_at,
  };
}

function listAppleHealthWorkouts(userId: string): AppleHealthWorkout[] {
  const db = getDb();
  const rows = db
    .prepare(
      'SELECT * FROM apple_health_workouts WHERE user_id = ? ORDER BY started_at DESC, created_at DESC LIMIT 25',
    )
    .all(userId) as unknown as DbAppleHealthRow[];
  return rows.map(mapRow);
}

function parseOptionalInt(val: unknown): number | null {
  if (val === undefined || val === null || val === '') return null;
  const n = Number(val);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function parseOptionalWeight(val: unknown): number | null {
  if (val === undefined || val === null || val === '') return null;
  const n = Number(val);
  if (!Number.isFinite(n) || n < 25 || n > 300) return null;
  return Math.round(n * 10) / 10;
}

function measuredDateFromIso(startedAt: string, timezone: string): string {
  const parsed = Date.parse(startedAt);
  if (Number.isFinite(parsed)) {
    return localDateForTimezone(timezone, new Date(parsed));
  }
  return localDateForTimezone(timezone);
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export const GET = withApiHandler(
  'integrations.appleHealth.get',
  async (req: NextRequest, ctx) => {
    const { user } = requireAuth(req, ctx);
    const workouts = listAppleHealthWorkouts(user.id);
    return NextResponse.json(
      {
        enabled: user.appleFitnessEnabled,
        workouts,
      },
      { headers: CORS_HEADERS },
    );
  },
);

export const POST = withApiHandler(
  'integrations.appleHealth.post',
  async (req: NextRequest, ctx) => {
    const { user } = requireAuth(req, ctx);
    const body = await parseJsonBody<Record<string, unknown> | unknown[]>(req);

    if (
      !Array.isArray(body) &&
      (body.action === 'toggle' || typeof body.enabled === 'boolean')
    ) {
      const updatedUser = updateUserSettings(user.id, {
        appleFitnessEnabled: Boolean(body.enabled),
      });
      if (!updatedUser) {
        throw ApiError.notFound('User not found');
      }
      return NextResponse.json(
        {
          ok: true,
          enabled: updatedUser.appleFitnessEnabled,
          user: updatedUser,
          workouts: listAppleHealthWorkouts(user.id),
        },
        { headers: CORS_HEADERS },
      );
    }

    const incomingList: Record<string, unknown>[] = Array.isArray(body)
      ? (body as Record<string, unknown>[])
      : Array.isArray(body.workouts)
        ? (body.workouts as Record<string, unknown>[])
        : [body];

    if (incomingList.length === 0) {
      throw ApiError.validation('No workouts provided');
    }

    const defaultSource =
      !Array.isArray(body) && body.source === 'file_import'
        ? 'file_import'
        : 'shortcut_webhook';

    const savedWorkouts: AppleHealthWorkout[] = [];
    let latestUser = user;

    withTransaction((db) => {
      const insertStmt = db.prepare(`
        INSERT INTO apple_health_workouts (
          id, user_id, workout_type, started_at, duration_minutes,
          active_calories, avg_heart_rate, max_heart_rate, bodyweight_kg,
          linked_session_id, source, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const findSessionStmt = db.prepare(`
        SELECT id FROM workout_sessions
        WHERE user_id = ? AND session_date = ?
        ORDER BY started_at DESC
        LIMIT 1
      `);

      const updateSessionWatchStmt = db.prepare(`
        UPDATE workout_sessions
        SET apple_watch_kcal = COALESCE(?, apple_watch_kcal),
            apple_watch_avg_hr = COALESCE(?, apple_watch_avg_hr),
            apple_watch_max_hr = COALESCE(?, apple_watch_max_hr)
        WHERE id = ? AND user_id = ?
      `);

      for (const item of incomingList.slice(0, 25)) {
        const workoutType =
          typeof item.workoutType === 'string' && item.workoutType.trim()
            ? item.workoutType.trim().slice(0, 80)
            : 'Traditional Strength Training';

        const startedAt =
          typeof item.startedAt === 'string' &&
          item.startedAt.trim() &&
          Number.isFinite(Date.parse(item.startedAt))
            ? new Date(item.startedAt).toISOString()
            : new Date().toISOString();

        const rawDuration = Number(
          item.durationMinutes ?? item.duration ?? 50,
        );
        const durationMinutes = Number.isFinite(rawDuration)
          ? Math.max(1, Math.min(600, Math.round(rawDuration)))
          : 50;

        const rawCalories = Number(
          item.activeCalories ?? item.kcal ?? item.calories ?? 350,
        );
        const activeCalories = Number.isFinite(rawCalories)
          ? Math.max(0, Math.min(10000, Math.round(rawCalories)))
          : 350;

        const avgHeartRate = parseOptionalInt(
          item.avgHeartRate ?? item.avgHr,
        );
        const maxHeartRate = parseOptionalInt(
          item.maxHeartRate ?? item.maxHr,
        );
        const bodyweightKg = parseOptionalWeight(
          item.bodyweightKg ?? item.weightKg,
        );

        const source =
          item.source === 'file_import' ? 'file_import' : defaultSource;
        const measuredDate = measuredDateFromIso(startedAt, user.timezone);

        const linked = findSessionStmt.get(user.id, measuredDate) as
          | { id: string }
          | undefined;
        const linkedSessionId = linked?.id ?? null;

        if (linkedSessionId) {
          updateSessionWatchStmt.run(
            activeCalories,
            avgHeartRate,
            maxHeartRate,
            linkedSessionId,
            user.id,
          );
        }

        const id = `ah_${crypto.randomUUID()}`;
        const createdAt = new Date().toISOString();

        insertStmt.run(
          id,
          user.id,
          workoutType,
          startedAt,
          durationMinutes,
          activeCalories,
          avgHeartRate,
          maxHeartRate,
          bodyweightKg,
          linkedSessionId,
          source,
          createdAt,
        );

        if (bodyweightKg !== null) {
          recordBodyMetric({
            userId: user.id,
            measuredOn: measuredDate,
            weightKg: bodyweightKg,
            source: 'apple_health',
          });
          const updated = updateUserSettings(user.id, {
            weightKg: bodyweightKg,
          });
          if (updated) {
            latestUser = updated;
          }
        }

        savedWorkouts.push({
          id,
          userId: user.id,
          workoutType,
          startedAt,
          durationMinutes,
          activeCalories,
          avgHeartRate,
          maxHeartRate,
          bodyweightKg,
          linkedSessionId,
          source,
          createdAt,
        });
      }
    });

    const workouts = listAppleHealthWorkouts(user.id);
    return NextResponse.json(
      {
        ok: true,
        syncedCount: savedWorkouts.length,
        latestSynced: savedWorkouts[0] ?? null,
        user: latestUser,
        workouts,
      },
      { headers: CORS_HEADERS },
    );
  },
);
