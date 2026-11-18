import { ApiError } from '@/lib/api/handler';
import { query, withTransaction } from '@/lib/db/connection';
import {
  generateTemporaryPassword,
  PasswordResetError,
  resetUserPasswordInTx,
} from './passwordResetCore.mjs';

export interface ResetUserPasswordResult {
  userId: string;
  username: string;
  temporaryPassword: string;
  revokedSessions: number;
  auditId: string;
  resetAt: string;
}

export { generateTemporaryPassword };

/**
 * Shared password reset service used by Phase 10 tests and Phase 11 admin MCP tools.
 * Delegates the transactional update, session revocation, and audit_log write to
 * `passwordResetCore.mjs` (the exact same implementation used by `scripts/reset-password.mjs`).
 */
export async function resetUserPassword(input: {
  targetUserId?: string;
  username?: string;
  source: 'cli' | 'mcp';
  actorUserId?: string | null;
  actorLabel: string;
  reason?: string | null;
  auditDetail?: Record<string, unknown>;
}): Promise<ResetUserPasswordResult> {
  const identifier = input.targetUserId ?? input.username ?? '';
  const lookupBy = input.targetUserId ? 'id' : 'username';

  try {
    return (await withTransaction(async () =>
      resetUserPasswordInTx(
        {
          query: (sql: string, params?: unknown[]) => query(sql, params),
        },
        {
          identifier,
          lookupBy,
          source: input.source,
          actorUserId: input.actorUserId ?? null,
          actorLabel: input.actorLabel,
          reason: input.reason ?? null,
          auditDetail: input.auditDetail,
        },
      ),
    )) as ResetUserPasswordResult;
  } catch (err) {
    if (err instanceof PasswordResetError) {
      if (err.code === 'NOT_FOUND') {
        throw ApiError.notFound(err.message);
      }
      throw ApiError.validation(err.message);
    }
    throw err;
  }
}
