// server/lib/obs.ts
// Production observability primitives (INH-485): audit-safe structured logging,
// error classification, and in-process metric counters.
//
// Boundary rules:
// - Logs never carry user content (notes, list titles are payload) or credential
//   material; every field passes through redactFields() which drops/redacts a
//   denylist and scrubs token-shaped strings from values.
// - Metric labels are low-cardinality only (provider type, error class, outcome) —
//   never repository URLs, emails, or raw user ids; user identity in logs uses the
//   anonymous userHash (HMAC of the user id) via userRef().

import { createHmac } from "node:crypto";
import { env } from "../env.js";

// --- Redaction ---

const REDACTED = "[REDACTED]";

const SENSITIVE_KEYS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "password",
  "secret",
  "client_secret",
  "session_secret",
  "admin_token",
  "access_token",
  "accesstoken",
  "refresh_token",
  "encrypted_token",
  "token",
  "credential",
  "credentials",
  "note",
  "notes",
  "ai_summary",
  "aisummary",
  "description_body",
  "payload",
  "body",
]);

// Token-shaped strings scrubbed from any logged string value.
const TOKEN_PATTERNS: RegExp[] = [
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, // fine-grained PATs
  /\bglpat-[A-Za-z0-9\-_]{16,}\b/g, // GitLab PATs
  // NOTE: no bare-UUID pattern — request ids and entity ids are UUIDs and must
  // stay correlated in logs; session cookie values are HMAC-signed, never bare.
];

function scrubString(value: string): string {
  let out = value;
  for (const pattern of TOKEN_PATTERNS) out = out.replace(pattern, REDACTED);
  return out;
}

export function redactFields(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    const lower = key.toLowerCase();
    if (SENSITIVE_KEYS.has(lower)) {
      out[key] = REDACTED;
      continue;
    }
    if (typeof value === "string") {
      out[key] = scrubString(value);
      continue;
    }
    if (Array.isArray(value)) {
      out[key] = value.map((v) => (typeof v === "string" ? scrubString(v) : v));
      continue;
    }
    if (value && typeof value === "object") {
      out[key] = redactFields(value as Record<string, unknown>);
      continue;
    }
    out[key] = value;
  }
  return out;
}

// --- Anonymous user reference (low cardinality, stable per user, not reversible) ---

export function userRef(userId: string): string {
  const digest = createHmac("sha256", env.sessionSecret)
    .update(userId)
    .digest();
  return digest.subarray(0, 8).toString("hex");
}

// --- Error classification (provider failure / db / auth / validation / internal) ---

export type ErrorClass =
  | "provider_rate_limited"
  | "provider_unauthorized"
  | "provider_error"
  | "provider_not_implemented"
  | "db_error"
  | "auth_error"
  | "validation_error"
  | "conflict_error"
  | "internal_error";

export function classifyError(err: unknown): ErrorClass {
  const name = (err as { name?: string })?.name ?? "";
  const code = (err as { code?: string })?.code ?? "";
  const message = err instanceof Error ? err.message : String(err);

  if (name === "GitHubRateLimitError" || code === "RATE_LIMITED")
    return "provider_rate_limited";
  if (
    code === "UNAUTHORIZED" ||
    code === "OAUTH_EXCHANGE_FAILED" ||
    code === "USER_FETCH_FAILED"
  )
    return "provider_unauthorized";
  if (code === "PROVIDER_NOT_IMPLEMENTED") return "provider_not_implemented";
  if (name === "ProviderError" || code === "PROVIDER_ERROR")
    return "provider_error";
  if (name === "SqliteError" || /sqlite|database/i.test(message))
    return "db_error";
  if (
    code === "UNAUTHENTICATED" ||
    code === "FORBIDDEN" ||
    code === "OAUTH_STATE_INVALID"
  )
    return "auth_error";
  if (code === "VALIDATION") return "validation_error";
  if (
    code === "VERSION_CONFLICT" ||
    code === "CONFLICT" ||
    code === "CURSOR_INVALID"
  )
    return "conflict_error";
  return "internal_error";
}

// --- Structured logging ---

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function minLevel(): LogLevel {
  return (process.env.LOG_LEVEL as LogLevel) || "info";
}

export interface LogFields {
  [key: string]: unknown;
}

export function log(
  level: LogLevel,
  event: string,
  fields: LogFields = {},
): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel()]) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...redactFields(fields),
  });
  // Single JSON line per event to stdout; the process supervisor owns shipping.
  if (level === "error") console.error(line);
  else console.log(line);
}

// --- Metrics (in-process counters; scrape or ship via a future /internal/metrics) ---

const counters = new Map<string, number>();

export interface MetricKey {
  name: string;
  labels?: Record<string, string>;
}

function metricKeyString({ name, labels }: MetricKey): string {
  if (!labels || Object.keys(labels).length === 0) return name;
  const parts = Object.keys(labels)
    .sort()
    .map((k) => `${k}="${String(labels[k])}"`);
  return `${name}{${parts.join(",")}}`;
}

export function incrementMetric(key: MetricKey, by = 1): void {
  const k = metricKeyString(key);
  counters.set(k, (counters.get(k) ?? 0) + by);
}

export function metricSnapshot(): Record<string, number> {
  return Object.fromEntries(
    [...counters.entries()].sort(([a], [b]) => (a < b ? -1 : 1)),
  );
}

export function resetMetricsForTests(): void {
  counters.clear();
}

// Convenience wrappers for the events the runbooks reference (ADR-0007 D5).
export function logRequest(fields: {
  requestId: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  userRef?: string;
}): void {
  incrementMetric({
    name: "http_requests_total",
    labels: { status: String(fields.status) },
  });
  log("info", "http_request", fields);
}

export function logSyncOutcome(fields: {
  userRef: string;
  provider: string;
  outcome: "ok" | "error";
  errorClass?: ErrorClass;
  batchCount?: number;
}): void {
  incrementMetric({
    name: "sync_total",
    labels: { provider: fields.provider, outcome: fields.outcome },
  });
  if (fields.outcome === "error" && fields.errorClass) {
    incrementMetric({
      name: "sync_errors_total",
      labels: { provider: fields.provider, class: fields.errorClass },
    });
  }
  log(fields.outcome === "error" ? "warn" : "info", "sync_run", fields);
}

export function logAuthFailure(fields: {
  requestId?: string;
  reason: string;
  errorClass?: ErrorClass;
}): void {
  incrementMetric({
    name: "auth_failures_total",
    labels: { reason: fields.reason },
  });
  log("warn", "auth_failure", fields);
}

export function logPublicationAbuse(fields: {
  event: "report" | "takedown";
  shareIdPrefix: string; // first 8 chars only — never the full share id
}): void {
  incrementMetric({
    name: "publication_events_total",
    labels: { event: fields.event },
  });
  log("warn", "publication_event", fields);
}
