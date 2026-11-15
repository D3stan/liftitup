import { NextRequest, NextResponse } from 'next/server';
import { ApiError, withApiHandler } from '@/lib/api/handler';
import { createGuestSandbox } from '@/lib/auth/sandbox';
import { createSessionCookieForUser } from '@/lib/auth/session';

interface GuestBody {
  timezone?: unknown;
}

export const POST = withApiHandler('auth.guest', async (req: NextRequest, ctx) => {
  let timezone: string | undefined;
  const raw = await req.text();
  if (raw.trim().length > 0) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw ApiError.badRequest('Invalid JSON request body');
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw ApiError.badRequest('Request body must be a JSON object');
    }
    const body = parsed as GuestBody;
    if (typeof body.timezone === 'string') {
      timezone = body.timezone;
    }
  }

  const user = createGuestSandbox(timezone);
  ctx.setUserId(user.id);
  const res = NextResponse.json({ user }, { status: 201 });
  return createSessionCookieForUser(res, user.id);
});
