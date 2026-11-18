import crypto from 'node:crypto';
import { hashPassword } from '../auth/passwordCore.mjs';

const TEMP_PASSWORD_ALPHABET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/**
 * Generates a high-entropy 20-character temporary password (~116 bits of entropy)
 * using unambiguous alphanumeric characters safe for terminals and copy/paste.
 */
export function generateTemporaryPassword(length = 20) {
  const bytes = crypto.randomBytes(length * 2);
  let out = '';
  let idx = 0;
  const maxByte = 256 - (256 % TEMP_PASSWORD_ALPHABET.length);
  while (out.length < length) {
    const b = idx < bytes.length ? bytes[idx++] : crypto.randomBytes(1)[0];
    if (b < maxByte) {
      out += TEMP_PASSWORD_ALPHABET[b % TEMP_PASSWORD_ALPHABET.length];
    }
  }
  return out;
}

export class PasswordResetError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PasswordResetError';
    this.code = code;
  }
}

/**
 * Core shared password-reset implementation used by both the CLI script
 * (`scripts/reset-password.mjs`) and the TypeScript admin service
 * (`src/lib/admin/passwordReset.ts` / Phase 11 MCP).
 *
 * Inside the caller's transaction:
 * - Rejects missing users and guest accounts
 * - Generates a temporary password and hashes it with scrypt (`hashPassword`)
 * - Updates `users.password_hash` and sets `must_change_password = 1`
 * - Revokes all active sessions in `auth_sessions`
 * - Writes an immutable `audit_log` entry and a `password_reset` event
 */
export async function resetUserPasswordInTx(tx, input) {
  const rawIdentifier = String(input.identifier ?? '').trim();
  if (!rawIdentifier) {
    throw new PasswordResetError('VALIDATION', 'Target user identifier is required');
  }

  const byId = input.lookupBy === 'id';
  const lookupSql = byId
    ? 'SELECT id, username, is_guest FROM users WHERE id = $1'
    : 'SELECT id, username, is_guest FROM users WHERE lower(username) = $1';
  const lookupParam = byId ? rawIdentifier : rawIdentifier.toLowerCase();

  const userRes = await tx.query(lookupSql, [lookupParam]);
  const user = userRes.rows[0];
  if (!user) {
    throw new PasswordResetError('NOT_FOUND', `User not found: ${rawIdentifier}`);
  }
  if (Boolean(user.is_guest)) {
    throw new PasswordResetError(
      'GUEST_FORBIDDEN',
      'Cannot reset password for a guest sandbox account',
    );
  }

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  const now = new Date().toISOString();

  await tx.query(
    'UPDATE users SET password_hash = $1, must_change_password = 1 WHERE id = $2',
    [passwordHash, user.id],
  );

  const delRes = await tx.query(
    'DELETE FROM auth_sessions WHERE user_id = $1',
    [user.id],
  );
  const revokedSessions = Number(delRes.rowCount ?? 0);

  const auditId = `aud_${crypto.randomUUID()}`;
  const source = input.source === 'mcp' ? 'mcp' : 'cli';
  const actorUserId = input.actorUserId ?? null;
  const actorLabel = String(input.actorLabel || source);
  const reason = input.reason ? String(input.reason).trim() : null;
  const extraDetail =
    input.auditDetail &&
    typeof input.auditDetail === 'object' &&
    !Array.isArray(input.auditDetail)
      ? input.auditDetail
      : {};
  const detailJson = JSON.stringify({ revokedSessions, ...extraDetail });

  await tx.query(
    `
    INSERT INTO audit_log (
      id, actor_user_id, actor_label, source, action,
      target_user_id, reason, detail_json, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [
      auditId,
      actorUserId,
      actorLabel,
      source,
      'password_reset',
      user.id,
      reason,
      detailJson,
      now,
    ],
  );

  await tx.query(
    `
    INSERT INTO events (id, user_id, event_type, detail_json, created_at)
    VALUES ($1, $2, $3, $4, $5)
    `,
    [
      `evt_${crypto.randomUUID()}`,
      user.id,
      'password_reset',
      JSON.stringify({ source }),
      now,
    ],
  );

  return {
    userId: user.id,
    username: user.username,
    temporaryPassword,
    revokedSessions,
    auditId,
    resetAt: now,
  };
}
