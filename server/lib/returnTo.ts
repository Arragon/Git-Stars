// server/lib/returnTo.ts
// Post-login destination validation (M8-01). Only same-origin application paths are
// accepted: protocol-relative, absolute, backslash and control-character payloads fall
// back to the default so an attacker cannot turn login into an open redirect.

export const DEFAULT_RETURN_TO = "/library";
const MAX_LENGTH = 2048;

export function sanitizeReturnTo(
  raw: unknown,
  fallback: string = DEFAULT_RETURN_TO,
): string {
  if (typeof raw !== "string") return fallback;
  const value = raw.trim();
  if (!value || value.length > MAX_LENGTH) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  if (value.includes("\\")) return fallback;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return fallback;
  }
  // API/auth endpoints are not a user-facing destination.
  if (value.startsWith("/api/")) return fallback;
  try {
    const url = new URL(value, "http://gitstars.local");
    if (url.origin !== "http://gitstars.local") return fallback;
  } catch {
    return fallback;
  }
  return value;
}
