export class ApiError extends Error {
  code: string;
  status: number;
  details?: unknown;
  requestId?: string;

  constructor(
    message: string,
    code: string,
    status: number,
    details?: unknown,
    requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
    this.requestId = requestId;
  }
}

interface ApiErrorResponse {
  code?: string;
  message?: string;
  details?: unknown;
  request_id?: string;
  [key: string]: unknown;
}

// Client sends the sync/API protocol version so the server can reject stale clients
// (ADR-0004 D5). Kept in sync with server/versions.ts PROTOCOL_VERSION.
export const CLIENT_PROTOCOL_VERSION = 1;

export interface RequestOptions {
  // Extra headers, e.g. { 'Idempotency-Key': key, 'If-Match': etag } (ADR-0004/0006).
  headers?: Record<string, string>;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options?: RequestOptions,
): Promise<T> {
  const headers: Record<string, string> = {
    "X-GitStars-Protocol-Version": String(CLIENT_PROTOCOL_VERSION),
    ...options?.headers,
  };
  const init: RequestInit = {
    method,
    credentials: "include",
    headers,
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  const response = await fetch(path, init);
  const contentType = response.headers.get("content-type") ?? "";

  let data: unknown = null;
  if (contentType.includes("application/json")) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const errorBody = (data ?? {}) as ApiErrorResponse;
    throw new ApiError(
      errorBody.message || `HTTP ${response.status}`,
      errorBody.code || "UNKNOWN",
      response.status,
      errorBody.details,
      errorBody.request_id ?? response.headers.get("X-Request-Id") ?? undefined,
    );
  }

  return data as T;
}

export function apiGet<T>(path: string, options?: RequestOptions): Promise<T> {
  return request<T>("GET", path, undefined, options);
}

export function apiPost<T>(
  path: string,
  body?: unknown,
  options?: RequestOptions,
): Promise<T> {
  return request<T>("POST", path, body, options);
}

export function apiPut<T>(
  path: string,
  body?: unknown,
  options?: RequestOptions,
): Promise<T> {
  return request<T>("PUT", path, body, options);
}

export function apiPatch<T>(
  path: string,
  body?: unknown,
  options?: RequestOptions,
): Promise<T> {
  return request<T>("PATCH", path, body, options);
}

export function apiDelete<T>(
  path: string,
  body?: unknown,
  options?: RequestOptions,
): Promise<T> {
  return request<T>("DELETE", path, body, options);
}
