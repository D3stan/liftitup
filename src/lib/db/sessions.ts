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

export async function deleteAuthSession(tokenHash: string): Promise<void> {
  await query('DELETE FROM auth_sessions WHERE token_hash = $1', [tokenHash]);
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
): Promise<{ user: UserProfile; apiKeyId: string } | null> {
  const row = await queryOne<
    Parameters<typeof mapUserRow>[0] & { _api_key_id: string }
  >(
    `
    SELECT u.*, k.id AS _api_key_id
    FROM api_keys k
    JOIN users u ON u.id = k.user_id
    WHERE k.key_hash = $1
    `,
    [keyHash],
  );

  if (!row) return null;
  const apiKeyId = row._api_key_id;
  return {
    user: mapUserRow(row),
    apiKeyId,
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
