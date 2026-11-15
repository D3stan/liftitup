import { NextRequest, NextResponse } from 'next/server';
import { ApiError, parseJsonBody, withApiHandler } from '@/lib/api/handler';
import { verifyPassword } from '@/lib/auth/password';
import { createSessionCookieForUser } from '@/lib/auth/session';
import { getUserByUsername } from '@/lib/db/users';

interface LoginBody {
  username?: unknown;
  password?: unknown;
}

// Precomputed valid scrypt format dummy hash to equalize timing when username is missing
const DUMMY_SCRYPT_HASH =
  'scrypt:00000000000000000000000000000000:' + '00'.repeat(64);

export const POST = withApiHandler('auth.login', async (req: NextRequest, ctx) => {
  const body = await parseJsonBody<LoginBody>(req);

  if (typeof body.username !== 'string' || !body.username.trim()) {
    throw ApiError.validation('username is required');
  }
  if (typeof body.password !== 'string' || !body.password) {
    throw ApiError.validation('password is required');
  }

  const found = getUserByUsername(body.username);
  if (!found || found.isGuest) {
    await verifyPassword(body.password, DUMMY_SCRYPT_HASH);
    throw ApiError.unauthorized('Invalid username or password');
  }

  const valid = await verifyPassword(body.password, found.passwordHash);
  if (!valid) {
    throw ApiError.unauthorized('Invalid username or password');
  }

  const { passwordHash: _ignored, ...user } = found;
  ctx.setUserId(user.id);
  const res = NextResponse.json({ user });
  return createSessionCookieForUser(res, user.id);
});
