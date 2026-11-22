import crypto from 'node:crypto';
import type { NextRequest, NextResponse } from 'next/server';
import type { UserProfile } from '@/types/domain';
import { ApiError } from '@/lib/api/handler';
import { recordThrottledActivityEvent } from '@/lib/admin/events';
import {
  createAuthSession,
  deleteAuthSession,
  getAuthSessionByTokenHash,
  getUserByApiKeyHash,
  touchApiKeyLastUsed,
  touchAuthSession,
} from '@/lib/db/sessions';
import { getUserById, touchUserLastActive } from '@/lib/db/users';
import { purgeExpiredGuestsIfDue } from './sandbox';

export const SESSION_COOKIE_NAME = 'liftitup_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export interface AuthContext {
  user: UserProfile;
  authMethod: 'session' | 'api_key';
  sessionTokenHash?: string;
  apiKeyId?: string;
  apiKeyPrefix?: string;
}

export function generateRawToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export function generateApiKey(): {
  rawKey: string;
  keyHash: string;
  keyPrefix: string;
} {
  const rawKey = `liuk_${crypto.randomBytes(24).toString('hex')}`;
  return {
    rawKey,
    keyHash: hashToken(rawKey),
    keyPrefix: rawKey.slice(0, 12),
  };
}

function extractBearerToken(req: NextRequest): string | null {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return match ? match[1].trim() : null;
}

async function resolveFromApiKey(rawKey: string): Promise<AuthContext | null> {
  if (!rawKey) return null;
  const match = await getUserByApiKeyHash(hashToken(rawKey));
  if (!match || match.user.isDisabled) return null;

  await touchApiKeyLastUsed(match.apiKeyId);
  await touchUserLastActive(match.user.id);
  await recordThrottledActivityEvent(match.user.id, 'api_key');
  return {
    user: match.user,
    authMethod: 'api_key',
    apiKeyId: match.apiKeyId,
    apiKeyPrefix: match.apiKeyPrefix,
  };
}

/**
 * Resolves the authenticated user from Bearer token, x-api-key header,
 * or `liftitup_session` cookie. Never falls back to a default user.
 */
export async function optionalAuth(req: NextRequest): Promise<AuthContext | null> {
  await purgeExpiredGuestsIfDue();

  const authHeader = req.headers.get('authorization');
  if (authHeader !== null) {
    const bearer = extractBearerToken(req);
    return bearer ? await resolveFromApiKey(bearer) : null;
  }

  const headerKey = req.headers.get('x-api-key');
  if (headerKey !== null) {
    return await resolveFromApiKey(headerKey.trim());
  }

  const rawCookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!rawCookie) return null;

  const tokenHash = hashToken(rawCookie);
  const session = await getAuthSessionByTokenHash(tokenHash);
  if (!session) return null;

  const now = Date.now();
  if (Date.parse(session.expiresAt) <= now) {
    await deleteAuthSession(tokenHash);
    return null;
  }

  const user = await getUserById(session.userId);
  if (!user || user.isDisabled) {
    await deleteAuthSession(tokenHash);
    return null;
  }

  const lastSeenMs = Date.parse(session.lastSeenAt);
  if (!Number.isFinite(lastSeenMs) || now - lastSeenMs > SESSION_TOUCH_INTERVAL_MS) {
    const newExpiresAt = new Date(now + SESSION_TTL_MS).toISOString();
    await touchAuthSession(tokenHash, newExpiresAt);
  }
  await touchUserLastActive(user.id);
  await recordThrottledActivityEvent(user.id, 'session');

  return {
    user,
    authMethod: 'session',
    sessionTokenHash: tokenHash,
  };
}

export interface RequireAuthOptions {
  allowMustChangePassword?: boolean;
}

/**
 * Enforces authentication via cookie session or API key; throws 401 ApiError otherwise.
 * Throws 403 `PASSWORD_CHANGE_REQUIRED` when `mustChangePassword` is true unless
 * `allowMustChangePassword` is set.
 */
export async function requireAuth(
  req: NextRequest,
  ctx?: { setUserId?: (id: string | null) => void },
  opts?: RequireAuthOptions,
): Promise<AuthContext> {
  const auth = await optionalAuth(req);
  if (!auth) {
    throw ApiError.unauthorized('Authentication required');
  }
  ctx?.setUserId?.(auth.user.id);
  if (!opts?.allowMustChangePassword && auth.user.mustChangePassword) {
    throw ApiError.passwordChangeRequired();
  }
  return auth;
}

/**
 * Enforces authentication via session cookie only; rejects API-key callers (Bearer / x-api-key)
 * with 403 and unauthenticated requests with 401.
 * Throws 403 `PASSWORD_CHANGE_REQUIRED` when `mustChangePassword` is true unless
 * `allowMustChangePassword` is set.
 */
export async function requireSessionAuth(
  req: NextRequest,
  ctx?: { setUserId?: (id: string | null) => void },
  opts?: RequireAuthOptions,
): Promise<AuthContext> {
  if (
    req.headers.get('authorization') !== null ||
    req.headers.get('x-api-key') !== null
  ) {
    throw ApiError.forbidden(
      'Session cookie authentication required; API keys are not allowed',
    );
  }
  const auth = await optionalAuth(req);
  if (!auth || auth.authMethod !== 'session') {
    throw ApiError.unauthorized('Session authentication required');
  }
  ctx?.setUserId?.(auth.user.id);
  if (!opts?.allowMustChangePassword && auth.user.mustChangePassword) {
    throw ApiError.passwordChangeRequired();
  }
  return auth;
}

/**
 * Enforces API-key authentication (for `/api/mcp`) via either
 * `Authorization: Bearer <api_key>` header or `?token=<api_key>` URL query parameter.
 * Throws 401 otherwise, or 403 `PASSWORD_CHANGE_REQUIRED` if password reset is pending.
 */
export async function requireApiKeyAuth(
  req: NextRequest,
  ctx?: { setUserId?: (id: string | null) => void },
): Promise<AuthContext> {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== null && authHeader.trim() !== '') {
    const bearer = extractBearerToken(req);
    if (!bearer) {
      throw ApiError.unauthorized('Bearer API key required');
    }
    const auth = await resolveFromApiKey(bearer);
    if (!auth) {
      throw ApiError.unauthorized('Invalid API key');
    }
    ctx?.setUserId?.(auth.user.id);
    if (auth.user.mustChangePassword) {
      throw ApiError.passwordChangeRequired();
    }
    return auth;
  }

  const urlToken = req.nextUrl?.searchParams?.get('token')?.trim() ?? '';
  if (!urlToken) {
    throw ApiError.unauthorized('API key required');
  }
  const auth = await resolveFromApiKey(urlToken);
  if (!auth) {
    throw ApiError.unauthorized('Invalid API key');
  }
  ctx?.setUserId?.(auth.user.id);
  if (auth.user.mustChangePassword) {
    throw ApiError.passwordChangeRequired();
  }
  return auth;
}

export async function createSessionCookieForUser(
  res: NextResponse,
  userId: string,
): Promise<NextResponse> {
  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await createAuthSession(userId, tokenHash, expiresAt);

  res.cookies.set(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return res;
}

export function clearSessionCookie(res: NextResponse): NextResponse {
  res.cookies.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
  return res;
}
