export interface StandardErrorPayload {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
  message?: string;
  requestId?: string;
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;
  readonly details?: unknown;

  constructor(
    message: string,
    status: number,
    code = 'REQUEST_FAILED',
    requestId?: string,
    details?: unknown,
  ) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.details = details;
  }
}

/**
 * Fetches JSON from an API route and throws `ApiClientError` with the server's
 * error message whenever `!res.ok`. Never silently swallows 4xx/5xx failures.
 */
export async function apiFetch<T = unknown>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (
    typeof init?.body === 'string' &&
    !headers.has('Content-Type') &&
    !headers.has('content-type')
  ) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(input, {
    credentials: 'same-origin',
    ...init,
    headers,
  });

  const text = await res.text();
  let parsed: unknown = undefined;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = undefined;
    }
  }

  if (!res.ok) {
    const payload =
      parsed && typeof parsed === 'object'
        ? (parsed as StandardErrorPayload)
        : undefined;
    const message =
      payload?.error?.message ||
      payload?.message ||
      (text && text.length < 200 ? text : '') ||
      `Request failed (${res.status})`;
    const code = payload?.error?.code || `HTTP_${res.status}`;
    throw new ApiClientError(
      message,
      res.status,
      code,
      payload?.requestId,
      payload?.error?.details,
    );
  }

  return parsed as T;
}
