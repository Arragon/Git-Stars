import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { getDb } from "../db.js";
import { requireUser, type AuthedVariables } from "../middleware/auth.js";
import {
  getIdempotentResponse,
  recordChange,
  storeIdempotentResponse,
} from "../services/mutations.js";
import { apiError } from "../httpErrors.js";

interface TagRow {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
}

export const tagRoutes = new Hono<{ Variables: AuthedVariables }>();

tagRoutes.use("*", requireUser);

tagRoutes.get("/", (c) => {
  const userId = c.get("userId");
  const rows = getDb()
    .prepare(
      "SELECT id, user_id, name, created_at FROM tags WHERE user_id = ? ORDER BY name ASC",
    )
    .all(userId) as unknown as TagRow[];
  return c.json(rows);
});

// Tag creation is idempotent by (user, name): a repeat returns the existing tag (set semantics).
tagRoutes.post("/", async (c) => {
  const userId = c.get("userId");
  const idemKey = c.req.header("Idempotency-Key");
  const cached = getIdempotentResponse(idemKey, userId);
  if (cached) return c.json(JSON.parse(cached) as TagRow);

  let body: { name?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 400, "VALIDATION", "Request body must be JSON");
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return apiError(c, 400, "VALIDATION", "Tag name is required");

  const db = getDb();
  const existing = db
    .prepare(
      "SELECT id, user_id, name, created_at FROM tags WHERE user_id = ? AND name = ?",
    )
    .get(userId, name) as unknown as TagRow | undefined;

  let row = existing;
  let created = false;
  if (!row) {
    const id = randomUUID();
    const nowIso = new Date().toISOString();
    db.prepare(
      "INSERT INTO tags (id, user_id, name, created_at) VALUES (?, ?, ?, ?)",
    ).run(id, userId, name, nowIso);
    row = { id, user_id: userId, name, created_at: nowIso };
    created = true;
    recordChange(userId, "tag", id, "created", 1);
  }

  storeIdempotentResponse(idemKey, userId, row);
  return c.json(row, created ? 201 : 200);
});

tagRoutes.delete("/:id", (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const db = getDb();
  const row = db
    .prepare("SELECT id FROM tags WHERE id = ? AND user_id = ?")
    .get(id, userId) as { id: string } | undefined;
  if (!row) return apiError(c, 404, "NOT_FOUND", "Tag not found");
  db.prepare("DELETE FROM tags WHERE id = ? AND user_id = ?").run(id, userId);
  recordChange(userId, "tag", id, "deleted", 0);
  return c.json({ ok: true });
});
