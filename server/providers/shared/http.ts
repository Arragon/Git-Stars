import { ProviderError } from "../types.js";

// Shared provider transport mechanics (ADR-0002 D6): timeout/abort, bounded retry with
// backoff+jitter, Retry-After handling, Link-header pagination, in-flight dedupe.
// Provider-specific rate-limit/error *classification* stays in each adapter (ADR-0002 D5).

export interface HttpResult {
  ok: boolean;
  status: number;
  headers: Headers;
  data: unknown;
}

export interface HttpOptions {
  token?: string | null;
  accept?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  method?: string;
  body?: string;
}

const DEFAULT_TIMEOUT_MS = 15000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoff(attempt: number): number {
  const base = Math.min(1000 * 2 ** attempt, 8000);
  return base + Math.floor(Math.random() * 250);
}

export function parseRetryAfterMs(headers: Headers): number | undefined {
  const raw = headers.get("retry-after");
  if (!raw) return undefined;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(raw);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return undefined;
}

// RFC 5988 Link header -> the rel="next" URL, or null.
export function parseLinkNext(headers: Headers): string | null {
  const link = headers.get("link");
  if (!link) return null;
  const match = /<([^>]+)>;\s*rel="next"/.exec(link);
  return match ? match[1] : null;
}

async function send(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readData(res: Response): Promise<unknown> {
  const contentType = res.headers.get("content-type") ?? "";
  const text = await res.text();
  if (!text) return null;
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
  return text;
}

function buildHeaders(opts: HttpOptions): Record<string, string> {
  return {
    Accept: opts.accept ?? "application/json",
    "User-Agent": "gitstars-provider",
    ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    ...(opts.headers ?? {}),
  };
}

// JSON request with bounded retry on network errors, 429 (honoring Retry-After) and 5xx.
export async function httpJson(
  url: string,
  opts: HttpOptions = {},
): Promise<HttpResult> {
  const retries = opts.retries ?? 2;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const headers = buildHeaders(opts);

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await send(
        url,
        { method: opts.method ?? "GET", headers, body: opts.body },
        timeoutMs,
      );
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        await sleep(parseRetryAfterMs(res.headers) ?? backoff(attempt));
        continue;
      }
      return {
        ok: res.ok,
        status: res.status,
        headers: res.headers,
        data: await readData(res),
      };
    } catch (error) {
      if (attempt < retries) {
        await sleep(backoff(attempt));
        continue;
      }
      const reason = error instanceof Error ? error.message : String(error);
      throw new ProviderError(
        "NETWORK",
        `Request to ${url} failed: ${reason}`,
        { retryable: true },
      );
    }
  }
  // Unreachable: the loop always returns or throws.
  throw new ProviderError("NETWORK", `Request to ${url} failed`, {
    retryable: true,
  });
}

// Binary download (release assets). Buffer in memory; assets are bounded.
// ponytail: buffers the whole asset; switch to streaming if very large assets become common.
export async function httpBytes(
  url: string,
  opts: HttpOptions = {},
): Promise<{ status: number; headers: Headers; body: Uint8Array }> {
  const timeoutMs = opts.timeoutMs ?? 60000;
  const res = await send(
    url,
    { method: opts.method ?? "GET", headers: buildHeaders(opts) },
    timeoutMs,
  );
  const body = new Uint8Array(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, body };
}

const inflight = new Map<string, Promise<unknown>>();

// Collapse identical concurrent requests into one (ADR-0002 D6 request dedupe).
export function dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const promise = fn().finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}
