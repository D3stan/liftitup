import { NextRequest, NextResponse } from 'next/server';
import { ApiError, withApiHandler } from '@/lib/api/handler';
import { requireAuth } from '@/lib/auth/session';
import { updateUserSettings } from '@/lib/db/users';
import {
  ingestAppleHealthPayload,
  listAppleHealthWorkouts,
} from '@/lib/integrations/appleHealth';

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
    const body = await parseJsonOrArrayBody(req);

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

    const result = await ingestAppleHealthPayload(auth.user, body, {
      authMethod: auth.authMethod,
    });
    return NextResponse.json(result, { headers: CORS_HEADERS });
  },
);
