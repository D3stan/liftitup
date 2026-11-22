import type { NextRequest } from 'next/server';
import type { UserProfile } from '@/types/domain';
import { ApiError } from '@/lib/api/handler';
import { optionalAuth, type AuthContext } from '@/lib/auth/session';

export function parseAdminUserIds(
  raw: string | undefined = process.env.ADMIN_USER_IDS,
): Set<string> {
  if (!raw || typeof raw !== 'string') return new Set();
  const ids = raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return new Set(ids);
}

export function isAdminUserId(userId: string | null | undefined): boolean {
  if (!userId) return false;
  return parseAdminUserIds().has(userId);
}

export function isAdminUser(
  user: Pick<UserProfile, 'id' | 'isGuest' | 'isDisabled'> | null | undefined,
): boolean {
  if (!user) return false;
  if (user.isGuest || user.isDisabled) return false;
  return isAdminUserId(user.id);
}

function collectAllowedHosts(req: NextRequest): Set<string> {
  const hosts = new Set<string>();
  const addHost = (raw: string | null | undefined) => {
    if (!raw) return;
    const first = raw.split(',')[0]?.trim().toLowerCase();
    if (first) hosts.add(first);
  };

  addHost(req.headers.get('x-forwarded-host'));
  addHost(req.headers.get('host'));
  addHost(req.nextUrl?.host);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) {
    try {
      addHost(new URL(appUrl).host);
    } catch {
      // ignore invalid NEXT_PUBLIC_APP_URL
    }
  }

  return hosts;
}

/**
 * Verifies that an admin POST request comes from the same origin/host
 * (`Origin` or `Referer` header matches request host, and `Sec-Fetch-Site`
 * is not cross-site). Throws 403 ApiError on mismatch.
 */
export function verifySameOriginAdminPost(req: NextRequest): void {
  const secFetchSite = req.headers.get('sec-fetch-site')?.trim().toLowerCase();
  if (secFetchSite && secFetchSite !== 'same-origin') {
    throw ApiError.forbidden('Cross-site admin request rejected');
  }

  const allowedHosts = collectAllowedHosts(req);
  const origin = req.headers.get('origin');
  if (origin !== null) {
    if (!origin || origin.trim().toLowerCase() === 'null') {
      throw ApiError.forbidden('Invalid origin on admin write request');
    }
    let parsedOrigin: URL;
    try {
      parsedOrigin = new URL(origin);
    } catch {
      throw ApiError.forbidden('Malformed origin header on admin write request');
    }
    if (!allowedHosts.has(parsedOrigin.host.toLowerCase())) {
      throw ApiError.forbidden('Cross-origin admin request rejected');
    }
    return;
  }

  const referer = req.headers.get('referer');
  if (referer !== null) {
    let parsedReferer: URL;
    try {
      parsedReferer = new URL(referer);
    } catch {
      throw ApiError.forbidden('Malformed referer header on admin write request');
    }
    if (!allowedHosts.has(parsedReferer.host.toLowerCase())) {
      throw ApiError.forbidden('Cross-site referer on admin write request');
    }
    return;
  }

  if (secFetchSite === 'same-origin') {
    return;
  }

  throw ApiError.forbidden('Missing origin header on admin write request');
}

/**
 * Cookie-only admin guard for `/api/admin/*` routes.
 * Refuses API keys, guests, disabled users, unauthenticated requests, and
 * non-admins — ALWAYS throwing 404 Not Found so the admin surface stays hidden.
 */
export async function requireAdminSessionAuth(
  req: NextRequest,
  ctx?: { setUserId?: (id: string | null) => void },
): Promise<AuthContext> {
  if (
    req.headers.get('authorization') !== null ||
    req.headers.get('x-api-key') !== null
  ) {
    throw ApiError.notFound('Not found');
  }

  const auth = await optionalAuth(req);
  if (!auth || auth.authMethod !== 'session' || !isAdminUser(auth.user)) {
    throw ApiError.notFound('Not found');
  }

  ctx?.setUserId?.(auth.user.id);
  if (auth.user.mustChangePassword) {
    throw ApiError.passwordChangeRequired();
  }
  return auth;
}

/**
 * Cookie-only + same-origin CSRF guard for admin POST/write routes.
 * Auth failure still returns 404; authenticated cross-site POST returns 403.
 */
export async function requireAdminWriteSessionAuth(
  req: NextRequest,
  ctx?: { setUserId?: (id: string | null) => void },
): Promise<AuthContext> {
  const auth = await requireAdminSessionAuth(req, ctx);
  verifySameOriginAdminPost(req);
  return auth;
}
