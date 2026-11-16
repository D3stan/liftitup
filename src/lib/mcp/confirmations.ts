import crypto from 'node:crypto';
import { query, queryOne, withTransaction } from '@/lib/db/connection';
import { wrapToolResult, type McpToolResult } from './types';

export const MCP_CONFIRMATION_TTL_MS = 5 * 60 * 1000;

function canonicalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) =>
      item === undefined ? null : canonicalizeValue(item),
    );
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const v = record[key];
      if (v !== undefined) {
        out[key] = canonicalizeValue(v);
      }
    }
    return out;
  }
  return value;
}

export function hashConfirmationPayload(payload: unknown): string {
  const canonical = JSON.stringify(canonicalizeValue(payload));
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

export interface ConfirmationRequestInput {
  userId: string;
  apiKeyId: string;
  action: string;
  target: string;
  payload: unknown;
  confirmationToken?: unknown;
  description: string;
  summary?: Record<string, unknown>;
  warning?: string;
}

export type ConfirmationGateOutcome =
  | { confirmed: true }
  | { confirmed: false; response: McpToolResult };

/**
 * Enforces two-step single-use confirmation for destructive MCP tools.
 * - Without `confirmationToken`: creates a short-lived (5 min) token bound to
 *   `(userId, apiKeyId, action, target, payloadHash)` and returns a descriptive challenge.
 * - With `confirmationToken`: atomically consumes the token in `mcp_confirmations`
 *   only if unused, unexpired, and matching all 5 bindings.
 */
export async function requireTwoStepConfirmation(
  input: ConfirmationRequestInput,
): Promise<ConfirmationGateOutcome> {
  const payloadHash = hashConfirmationPayload(input.payload);
  const rawToken =
    typeof input.confirmationToken === 'string'
      ? input.confirmationToken.trim()
      : '';

  if (!rawToken) {
    if (
      input.confirmationToken !== undefined &&
      input.confirmationToken !== null
    ) {
      return {
        confirmed: false,
        response: wrapToolResult(
          { error: 'confirmationToken must be a non-empty string' },
          true,
        ),
      };
    }

    const nowMs = Date.now();
    const createdAt = new Date(nowMs).toISOString();
    const expiresAt = new Date(nowMs + MCP_CONFIRMATION_TTL_MS).toISOString();
    const token = `mcpc_${crypto.randomBytes(24).toString('base64url')}`;

    await query(
      `INSERT INTO mcp_confirmations (
         token, user_id, api_key_id, action, target, payload_hash,
         expires_at, used_at, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8)`,
      [
        token,
        input.userId,
        input.apiKeyId,
        input.action,
        input.target,
        payloadHash,
        expiresAt,
        createdAt,
      ],
    );

    return {
      confirmed: false,
      response: wrapToolResult(
        {
          requiresConfirmation: true,
          confirmationToken: token,
          expiresAt,
          expiresInSeconds: Math.floor(MCP_CONFIRMATION_TTL_MS / 1000),
          action: input.action,
          target: input.target,
          description: input.description,
          ...(input.warning ? { warning: input.warning } : {}),
          ...(input.summary ? { summary: input.summary } : {}),
          instruction:
            'Confirmation required. Review what will happen and re-call this exact tool with the same parameters plus confirmationToken.',
        },
        false,
      ),
    };
  }

  const nowIso = new Date().toISOString();

  const verificationError = await withTransaction(async (): Promise<string | null> => {
    const consumed = await queryOne<{ token: string }>(
      `UPDATE mcp_confirmations
       SET used_at = $1
       WHERE token = $2
         AND user_id = $3
         AND api_key_id = $4
         AND action = $5
         AND target = $6
         AND payload_hash = $7
         AND used_at IS NULL
         AND expires_at > $1
       RETURNING token`,
      [
        nowIso,
        rawToken,
        input.userId,
        input.apiKeyId,
        input.action,
        input.target,
        payloadHash,
      ],
    );

    if (consumed) {
      return null;
    }

    const existing = await queryOne<{
      user_id: string;
      api_key_id: string;
      action: string;
      target: string;
      payload_hash: string;
      expires_at: string;
      used_at: string | null;
    }>(
      `SELECT user_id, api_key_id, action, target, payload_hash, expires_at, used_at
       FROM mcp_confirmations
       WHERE token = $1 AND user_id = $2`,
      [rawToken, input.userId],
    );

    if (!existing) {
      return 'Invalid confirmation token';
    }
    if (existing.used_at !== null) {
      return 'Confirmation token has already been used';
    }
    if (existing.expires_at <= nowIso) {
      return 'Confirmation token has expired; request a new confirmation';
    }
    if (existing.api_key_id !== input.apiKeyId) {
      return 'Confirmation token is bound to a different API key';
    }
    if (existing.action !== input.action) {
      return 'Confirmation token was issued for a different action';
    }
    if (
      existing.target !== input.target ||
      existing.payload_hash !== payloadHash
    ) {
      return 'Confirmation token does not match the target or parameters';
    }
    return 'Confirmation token could not be verified';
  });

  if (verificationError) {
    return {
      confirmed: false,
      response: wrapToolResult({ error: verificationError }, true),
    };
  }

  return { confirmed: true };
}
