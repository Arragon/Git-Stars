// server/lib/rateLimit.ts
// Minimal in-memory fixed-window rate limiter (M5 sharing endpoints).
// Intentionally single-process: GitStars targets local/self-hosted single-node
// deployments (ADR-0003 D5), so an in-process Map is the correct scope. If a
// multi-instance deployment ever becomes real, swap this for a shared store.

interface Bucket {
  windowStart: number;
  count: number;
}

const buckets = new Map<string, Bucket>();

// Opportunistic sweep threshold: past this many keys, drop expired entries so a
// churning key space (per-IP reports) cannot grow the map without bound.
const SWEEP_THRESHOLD = 4096;

export interface RateLimitResult {
  ok: boolean;
  retryAfterSec: number;
}

export function hit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  if (buckets.size > SWEEP_THRESHOLD) {
    for (const [k, b] of buckets) {
      if (now - b.windowStart >= windowMs) buckets.delete(k);
    }
  }

  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    buckets.set(key, { windowStart: now, count: 1 });
    return { ok: true, retryAfterSec: 0 };
  }
  if (bucket.count >= limit) {
    return {
      ok: false,
      retryAfterSec: Math.max(
        1,
        Math.ceil((bucket.windowStart + windowMs - now) / 1000),
      ),
    };
  }
  bucket.count += 1;
  return { ok: true, retryAfterSec: 0 };
}

// Client IP for per-IP anonymous limits (first X-Forwarded-For hop when behind
// a proxy; falls back to "unknown" for direct local access).
export function clientIp(headerXff: string | undefined): string {
  return headerXff?.split(",")[0]?.trim() || "unknown";
}
