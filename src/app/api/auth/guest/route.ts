import { NextRequest, NextResponse } from 'next/server';
import { parseJsonBody, withApiHandler } from '@/lib/api/handler';
import { createGuestSandbox } from '@/lib/auth/sandbox';
import { createSessionCookieForUser } from '@/lib/auth/session';

interface GuestBody {
  timezone?: unknown;
}

export const POST = withApiHandler('auth.guest', async (req: NextRequest, ctx) => {
  let timezone: string | undefined;
  const contentLength = req.headers.get('content-length');
  if (contentLength && Number(contentLength) > 0) {
    const body = await parseJsonBody<GuestBody>(req);
    if (typeof body.timezone === 'string') {
      timezone = body.timezone;
    }
  }

  const user = createGuestSandbox(timezone);
  ctx.setUserId(user.id);
  const res = NextResponse.json({ user }, { status: 201 });
  return createSessionCookieForUser(res, user.id);
});
