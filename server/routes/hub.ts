import { Hono } from "hono";
import { getPublicSnapshot, listCatalog } from "../services/publication.js";
import { apiError } from "../httpErrors.js";
import { hit, clientIp } from "../lib/rateLimit.js";
import { NOT_FOUND_MESSAGE } from "./public.js";

// Anonymous hub catalog (M5, INH-435/451). Read-only over active + hub-opted-in
// publications; never exposes link-only or revoked/taken-down shares. Anonymous
// reads are rate-limited per IP (bounded enumeration/abuse protection).

export const hubRoutes = new Hono();

const ANON_READ_LIMIT = 120;
const ANON_READ_WINDOW_MS = 60 * 60 * 1000;

function anonLimit(c: { req: { header(name: string): string | undefined } }) {
  return hit(
    `read:${clientIp(c.req.header("X-Forwarded-For"))}`,
    ANON_READ_LIMIT,
    ANON_READ_WINDOW_MS,
  );
}

hubRoutes.get("/hub/lists", (c) => {
  const rl = anonLimit(c);
  if (!rl.ok) {
    return apiError(c, 429, "RATE_LIMITED", "Too many requests", {
      retryAfterSec: rl.retryAfterSec,
    });
  }
  const sortParam = c.req.query("sort");
  const limitRaw = Number(c.req.query("limit"));
  return c.json(
    listCatalog({
      q: c.req.query("q") || undefined,
      sort: sortParam === "title" ? "title" : "recent",
      cursor: c.req.query("cursor") || undefined,
      limit:
        Number.isFinite(limitRaw) && limitRaw > 0
          ? Math.floor(limitRaw)
          : undefined,
    }),
  );
});

hubRoutes.get("/hub/lists/:shareId", (c) => {
  const rl = anonLimit(c);
  if (!rl.ok) {
    return apiError(c, 429, "RATE_LIMITED", "Too many requests", {
      retryAfterSec: rl.retryAfterSec,
    });
  }
  const snapshot = getPublicSnapshot(c.req.param("shareId"));
  if (!snapshot) {
    return apiError(c, 404, "NOT_FOUND", NOT_FOUND_MESSAGE);
  }
  return c.json(snapshot);
});
