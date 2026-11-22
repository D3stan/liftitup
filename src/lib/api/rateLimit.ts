import type { NextRequest } from 'next/server';

export type RateLimitTier =
  | 'auth'
  | 'sensitive'
  | 'expensive'
  | 'mcp'
  | 'admin'
  | 'general';

export interface RateLimitPolicy {
  tier: RateLimitTier;
  bucket: string;
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetEpochSeconds: number;
  retryAfterSeconds: number;
  tier: RateLimitTier;
  bucket: string;
  clientIp: string;
}

interface RateLimitEntry {
  timestamps: number[];
  windowMs: number;
  updatedAtMs: number;
}

export const MAX_RATE_LIMIT_KEYS = 10_000;
const RATE_LIMIT_STORE_KEY = Symbol.for('liftitup.api.rateLimitStore');

function getRateLimitMap(): Map<string, RateLimitEntry> {
  const g = globalThis as Record<
    symbol,
    Map<string, RateLimitEntry> | undefined
  >;
  if (!g[RATE_LIMIT_STORE_KEY]) {
    g[RATE_LIMIT_STORE_KEY] = new Map<string, RateLimitEntry>();
  }
  return g[RATE_LIMIT_STORE_KEY]!;
}

/**
 * Clears the in-memory rate-limit store. Intended for unit tests.
 */
export function resetRateLimitForTests(): void {
  getRateLimitMap().clear();
}

export function isRateLimitEnabled(): boolean {
  const raw = process.env.RATE_LIMIT_ENABLED;
  if (typeof raw !== 'string') return true;
  const normalized = raw.trim().toLowerCase();
  return normalized !== 'false' && normalized !== '0' && normalized !== 'off';
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (typeof raw !== 'string') return fallback;
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}

function applyTierOverrides(policy: RateLimitPolicy): RateLimitPolicy {
  const prefixMap: Record<RateLimitTier, string> = {
    auth: 'RATE_LIMIT_AUTH',
    sensitive: 'RATE_LIMIT_SENSITIVE',
    expensive: 'RATE_LIMIT_EXPENSIVE',
    mcp: 'RATE_LIMIT_MCP',
    admin: 'RATE_LIMIT_ADMIN',
    general: 'RATE_LIMIT_GENERAL',
  };
  const envPrefix = prefixMap[policy.tier];
  return {
    ...policy,
    limit: readPositiveIntEnv(`${envPrefix}_MAX`, policy.limit),
    windowMs: readPositiveIntEnv(`${envPrefix}_WINDOW_MS`, policy.windowMs),
  };
}

/**
 * Resolves the rate-limit policy for a named API route handler.
 */
export function getRateLimitPolicyForRoute(routeName: string): RateLimitPolicy {
  switch (routeName) {
    case 'auth.login':
      return applyTierOverrides({
        tier: 'auth',
        bucket: 'auth.login',
        limit: 10,
        windowMs: 15 * 60 * 1000,
      });
    case 'auth.register':
      return applyTierOverrides({
        tier: 'auth',
        bucket: 'auth.register',
        limit: 5,
        windowMs: 15 * 60 * 1000,
      });
    case 'auth.changePassword':
      return applyTierOverrides({
        tier: 'auth',
        bucket: 'auth.changePassword',
        limit: 10,
        windowMs: 15 * 60 * 1000,
      });
    case 'auth.guest':
      return applyTierOverrides({
        tier: 'auth',
        bucket: 'auth.guest',
        limit: 10,
        windowMs: 15 * 60 * 1000,
      });
    case 'settings.danger':
    case 'settings.apiKey.regenerate':
      return applyTierOverrides({
        tier: 'sensitive',
        bucket: routeName,
        limit: 15,
        windowMs: 15 * 60 * 1000,
      });
    case 'ai.import':
      return applyTierOverrides({
        tier: 'expensive',
        bucket: 'ai.import',
        limit: 20,
        windowMs: 60 * 1000,
      });
    case 'integrations.appleHealth.post':
    case 'integrations.appleHealth.get':
      return applyTierOverrides({
        tier: 'expensive',
        bucket: 'apple-health',
        limit: 60,
        windowMs: 60 * 1000,
      });
    case 'photos.create':
      return applyTierOverrides({
        tier: 'expensive',
        bucket: 'photos.upload',
        limit: 20,
        windowMs: 60 * 1000,
      });
    case 'photos.archive':
      return applyTierOverrides({
        tier: 'expensive',
        bucket: 'photos.archive',
        limit: 10,
        windowMs: 5 * 60 * 1000,
      });
    case 'photos.signed.get':
      return applyTierOverrides({
        tier: 'expensive',
        bucket: 'photos.signed',
        limit: 60,
        windowMs: 60 * 1000,
      });
    case 'export.get':
      return applyTierOverrides({
        tier: 'expensive',
        bucket: 'export',
        limit: 15,
        windowMs: 60 * 1000,
      });
    case 'imports.liftitup.post':
      return applyTierOverrides({
        tier: 'expensive',
        bucket: 'imports',
        limit: 15,
        windowMs: 60 * 1000,
      });
    case 'mcp.post':
    case 'mcp.get':
      return applyTierOverrides({
        tier: 'mcp',
        bucket: 'mcp',
        limit: 120,
        windowMs: 60 * 1000,
      });
    default:
      if (routeName.startsWith('admin.')) {
        return applyTierOverrides({
          tier: 'admin',
          bucket: routeName,
          limit: 60,
          windowMs: 60 * 1000,
        });
      }
      return applyTierOverrides({
        tier: 'general',
        bucket: 'general',
        limit: 120,
        windowMs: 60 * 1000,
      });
  }
}

