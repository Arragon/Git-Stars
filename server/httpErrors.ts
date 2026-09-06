import type { Context } from "hono";
import { ProviderError } from "./providers/types.js";

// ADR-0006 D5: standard error envelope helper. Returns a JSON response with
// { code, message, details?, request_id } matching the contract.
export function apiError(
  c: Context,
  status: number,
  code: string,
  message: string,
  details?: unknown,
) {
  const body: {
    code: string;
    message: string;
    details?: unknown;
    request_id?: string;
  } = {
    code,
    message,
  };
  if (details !== undefined) body.details = details;
  const requestId = c.req.header("X-Request-Id");
  if (requestId) body.request_id = requestId;
  return c.json(body, status as never);
}

// Map a ProviderError to the standard API error envelope + HTTP status (ADR-0006 D5).
// Returns null for non-provider errors so callers can fall through to a 500 handler.
export function providerErrorToHttp(error: unknown): {
  status: 400 | 401 | 403 | 404 | 429 | 501 | 502;
  body: { code: string; message: string; details?: unknown };
} | null {
  if (!(error instanceof ProviderError)) return null;
  switch (error.code) {
    case "NOT_FOUND":
      return {
        status: 404,
        body: { code: "NOT_FOUND", message: error.message },
      };
    case "RATE_LIMITED":
      return {
        status: 429,
        body: {
          code: "RATE_LIMITED",
          message: error.message,
          details: { resetAt: error.resetAt },
        },
      };
    case "UNAUTHORIZED":
      return {
        status: 401,
        body: { code: "UNAUTHORIZED", message: error.message },
      };
    case "FORBIDDEN":
      return {
        status: 403,
        body: { code: "FORBIDDEN", message: error.message },
      };
    case "VALIDATION":
      return {
        status: 400,
        body: { code: "VALIDATION", message: error.message },
      };
    case "NOT_IMPLEMENTED":
      return {
        status: 501,
        body: { code: "PROVIDER_NOT_IMPLEMENTED", message: error.message },
      };
    default:
      return {
        status: 502,
        body: { code: "PROVIDER_ERROR", message: error.message },
      };
  }
}
