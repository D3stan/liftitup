import { NextRequest, NextResponse } from 'next/server';
import { recordRequestMetric } from '@/lib/admin/metrics';
import { generateRequestId, logger, type LogFields } from '@/lib/logger';

export interface StandardErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message: string, details?: unknown): ApiError {
    return new ApiError(400, 'BAD_REQUEST', message, details);
  }

  static validation(message: string, details?: unknown): ApiError {
    return new ApiError(400, 'VALIDATION_ERROR', message, details);
  }

  static unauthorized(message = 'Authentication required'): ApiError {
    return new ApiError(401, 'UNAUTHORIZED', message);
  }

  static forbidden(message = 'Forbidden'): ApiError {
    return new ApiError(403, 'FORBIDDEN', message);
  }

  static notFound(message = 'Resource not found'): ApiError {
    return new ApiError(404, 'NOT_FOUND', message);
  }

  static conflict(message: string, details?: unknown): ApiError {
    return new ApiError(409, 'CONFLICT', message, details);
  }

  static methodNotAllowed(message = 'Method not allowed'): ApiError {
    return new ApiError(405, 'METHOD_NOT_ALLOWED', message);
  }

  static payloadTooLarge(message = 'Payload too large'): ApiError {
    return new ApiError(413, 'PAYLOAD_TOO_LARGE', message);
  }

  static internal(message = 'Internal server error'): ApiError {
    return new ApiError(500, 'INTERNAL_ERROR', message);
  }
}

export interface ApiHandlerContext<TParams = Record<string, string>> {
  requestId: string;
  params: TParams;
  setUserId: (userId: string | null) => void;
  log: {
    info: (msg: string, extra?: LogFields) => void;
    warn: (msg: string, extra?: LogFields) => void;
    error: (msg: string, err?: unknown, extra?: LogFields) => void;
  };
}

export interface RouteSegmentContext<TParams = Record<string, string>> {
  params: Promise<TParams>;
}

/**
 * Wraps a Next.js App Router API handler with request-id generation,
 * structured JSON logging, and standardized error serialization.
 */
export function withApiHandler<TParams = Record<string, string>>(
  routeName: string,
  fn: (req: NextRequest, ctx: ApiHandlerContext<TParams>) => Promise<Response> | Response,
) {
  return async (
    req: NextRequest,
    segmentContext: RouteSegmentContext<TParams>,
  ): Promise<Response> => {
    const requestId = generateRequestId();
    const startedAt = performance.now();
    const method = req.method;
    let userId: string | null = null;

    const baseFields = (): LogFields => ({
      requestId,
      route: routeName,
      method,
      userId,
    });

    const ctx: ApiHandlerContext<TParams> = {
      requestId,
      params: segmentContext?.params ? await segmentContext.params : ({} as TParams),
      setUserId: (id) => {
        userId = id;
      },
      log: {
        info: (msg, extra) => logger.info(msg, { ...baseFields(), ...extra }),
        warn: (msg, extra) => logger.warn(msg, { ...baseFields(), ...extra }),
        error: (msg, err, extra) =>
          logger.error(msg, { ...baseFields(), err, ...extra }),
      },
    };

    try {
      const response = await fn(req, ctx);
      const durationMs = Math.round(performance.now() - startedAt);
      const status = response.status;

      try {
        response.headers.set('x-request-id', requestId);
      } catch {
        // Some synthetic responses may have immutable headers
      }

      recordRequestMetric({
        route: routeName,
        method,
        status,
        durationMs,
        requestId,
        ...(status >= 500
          ? { errorCode: `HTTP_${status}`, errorMessage: `HTTP ${status} on ${routeName}` }
          : {}),
      });

      if (status >= 500) {
        logger.error('request completed with server error', {
          ...baseFields(),
          status,
          durationMs,
        });
      } else if (status >= 400) {
        logger.warn('request completed with client error', {
          ...baseFields(),
          status,
          durationMs,
        });
      } else {
        logger.info('request completed', {
          ...baseFields(),
          status,
          durationMs,
        });
      }

      return response;
    } catch (err) {
      const durationMs = Math.round(performance.now() - startedAt);

      if (err instanceof ApiError) {
        recordRequestMetric({
          route: routeName,
          method,
          status: err.status,
          durationMs,
          requestId,
          ...(err.status >= 500
            ? { errorCode: err.code, errorMessage: err.message }
            : {}),
        });
        const body: StandardErrorBody = {
          error: {
            code: err.code,
            message: err.message,
            ...(err.details !== undefined ? { details: err.details } : {}),
          },
          requestId,
        };
        const logFn = err.status >= 500 ? logger.error : logger.warn;
        logFn(err.message, {
          ...baseFields(),
          status: err.status,
          durationMs,
          ...(err.status >= 500 ? { err } : {}),
        });
        return NextResponse.json(body, {
          status: err.status,
          headers: { 'x-request-id': requestId },
        });
      }

      recordRequestMetric({
        route: routeName,
        method,
        status: 500,
        durationMs,
        requestId,
        errorCode: 'INTERNAL_ERROR',
        errorMessage: err instanceof Error ? err.message : String(err),
      });

      logger.error('unhandled route error', {
        ...baseFields(),
        status: 500,
        durationMs,
        err,
      });

      const body: StandardErrorBody = {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error',
        },
        requestId,
      };
      return NextResponse.json(body, {
        status: 500,
        headers: { 'x-request-id': requestId },
      });
    }
  };
}

/**
 * Parses a JSON request body and converts syntax/empty-body errors into 400 ApiError.
 */
export async function parseJsonBody<T = Record<string, unknown>>(
  req: NextRequest,
): Promise<T> {
  try {
    const parsed = (await req.json()) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw ApiError.badRequest('Request body must be a JSON object');
    }
    return parsed as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw ApiError.badRequest('Invalid JSON request body');
  }
}