function normalizeIpCandidate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Reject values containing whitespace or control chars
  const cleaned = trimmed.replace(/[\r\n\t\s]/g, '').slice(0, 64);
  return cleaned || null;
}

/**
 * Extracts the client IP from reverse-proxy headers (`x-forwarded-for`,
 * `x-real-ip`, `cf-connecting-ip`) or the request object.
 */
export function extractClientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    for (const part of xff.split(',')) {
      const candidate = normalizeIpCandidate(part);
      if (candidate) return candidate;
    }
  }

  const realIp = normalizeIpCandidate(req.headers.get('x-real-ip'));
  if (realIp) return realIp;

  const cfIp = normalizeIpCandidate(req.headers.get('cf-connecting-ip'));
  if (cfIp) return cfIp;

  const directIp = normalizeIpCandidate(
    (req as NextRequest & { ip?: string }).ip,
  );
  if (directIp) return directIp;

  return 'unknown';
}

function pruneAndBoundMap(
  map: Map<string, RateLimitEntry>,
  nowMs: number,
): void {
  if (map.size < MAX_RATE_LIMIT_KEYS) return;

  for (const [key, entry] of map.entries()) {
    const newest = entry.timestamps[entry.timestamps.length - 1];
    if (newest === undefined || newest <= nowMs - entry.windowMs) {
      map.delete(key);
    }
  }

  // If still above cap after removing expired buckets, evict least-recently-used keys
  if (map.size >= MAX_RATE_LIMIT_KEYS) {
    const targetSize = Math.floor(MAX_RATE_LIMIT_KEYS * 0.9);
    for (const key of map.keys()) {
      map.delete(key);
      if (map.size <= targetSize) break;
    }
  }
}

/**
 * Evaluates and updates a sliding-window rate limit bucket for `key`.
 */
export function consumeRateLimit(
  key: string,
  policy: RateLimitPolicy,
  clientIp: string,
  nowMs = Date.now(),
): RateLimitResult {
  const map = getRateLimitMap();
  const cutoff = nowMs - policy.windowMs;
  const existing = map.get(key);
  const active = existing
    ? existing.timestamps.filter((ts) => ts > cutoff)
    : [];

  if (active.length >= policy.limit) {
    const oldest = active[0] ?? nowMs;
    const resetMs = oldest + policy.windowMs;
    const retryAfterSeconds = Math.max(1, Math.ceil((resetMs - nowMs) / 1000));
    const resetEpochSeconds = Math.ceil(resetMs / 1000);

    // Refresh LRU order while preserving active window timestamps
    map.delete(key);
    map.set(key, {
      timestamps: active,
      windowMs: policy.windowMs,
      updatedAtMs: nowMs,
    });

    return {
      allowed: false,
      limit: policy.limit,
      remaining: 0,
      resetEpochSeconds,
      retryAfterSeconds,
      tier: policy.tier,
      bucket: policy.bucket,
      clientIp,
    };
  }

  active.push(nowMs);
  if (!existing) {
    pruneAndBoundMap(map, nowMs);
  }
  map.delete(key);
  map.set(key, {
    timestamps: active,
    windowMs: policy.windowMs,
    updatedAtMs: nowMs,
  });

  const oldest = active[0] ?? nowMs;
  const resetEpochSeconds = Math.ceil((oldest + policy.windowMs) / 1000);

  return {
    allowed: true,
    limit: policy.limit,
    remaining: Math.max(0, policy.limit - active.length),
    resetEpochSeconds,
    retryAfterSeconds: 0,
    tier: policy.tier,
    bucket: policy.bucket,
    clientIp,
  };
}

/**
 * Checks rate limiting for an incoming `NextRequest` and route name.
 * Returns `null` when rate limiting is disabled via `RATE_LIMIT_ENABLED`.
 */
export function checkRequestRateLimit(
  req: NextRequest,
  routeName: string,
  nowMs = Date.now(),
): RateLimitResult | null {
  if (!isRateLimitEnabled()) {
    return null;
  }
  const policy = getRateLimitPolicyForRoute(routeName);
  const clientIp = extractClientIp(req);
  const key = `${policy.bucket}:${clientIp}`;
  return consumeRateLimit(key, policy, clientIp, nowMs);
}

export function buildRateLimitHeaders(
  result: RateLimitResult,
): Record<string, string> {
  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(result.resetEpochSeconds),
  };
  if (!result.allowed) {
    headers['Retry-After'] = String(result.retryAfterSeconds);
  }
  return headers;
}
