// server/lib/egress.ts
// Outbound egress guard (SSRF mitigation). Every server-side fetch must pass an
// https URL whose host is a public DNS name. Raw IP literals (IPv4/IPv6) are
// rejected outright — providers are always addressed by hostname — and hosts that
// name or mimic loopback / private / reserved networks are refused before any
// connection is attempted.

export class EgressBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EgressBlockedError";
  }
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
]);

// Suffixes that resolve inside loopback, link-local, or organization-internal
// namespaces (RFC 6761/6762/8375) rather than the public DNS hierarchy.
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];

const IPV4_LITERAL = /^\d{1,3}(\.\d{1,3}){3}$/;

function isRejectedHost(host: string): boolean {
  if (!host) return true;
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  // No raw IP literals: IPv4 dotted quad, or anything IPv6-ish (contains ":").
  if (IPV4_LITERAL.test(host)) return true;
  if (host.includes(":")) return true;
  return false;
}

// Validate an outbound URL before fetching: https only, public DNS host only.
export function assertEgressUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new EgressBlockedError("Egress URL is not a valid absolute URL");
  }
  if (url.protocol !== "https:") {
    throw new EgressBlockedError(
      `Egress protocol not allowed: ${url.protocol}`,
    );
  }
  // Strip one trailing dot (absolute FQDN form) and bracketed IPv6 for the check.
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (isRejectedHost(host)) {
    throw new EgressBlockedError(
      `Egress host not allowed (must be a public DNS name): ${host || "(empty)"}`,
    );
  }
  return url;
}
