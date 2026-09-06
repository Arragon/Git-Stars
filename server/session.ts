import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { getDb } from "./db.js";
import { env } from "./env.js";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const SESSION_COOKIE_NAME = "gitstars_session";

// In-memory guard: skip redundant sliding-window renewals for the same session.
const RENEW_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
const recentRenewals = new Map<string, number>();
setInterval(() => {
  const cutoff = Date.now() - RENEW_COOLDOWN_MS;
  for (const [id, ts] of recentRenewals) {
    if (ts < cutoff) recentRenewals.delete(id);
  }
}, RENEW_COOLDOWN_MS).unref();

export interface SessionRow {
  id: string;
  user_id: string;
  expires_at: number;
}

function sign(value: string): string {
  return createHmac("sha256", env.sessionSecret)
    .update(value)
    .digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// Cookie value is "<sessionId>.<signature>"; signature prevents tampering if the DB leaks.
export function encodeCookieValue(sessionId: string): string {
  return `${sessionId}.${sign(sessionId)}`;
}

export function decodeCookieValue(cookie: string): string | null {
  const dotIndex = cookie.lastIndexOf(".");
  if (dotIndex <= 0) return null;
  const id = cookie.slice(0, dotIndex);
  const signature = cookie.slice(dotIndex + 1);
  if (!safeEqual(signature, sign(id))) return null;
  return id;
}

export function createSession(userId: string): {
  id: string;
  expiresAt: number;
} {
  const id = randomUUID();
  const expiresAt = Date.now() + SESSION_TTL_MS;
  getDb()
    .prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
    .run(id, userId, expiresAt);
  return { id, expiresAt };
}

export function readSession(
  cookieValue: string | undefined | null,
): SessionRow | null {
  if (!cookieValue) return null;
  const id = decodeCookieValue(cookieValue);
  if (!id) return null;
  const row = getDb()
    .prepare("SELECT id, user_id, expires_at FROM sessions WHERE id = ?")
    .get(id) as unknown as SessionRow | undefined;
  if (!row) return null;
  const now = Date.now();
  if (Number(row.expires_at) < now) {
    destroySession(row.id);
    return null;
  }
  // Sliding window renewal (ADR-0005 D1): when past halfway to expiry, extend by another full TTL.
  const remaining = Number(row.expires_at) - now;
  if (remaining < SESSION_TTL_MS / 2 && !recentRenewals.has(row.id)) {
    const newExpiresAt = now + SESSION_TTL_MS;
    getDb()
      .prepare("UPDATE sessions SET expires_at = ? WHERE id = ?")
      .run(newExpiresAt, row.id);
    recentRenewals.set(row.id, now);
    row.expires_at = newExpiresAt;
  }
  return row;
}

export function destroySession(sessionId: string): void {
  getDb().prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
}

export function destroySessionByCookie(
  cookieValue: string | undefined | null,
): void {
  if (!cookieValue) return;
  const id = decodeCookieValue(cookieValue);
  if (id) destroySession(id);
}

export function cleanExpiredSessions(): number {
  const result = getDb()
    .prepare("DELETE FROM sessions WHERE expires_at < ?")
    .run(Date.now());
  return Number(result.changes);
}

export function buildCookieHeader(
  cookieValue: string,
  expiresAtMs: number,
): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${cookieValue}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${new Date(expiresAtMs).toUTCString()}`,
    `Max-Age=${Math.floor((expiresAtMs - Date.now()) / 1000)}`,
  ];
  if (env.cookieSecure) parts.push("Secure");
  return parts.join("; ");
}

export function buildClearCookieHeader(): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "Max-Age=0",
  ];
  if (env.cookieSecure) parts.push("Secure");
  return parts.join("; ");
}
