import { NextRequest, NextResponse } from 'next/server';
import {
  createUser,
  getUserByUsername,
  listUsers,
  rotateUserApiKey,
  updateUser,
} from '@/lib/db/queries';
import {
  resolveUserFromRequest,
  setSessionCookie,
} from '@/lib/auth/session';

export async function GET(req: NextRequest) {
  const user = resolveUserFromRequest(req);
  const includeList = req.nextUrl.searchParams.get('list') === '1';

  return NextResponse.json({
    user,
    users: includeList ? listUsers() : undefined,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = body.action || 'login';
    const currentUser = resolveUserFromRequest(req);

    if (action === 'switch' || action === 'login') {
      const target = getUserByUsername(body.username || 'alex');
      if (!target) {
        return NextResponse.json(
          { error: `Athlete @${body.username} not found` },
          { status: 404 }
        );
      }
      const res = NextResponse.json({ user: target });
      return setSessionCookie(res, target.id);
    }

    if (action === 'register') {
      const created = createUser({
        username: body.username,
        displayName: body.displayName,
        password: body.password,
        bodyweightKg: body.bodyweightKg,
      });
      const res = NextResponse.json({ user: created });
      return setSessionCookie(res, created.id);
    }

    if (action === 'update_profile') {
      const updated = updateUser(currentUser.id, {
        displayName: body.displayName,
        bodyweightKg: body.bodyweightKg,
        unit: body.unit,
        appleFitnessEnabled: body.appleFitnessEnabled,
      });
      return NextResponse.json({ user: updated });
    }

    if (action === 'rotate_api_key') {
      const rotated = rotateUserApiKey(currentUser.id);
      return NextResponse.json({ user: rotated });
    }

    return NextResponse.json({ user: currentUser });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Auth action failed' },
      { status: 400 }
    );
  }
}
