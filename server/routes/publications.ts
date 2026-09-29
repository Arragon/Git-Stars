import { Hono } from "hono";
import { getDb } from "../db.js";
import { requireUser, type AuthedVariables } from "../middleware/auth.js";
import {
  getIdempotentResponse,
  storeIdempotentResponse,
} from "../services/mutations.js";
import {
  getPublicationRow,
  publish,
  revoke,
  serializePublication,
  setHubOptIn,
} from "../services/publication.js";
import { apiError } from "../httpErrors.js";
import { hit } from "../lib/rateLimit.js";

// Owner-facing publication endpoints (M5, INH-431/443).
//
// NOTE: these are deliberately NOT wired to recordChange (ADR-0004): publications
// are server-managed sharing state, not user-state sync units, so they never
// enter the per-user change feed.

// Single-process fixed-window limit (see server/lib/rateLimit.ts).
const PUBLISH_LIMIT = 10;
const PUBLISH_WINDOW_MS = 60 * 60 * 1000;

export const publicationRoutes = new Hono<{ Variables: AuthedVariables }>();

publicationRoutes.use("*", requireUser);

publicationRoutes.post("/lists/:id/publication", async (c) => {
  const userId = c.get("userId");
  const listId = c.req.param("id");

  // Rate limit before idempotency: replays count toward the hourly budget too.
  const rl = hit(`publish:${userId}`, PUBLISH_LIMIT, PUBLISH_WINDOW_MS);
  if (!rl.ok) {
    return apiError(c, 429, "RATE_LIMITED", "Too many publish requests", {
      retryAfterSec: rl.retryAfterSec,
    });
  }

  const idemKey = c.req.header("Idempotency-Key");
  const cached = getIdempotentResponse(idemKey, userId);
  if (cached) return c.json(JSON.parse(cached) as unknown);

  const result = publish(userId, listId);
  if (result.ok === false) {
    if (result.reason === "not_found") {
      return apiError(c, 404, "NOT_FOUND", "List not found");
    }
    return apiError(
      c,
      409,
      "CONFLICT",
      "This publication was taken down and cannot be re-published",
    );
  }
  const body = result.publication;
  storeIdempotentResponse(idemKey, userId, body);
  return c.json(body, result.mode === "created" ? 201 : 200);
});

publicationRoutes.get("/lists/:id/publication", (c) => {
  const userId = c.get("userId");
  const row = getPublicationRow(userId, { listId: c.req.param("id") });
  if (!row) return apiError(c, 404, "NOT_FOUND", "List not published");
  return c.json(serializePublication(row));
});

publicationRoutes.delete("/lists/:id/publication", (c) => {
  const userId = c.get("userId");
  const ok = revoke(userId, { listId: c.req.param("id") });
  if (!ok) return apiError(c, 404, "NOT_FOUND", "List not published");
  return c.json({ ok: true });
});

publicationRoutes.put("/lists/:id/hub", async (c) => {
  const userId = c.get("userId");
  const listId = c.req.param("id");

  let body: { optIn?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 400, "VALIDATION", "Request body must be JSON");
  }
  if (typeof body.optIn !== "boolean") {
    return apiError(c, 400, "VALIDATION", "optIn (boolean) is required");
  }

  const list = getDbList(userId, listId);
  if (!list) return apiError(c, 404, "NOT_FOUND", "List not found");

  const ok = setHubOptIn(userId, listId, body.optIn);
  if (!ok) {
    return apiError(
      c,
      409,
      "CONFLICT",
      "Hub visibility requires an active publication",
    );
  }
  return c.json({ ok: true, hubOptIn: body.optIn });
});

function getDbList(userId: string, listId: string): { id: string } | null {
  const row = getDb()
    .prepare(
      "SELECT id FROM lists WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
    )
    .get(listId, userId) as unknown as { id: string } | undefined;
  return row ?? null;
}
