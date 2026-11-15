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

export function serializeError(err: unknown): Record<string, unknown> | undefined {
  if (err === undefined || err === null) return undefined;
  if (err instanceof Error) {
    const out: Record<string, unknown> = {
      name: err.name,
      message: err.message,
    };
    if (err.stack) out.stack = err.stack;
    const anyErr = err as Error & { code?: unknown; status?: unknown };
    if (anyErr.code !== undefined) out.code = anyErr.code;
    if (anyErr.status !== undefined) out.status = anyErr.status;
    return out;
  }
  if (typeof err === 'object') {
    return err as Record<string, unknown>;
  }
  return { message: String(err) };
}

function emit(level: LogLevel, msg: string, fields: LogFields = {}): void {
  const { err, ...rest } = fields;
  const payload: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    ...rest,
    msg,
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
