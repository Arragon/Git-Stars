import { Hono } from "hono";
import { getDb } from "../db.js";
import { requireUser, type AuthedVariables } from "../middleware/auth.js";
import {
  getIdempotentResponse,
  makeEtag,
  recordChange,
  storeIdempotentResponse,
} from "../services/mutations.js";
import { apiError } from "../httpErrors.js";

export const preferenceRoutes = new Hono<{ Variables: AuthedVariables }>();

preferenceRoutes.use("*", requireUser);

function load(userId: string): {
  data: Record<string, unknown>;
  version: number;
} {
  const row = getDb()
    .prepare("SELECT data, version FROM preferences WHERE user_id = ?")
    .get(userId) as unknown as { data: string; version: number } | undefined;
  if (!row) return { data: {}, version: 0 };
  try {
    return {
      data: JSON.parse(row.data) as Record<string, unknown>,
      version: Number(row.version),
    };
  } catch {
    return { data: {}, version: Number(row.version) };
  }
}

preferenceRoutes.get("/", (c) => {
  const userId = c.get("userId");
  const { data, version } = load(userId);
  c.header("ETag", makeEtag(userId, version));
  return c.json({ data, version });
});

// Preferences use field-level shallow-merge then a version bump (ADR-0004 D4).
preferenceRoutes.put("/", async (c) => {
  const userId = c.get("userId");
  const idemKey = c.req.header("Idempotency-Key");
  const cached = getIdempotentResponse(idemKey, userId);
  if (cached) return c.json(JSON.parse(cached) as Record<string, unknown>);

  let body: { data?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 400, "VALIDATION", "Request body must be JSON");
  }
  const patch = (
    body.data && typeof body.data === "object" ? body.data : {}
  ) as Record<string, unknown>;

  const current = load(userId);
  const merged = { ...current.data, ...patch };
  const nextVersion = current.version + 1;
  const nowIso = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO preferences (user_id, data, version, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, version = excluded.version, updated_at = excluded.updated_at`,
    )
    .run(userId, JSON.stringify(merged), nextVersion, nowIso);
  recordChange(
    userId,
    "preference",
    userId,
    current.version === 0 ? "created" : "updated",
    nextVersion,
  );

  const res = {
    data: merged,
    version: nextVersion,
    etag: makeEtag(userId, nextVersion),
  };
  storeIdempotentResponse(idemKey, userId, res);
  return c.json(res);
});
