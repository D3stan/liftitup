import { NextRequest, NextResponse } from 'next/server';
import type { UserProfile } from '@/types/domain';
import {
  getDefaultDemoUser,
  getUserByApiKey,
  getUserById,
} from '@/lib/db/queries';

export const SESSION_COOKIE_NAME = 'liftitup_session';

/**
 * Resolves the authenticated UserProfile from:
 * 1. Authorization: Bearer <apiKey>
 * 2. x-api-key header
 * 3. ?apiKey= query parameter
 * 4. liftitup_session cookie
 * 5. Fallback to the pre-seeded Demo Athlete ('alex') so first-time PWA visitors
 *    land immediately in a rich, working hypertrophy environment.
 */
export function resolveUserFromRequest(req: NextRequest): UserProfile {
  const authHeader = req.headers.get('authorization');
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    const byBearer = getUserByApiKey(token);
    if (byBearer) return byBearer;
  }

  const headerKey = req.headers.get('x-api-key');
  if (headerKey) {
    const byHeader = getUserByApiKey(headerKey.trim());
    if (byHeader) return byHeader;
  }

  const queryKey = req.nextUrl?.searchParams?.get('apiKey');
  if (queryKey) {
    const byQuery = getUserByApiKey(queryKey.trim());
    if (byQuery) return byQuery;
  }

  const sessionUserId = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (sessionUserId) {
    const byCookie = getUserById(sessionUserId);
    if (byCookie) return byCookie;
  }

  return getDefaultDemoUser();
}

export function setSessionCookie(
  res: NextResponse,
  userId: string
): NextResponse {
  res.cookies.set(SESSION_COOKIE_NAME, userId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365, // 1 year for installed Home Screen PWA
  });
  return res;
}
