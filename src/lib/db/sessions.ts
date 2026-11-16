import crypto from 'node:crypto';
import type { ApiKeyInfo, UserProfile } from '@/types/domain';
import { query, queryOne } from './connection';
import { mapUserRow } from './users';

type DbAuthSessionRow = {
  token_hash: string;
  user_id: string;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
};

type DbApiKeyRow = {
  id: string;
  user_id: string;
  key_hash: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
};

export interface AuthSessionRecord {
  tokenHash: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
}

function mapApiKeyRow(row: DbApiKeyRow): ApiKeyInfo {
  return {
    id: row.id,
    userId: row.user_id,
    keyPrefix: row.key_prefix,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

export async function createAuthSession(
  userId: string,
  tokenHash: string,
  expiresAt: string,
): Promise<AuthSessionRecord> {
  const now = new Date().toISOString();
  await query(
    `
    INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at, last_seen_at)
    VALUES ($1, $2, $3, $4, $5)
    `,
    [tokenHash, userId, now, expiresAt, now],
  );

  return {
    tokenHash,
    userId,
    createdAt: now,
    expiresAt,
    lastSeenAt: now,
  };
}

export async function getAuthSessionByTokenHash(
  tokenHash: string,
): Promise<AuthSessionRecord | null> {
  const row = await queryOne<DbAuthSessionRow>(
    'SELECT * FROM auth_sessions WHERE token_hash = $1',
    [tokenHash],
  );
  if (!row) return null;
  return {
    tokenHash: row.token_hash,
    userId: row.user_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
  };
}

export async function touchAuthSession(
  tokenHash: string,
  newExpiresAt: string,
): Promise<void> {
  const now = new Date().toISOString();
  await query(
    'UPDATE auth_sessions SET last_seen_at = $1, expires_at = $2 WHERE token_hash = $3',
    [now, newExpiresAt, tokenHash],
  );
}

export interface ActiveAuthSessionSummary {
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
}

export async function deleteAuthSession(tokenHash: string): Promise<void> {
  await query('DELETE FROM auth_sessions WHERE token_hash = $1', [tokenHash]);
}

export async function deleteAuthSessionsByUserId(
  userId: string,
): Promise<number> {
  const res = await query('DELETE FROM auth_sessions WHERE user_id = $1', [
    userId,
  ]);
  return Number(res.rowCount ?? 0);
}

export async function listActiveAuthSessionsForUser(
  userId: string,
  nowIso = new Date().toISOString(),
): Promise<ActiveAuthSessionSummary[]> {
  // Never select token_hash; return only non-expired session timestamps.
  const res = await query<{
    created_at: string;
    expires_at: string;
    last_seen_at: string;
  }>(
    `SELECT created_at, expires_at, last_seen_at
     FROM auth_sessions
     WHERE user_id = $1 AND expires_at > $2
     ORDER BY last_seen_at DESC, created_at DESC`,
    [userId, nowIso],
  );
  return res.rows.map((r) => ({
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    lastSeenAt: r.last_seen_at,
  }));
}

export async function deleteApiKeyByUserId(userId: string): Promise<boolean> {
  const res = await query('DELETE FROM api_keys WHERE user_id = $1', [userId]);
  return Number(res.rowCount ?? 0) > 0;
}

export async function getApiKeyByUserId(
  userId: string,
): Promise<ApiKeyInfo | null> {
  const row = await queryOne<DbApiKeyRow>(
    'SELECT * FROM api_keys WHERE user_id = $1',
    [userId],
  );
  return row ? mapApiKeyRow(row) : null;
}

export async function upsertApiKey(
  userId: string,
  keyHash: string,
  keyPrefix: string,
): Promise<ApiKeyInfo> {
  const id = `key_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  const row = await queryOne<DbApiKeyRow>(
    `
    INSERT INTO api_keys (id, user_id, key_hash, key_prefix, created_at, last_used_at)
    VALUES ($1, $2, $3, $4, $5, NULL)
    ON CONFLICT (user_id) DO UPDATE SET
      id = EXCLUDED.id,
      key_hash = EXCLUDED.key_hash,
      key_prefix = EXCLUDED.key_prefix,
      created_at = EXCLUDED.created_at,
      last_used_at = NULL
    RETURNING *
    `,
    [id, userId, keyHash, keyPrefix, now],
  );

  return mapApiKeyRow(row!);
}

export async function getUserByApiKeyHash(
  keyHash: string,
): Promise<{ user: UserProfile; apiKeyId: string; apiKeyPrefix: string } | null> {
  const row = await queryOne<
    Parameters<typeof mapUserRow>[0] & {
      _api_key_id: string;
      _api_key_prefix: string;
    }
  >(
    `
    SELECT u.*, k.id AS _api_key_id, k.key_prefix AS _api_key_prefix
    FROM api_keys k
    JOIN users u ON u.id = k.user_id
    WHERE k.key_hash = $1
    `,
    [keyHash],
  );

  if (!row) return null;
  const apiKeyId = row._api_key_id;
  const apiKeyPrefix = row._api_key_prefix;
  return {
    user: mapUserRow(row),
    apiKeyId,
    apiKeyPrefix,
  };
}

export async function touchApiKeyLastUsed(apiKeyId: string): Promise<void> {
  const now = new Date();
  const nowIso = now.toISOString();
  const thresholdIso = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
  await query(
    'UPDATE api_keys SET last_used_at = $1 WHERE id = $2 AND (last_used_at IS NULL OR last_used_at < $3)',
    [nowIso, apiKeyId, thresholdIso],
  );
}
