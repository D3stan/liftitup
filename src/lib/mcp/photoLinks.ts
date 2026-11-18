import crypto from 'node:crypto';

export const SIGNED_PHOTO_TTL_MS = 5 * 60 * 1000;
export const MAX_PHOTOS_PER_MCP_CALL = 5;
export const PHOTO_LINK_RATE_WINDOW_MS = 15 * 60 * 1000;
export const PHOTO_LINK_RATE_MAX = 20;

const TOKEN_VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MAC_BYTES = 32;
const HEADER_BYTES = 1 + IV_BYTES + TAG_BYTES + MAC_BYTES;

const RATE_LIMIT_KEY = Symbol.for('liftitup.mcp.photoLinkRateLimit');

function getRateLimitMap(): Map<string, number[]> {
  const g = globalThis as Record<symbol, Map<string, number[]> | undefined>;
  if (!g[RATE_LIMIT_KEY]) {
    g[RATE_LIMIT_KEY] = new Map<string, number[]>();
  }
  return g[RATE_LIMIT_KEY]!;
}

export function resetPhotoLinkRateLimitForTests(): void {
  getRateLimitMap().clear();
}

/**
 * Returns the configured `PHOTO_DOWNLOAD_SECRET` or `null` when missing/blank.
 * Never falls back to a hardcoded secret.
 */
export function getPhotoDownloadSecret(): string | null {
  const raw = process.env.PHOTO_DOWNLOAD_SECRET;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function deriveKeys(secret: string): { encKey: Buffer; macKey: Buffer } {
  const encKey = crypto
    .createHash('sha256')
    .update(`liftitup:photo-enc-v1:${secret}`)
    .digest();
  const macKey = crypto
    .createHash('sha256')
    .update(`liftitup:photo-mac-v1:${secret}`)
    .digest();
  return { encKey, macKey };
}

export interface SignedPhotoPayload {
  photoId: string;
  userId: string;
  expiresAtMs: number;
}

/**
 * Enforces a per-user sliding-window rate limit for MCP photo download link issuance.
 */
export function consumePhotoLinkRateLimit(
  userId: string,
  requestedCount: number,
  nowMs = Date.now(),
): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
  const map = getRateLimitMap();
  const cutoff = nowMs - PHOTO_LINK_RATE_WINDOW_MS;
  const existing = (map.get(userId) ?? []).filter((ts) => ts > cutoff);

  if (existing.length + requestedCount > PHOTO_LINK_RATE_MAX) {
    const oldest = existing[0] ?? nowMs;
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((oldest + PHOTO_LINK_RATE_WINDOW_MS - nowMs) / 1000),
    );
    map.set(userId, existing);
    return {
      allowed: false,
      remaining: Math.max(0, PHOTO_LINK_RATE_MAX - existing.length),
      retryAfterSeconds,
    };
  }

  for (let i = 0; i < requestedCount; i += 1) {
    existing.push(nowMs);
  }
  if (map.size > 10_000) {
    map.clear();
  }
  map.set(userId, existing);
  return {
    allowed: true,
    remaining: Math.max(0, PHOTO_LINK_RATE_MAX - existing.length),
    retryAfterSeconds: 0,
  };
}

/**
 * Mints an opaque, unguessable, HMAC-authenticated & encrypted download token
 * bound to a single `(userId, photoId)` with a short expiry.
 * Reveals nothing about `userId` or `photoId` in the URL token.
 */
export function createSignedPhotoToken(
  userId: string,
  photoId: string,
  nowMs = Date.now(),
): { token: string; expiresAt: string; expiresAtMs: number } {
  const secret = getPhotoDownloadSecret();
  if (!secret) {
    throw new Error(
      'Photo download links are unavailable because PHOTO_DOWNLOAD_SECRET is not configured.',
    );
  }

  const expiresAtMs = nowMs + SIGNED_PHOTO_TTL_MS;
  const { encKey, macKey } = deriveKeys(secret);
  const iv = crypto.randomBytes(IV_BYTES);
  const nonce = crypto.randomBytes(12).toString('base64url');
  const plaintext = Buffer.from(
    JSON.stringify({
      p: photoId,
      u: userId,
      e: expiresAtMs,
      n: nonce,
    }),
    'utf8',
  );

  const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const macInput = Buffer.concat([
    Buffer.from([TOKEN_VERSION]),
    iv,
    authTag,
    ciphertext,
  ]);
  const hmac = crypto.createHmac('sha256', macKey).update(macInput).digest();

  const packed = Buffer.concat([
    Buffer.from([TOKEN_VERSION]),
    iv,
    authTag,
    hmac,
    ciphertext,
  ]);

  return {
    token: packed.toString('base64url'),
    expiresAt: new Date(expiresAtMs).toISOString(),
    expiresAtMs,
  };
}

/**
 * Verifies an opaque signed photo download token against `PHOTO_DOWNLOAD_SECRET`.
 * Returns `null` if secret is unset, token is malformed, HMAC/tag fails, or expired.
 */
export function verifySignedPhotoToken(
  token: string,
  nowMs = Date.now(),
): SignedPhotoPayload | null {
  const secret = getPhotoDownloadSecret();
  if (!secret) return null;

  if (!token || !/^[A-Za-z0-9_-]+$/.test(token)) {
    return null;
  }

  let buf: Buffer;
  try {
    buf = Buffer.from(token, 'base64url');
  } catch {
    return null;
  }

  if (buf.byteLength < HEADER_BYTES + 2) {
    return null;
  }
  if (buf[0] !== TOKEN_VERSION) {
    return null;
  }

  const ivStart = 1;
  const tagStart = ivStart + IV_BYTES;
  const macStart = tagStart + TAG_BYTES;
  const ctStart = macStart + MAC_BYTES;

  const iv = buf.subarray(ivStart, tagStart);
  const authTag = buf.subarray(tagStart, macStart);
  const providedMac = buf.subarray(macStart, ctStart);
  const ciphertext = buf.subarray(ctStart);

  const { encKey, macKey } = deriveKeys(secret);
  const macInput = Buffer.concat([
    Buffer.from([TOKEN_VERSION]),
    iv,
    authTag,
    ciphertext,
  ]);
  const expectedMac = crypto.createHmac('sha256', macKey).update(macInput).digest();

  if (
    providedMac.byteLength !== expectedMac.byteLength ||
    !crypto.timingSafeEqual(providedMac, expectedMac)
  ) {
    return null;
  }

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', encKey, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    const parsed = JSON.parse(decrypted.toString('utf8')) as {
      p?: unknown;
      u?: unknown;
      e?: unknown;
    };
    if (
      typeof parsed.p !== 'string' ||
      !parsed.p ||
      typeof parsed.u !== 'string' ||
      !parsed.u ||
      typeof parsed.e !== 'number' ||
      !Number.isFinite(parsed.e)
    ) {
      return null;
    }
    if (nowMs > parsed.e) {
      return null;
    }
    return {
      photoId: parsed.p,
      userId: parsed.u,
      expiresAtMs: parsed.e,
    };
  } catch {
    return null;
  }
}

export function buildSignedPhotoUrl(
  token: string,
  origin?: string | null,
): { path: string; url: string } {
  const path = `/api/photos/signed/${token}`;
  const rawBase =
    process.env.NEXT_PUBLIC_APP_URL?.trim() || origin?.trim() || '';
  const base = rawBase.replace(/\/+$/, '');
  return {
    path,
    url: base ? `${base}${path}` : path,
  };
}
