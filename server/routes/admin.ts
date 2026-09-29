import { Hono } from "hono";
import { timingSafeEqual } from "node:crypto";
import { env } from "../env.js";
import { takedown } from "../services/publication.js";
import { apiError } from "../httpErrors.js";

// Admin surface (M5, INH-447 hook for INH-451). Bearer-token authenticated via
// ADMIN_TOKEN; when the token is not configured the endpoint is disabled
// outright (503 ADMIN_NOT_CONFIGURED) rather than silently open. Takedown never
// touches the private source list — it only stops the publication resolving.

export const adminRoutes = new Hono();

adminRoutes.post("/admin/publications/:shareId/takedown", (c) => {
  const expected = env.adminToken;
  if (!expected) {
    return apiError(
      c,
      503,
      "ADMIN_NOT_CONFIGURED",
      "ADMIN_TOKEN is not configured on this server",
    );
  }
  const header = c.req.header("Authorization") ?? "";
  const match = /^Bearer\s+(.+)$/.exec(header.trim());
  const provided = match?.[1] ?? "";
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  // timingSafeEqual throws on length mismatch; length itself is safe to leak.
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return apiError(c, 401, "UNAUTHENTICATED", "Invalid admin token");
  }
  const ok = takedown(c.req.param("shareId"));
  if (!ok) return apiError(c, 404, "NOT_FOUND", "Publication not found");
  return c.json({ ok: true });
});
