export interface PasswordResetTxExecutor {
  query: (
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number | null }>;
}

export interface ResetUserPasswordCoreInput {
  identifier: string;
  lookupBy: 'id' | 'username';
  source: 'cli' | 'mcp';
  actorUserId?: string | null;
  actorLabel?: string;
  reason?: string | null;
}

export interface ResetUserPasswordResult {
  userId: string;
  username: string;
  temporaryPassword: string;
  revokedSessions: number;
  auditId: string;
  resetAt: string;
}

export class PasswordResetError extends Error {
  readonly code: 'VALIDATION' | 'NOT_FOUND' | 'GUEST_FORBIDDEN';
  constructor(
    code: 'VALIDATION' | 'NOT_FOUND' | 'GUEST_FORBIDDEN',
    message: string,
  );
}

export function generateTemporaryPassword(length?: number): string;

export function resetUserPasswordInTx(
  tx: PasswordResetTxExecutor,
  input: ResetUserPasswordCoreInput,
): Promise<ResetUserPasswordResult>;
