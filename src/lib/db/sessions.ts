import crypto from 'node:crypto';
import type { ApiKeyInfo, UserProfile } from '@/types/domain';
import { getDb } from './connection';
import { mapUserRow } from './users';

interface DbAuthSessionRow {
  token_hash: string;
  user_id: string;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
}

interface DbApiKeyRow {
  id: string;
  user_id: string;
  key_hash: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
}

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

export function createAuthSession(
  userId: string,
  tokenHash: string,
  expiresAt: string,
): AuthSessionRecord {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(tokenHash, userId, now, expiresAt, now);

  return {
    tokenHash,
    userId,
    createdAt: now,
    expiresAt,
    lastSeenAt: now,
  };
}

export function getAuthSessionByTokenHash(
  tokenHash: string,
): AuthSessionRecord | null {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM auth_sessions WHERE token_hash = ?')
    .get(tokenHash) as DbAuthSessionRow | undefined;
  if (!row) return null;
  return {
    tokenHash: row.token_hash,
    userId: row.user_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
  };
}

export function touchAuthSession(tokenHash: string, newExpiresAt: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    'UPDATE auth_sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?',
  ).run(now, newExpiresAt, tokenHash);
}

export function deleteAuthSession(tokenHash: string): void {
  const db = getDb();
  db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(tokenHash);
}

export function deleteUserAuthSessions(userId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(userId);
}

export function getApiKeyByUserId(userId: string): ApiKeyInfo | null {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM api_keys WHERE user_id = ?')
    .get(userId) as DbApiKeyRow | undefined;
  return row ? mapApiKeyRow(row) : null;
}

export function upsertApiKey(
  userId: string,
  keyHash: string,
  keyPrefix: string,
): ApiKeyInfo {
  const db = getDb();
  const id = `key_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO api_keys (id, user_id, key_hash, key_prefix, created_at, last_used_at)
    VALUES (?, ?, ?, ?, ?, NULL)
    ON CONFLICT(user_id) DO UPDATE SET
      id = excluded.id,
      key_hash = excluded.key_hash,
      key_prefix = excluded.key_prefix,
      created_at = excluded.created_at,
      last_used_at = NULL
  `).run(id, userId, keyHash, keyPrefix, now);

  return getApiKeyByUserId(userId)!;
}

export function getUserByApiKeyHash(
  keyHash: string,
): { user: UserProfile; apiKeyId: string } | null {
  const db = getDb();
  const row = db
    .prepare(`
      SELECT u.*, k.id AS _api_key_id
      FROM api_keys k
      JOIN users u ON u.id = k.user_id
      WHERE k.key_hash = ?
    `)
    .get(keyHash) as (Parameters<typeof mapUserRow>[0] & { _api_key_id: string }) | undefined;

  if (!row) return null;
  const apiKeyId = row._api_key_id;
  return {
    user: mapUserRow(row),
    apiKeyId,
  };
}

export function touchApiKeyLastUsed(apiKeyId: string): void {
  const db = getDb();
  const now = new Date();
  const nowIso = now.toISOString();
  const thresholdIso = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
  db.prepare(
    'UPDATE api_keys SET last_used_at = ? WHERE id = ? AND (last_used_at IS NULL OR last_used_at < ?)',
  ).run(nowIso, apiKeyId, thresholdIso);
}
