import { NextRequest, NextResponse } from 'next/server';
import { ApiError, withApiHandler } from '@/lib/api/handler';
import { safeRecordEvent } from '@/lib/admin/events';
import { recordAppleHealthIngestOutcome } from '@/lib/admin/metrics';
import { requireAuth } from '@/lib/auth/session';
import { updateUserSettings } from '@/lib/db/users';
import {
  ingestAppleHealthPayload,
  listAppleHealthWorkouts,
} from '@/lib/integrations/appleHealth';
import { getConfiguredAppleHealthShortcutUrl } from '@/lib/integrations/appleHealthShortcutConfig';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
};

async function parseJsonOrArrayBody(req: NextRequest): Promise<unknown> {
  let parsed: unknown;
  try {
    parsed = (await req.json()) as unknown;
  } catch {
    throw ApiError.badRequest('Invalid JSON request body');
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw ApiError.validation('Request body must be a JSON object or array');
  }
  return parsed;
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
    const { user } = await requireAuth(req, ctx);
    const workouts = await listAppleHealthWorkouts(user.id);
    return NextResponse.json(
      {
        enabled: user.appleFitnessEnabled,
        lastReceivedAt: user.appleHealthLastReceivedAt,
        lastReceivedKind: user.appleHealthLastReceivedKind,
        lastReceivedLinked: user.appleHealthLastReceivedLinked,
        shortcutUrl: getConfiguredAppleHealthShortcutUrl(),
        workouts,
      },
      { headers: CORS_HEADERS },
    );
  },
);

export const POST = withApiHandler(
  'integrations.appleHealth.post',
  async (req: NextRequest, ctx) => {
    const auth = await requireAuth(req, ctx);
    let body: unknown;
    try {
      body = await parseJsonOrArrayBody(req);
    } catch (err) {
      await recordAppleHealthIngestOutcome('rejected');
      throw err;
    }

    if (!Array.isArray(body)) {
      const obj = body as Record<string, unknown>;
      if (obj.action === 'toggle' || obj.enabled !== undefined) {
        if (typeof obj.enabled !== 'boolean') {
          throw ApiError.validation('enabled must be a boolean');
        }
        const updatedUser = await updateUserSettings(auth.user.id, {
          appleFitnessEnabled: obj.enabled,
        });
        if (!updatedUser) {
          throw ApiError.notFound('User not found');
        }
        return NextResponse.json(
          {
            ok: true,
            enabled: updatedUser.appleFitnessEnabled,
            user: updatedUser,
            workouts: await listAppleHealthWorkouts(auth.user.id),
          },
          { headers: CORS_HEADERS },
        );
      }
    }

    let result: Awaited<ReturnType<typeof ingestAppleHealthPayload>>;
    try {
      result = await ingestAppleHealthPayload(auth.user, body, {
        authMethod: auth.authMethod,
      });
    } catch (err) {
      await recordAppleHealthIngestOutcome('rejected');
      throw err;
    }

    if (!result.dryRun) {
      await recordAppleHealthIngestOutcome('received');
      const isFileImport =
        auth.authMethod === 'session' &&
        !Array.isArray(body) &&
        typeof body === 'object' &&
        body !== null &&
        (body as Record<string, unknown>).source === 'file_import';
      await safeRecordEvent({
        userId: auth.user.id,
        eventType: isFileImport ? 'file_import' : 'apple_health_ingest',
        detail: {
          source: isFileImport ? 'apple_health_file' : auth.authMethod,
          workoutCount: result.workoutCount,
          weightCount: result.weightCount,
          linkedCount: result.linkedCount,
        },
      });
    }
    return NextResponse.json(result, { headers: CORS_HEADERS });
  },
);
