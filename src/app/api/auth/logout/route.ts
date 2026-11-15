import { NextRequest, NextResponse } from 'next/server';
import { withApiHandler } from '@/lib/api/handler';
import {
  SESSION_COOKIE_NAME,
  clearSessionCookie,
  hashToken,
  optionalAuth,
} from '@/lib/auth/session';
import { deleteAuthSession } from '@/lib/db/sessions';

export const POST = withApiHandler('auth.logout', async (req: NextRequest, ctx) => {
  const auth = optionalAuth(req);
  if (auth) {
    ctx.setUserId(auth.user.id);
  }

  const rawCookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (rawCookie) {
    deleteAuthSession(hashToken(rawCookie));
  }

  const res = NextResponse.json({ ok: true });
  return clearSessionCookie(res);
});
