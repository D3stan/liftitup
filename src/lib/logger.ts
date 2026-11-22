import crypto from 'node:crypto';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogFields {
  requestId?: string;
  route?: string;
  method?: string;
  userId?: string | null;
  status?: number;
  durationMs?: number;
  err?: unknown;
  [key: string]: unknown;
}

export function generateRequestId(): string {
  return `req_${crypto.randomBytes(8).toString('hex')}`;
}

/**
 * Redacts API keys, URL `?token=` query params, Bearer headers, DB URLs,
 * and password hashes so secrets never appear in plain-text logs.
 */
export function redactSensitiveText(input: string): string {
  return input
    .replace(/liuk_[a-zA-Z0-9_-]+/g, 'liuk_***')
    .replace(/([?&](?:token|api_key|apikey|key|secret|password)=)[^&\s"'#]+/gi, '$1***')
    .replace(/(Bearer\s+)\S+/gi, '$1***')
    .replace(/(postgres(?:ql)?:\/\/)\S+/gi, '$1***')
    .replace(/scrypt:[0-9a-f:]+/gi, 'scrypt:***');
}

function sanitizeLogValue(
  value: unknown,
  seen = new WeakSet<object>(),
  depth = 0,
): unknown {
  if (typeof value === 'string') {
    return redactSensitiveText(value);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (depth >= 6) {
    return '[MaxDepth]';
  }
  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeLogValue(item, seen, depth + 1));
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Error) {
    return serializeError(value);
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = sanitizeLogValue(v, seen, depth + 1);
  }
  return out;
}

export function serializeError(err: unknown): Record<string, unknown> | undefined {
  if (err === undefined || err === null) return undefined;
  if (err instanceof Error) {
    const out: Record<string, unknown> = {
      name: err.name,
      message: redactSensitiveText(err.message),
    };
    if (err.stack) out.stack = redactSensitiveText(err.stack);
    const anyErr = err as Error & { code?: unknown; status?: unknown };
    if (anyErr.code !== undefined) out.code = anyErr.code;
    if (anyErr.status !== undefined) out.status = anyErr.status;
    return out;
  }
  if (typeof err === 'object') {
    return sanitizeLogValue(err) as Record<string, unknown>;
  }
  return { message: redactSensitiveText(String(err)) };
}

function emit(level: LogLevel, msg: string, fields: LogFields = {}): void {
  const { err, ...rest } = fields;
  const sanitizedRest = sanitizeLogValue(rest) as Record<string, unknown>;
  const payload: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    ...sanitizedRest,
    msg: redactSensitiveText(msg),
  };
  if (err !== undefined) {
    payload.err = serializeError(err);
  }
  const line = JSON.stringify(payload);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug(msg: string, fields?: LogFields): void {
    if (process.env.LOG_LEVEL === 'debug' || process.env.NODE_ENV !== 'production') {
      emit('debug', msg, fields);
    }
  },
  info(msg: string, fields?: LogFields): void {
    emit('info', msg, fields);
  },
  warn(msg: string, fields?: LogFields): void {
    emit('warn', msg, fields);
  },
  error(msg: string, fields?: LogFields): void {
    emit('error', msg, fields);
  },
};
