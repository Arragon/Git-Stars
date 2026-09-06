import { Hono } from "hono";
import { getDb } from "../db.js";
import { requireUser, type AuthedVariables } from "../middleware/auth.js";
import { PROTOCOL_VERSION } from "../versions.js";

// Change feed pull endpoint (ADR-0004 D6). Client passes the last seen seq as `since`.
export const changesRoutes = new Hono<{ Variables: AuthedVariables }>();

changesRoutes.use("*", requireUser);

interface ChangeRow {
  seq: number;
  entity_type: string;
  entity_id: string;
  op: string;
  version: number;
  created_at: string;
}

changesRoutes.get("/", (c) => {
  const userId = c.get("userId");
  const sinceRaw = c.req.query("since");
  const since = sinceRaw && /^\d+$/.test(sinceRaw) ? Number(sinceRaw) : 0;
  const limitRaw = c.req.query("limit");
  const requested = limitRaw && /^\d+$/.test(limitRaw) ? Number(limitRaw) : 200;
  const limit = Math.max(1, Math.min(requested, 500));

  const rows = getDb()
    .prepare(
      `SELECT seq, entity_type, entity_id, op, version, created_at
       FROM change_log WHERE user_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?`,
    )
    .all(userId, since, limit + 1) as unknown as ChangeRow[];

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const changes = page.map((r) => ({
    seq: Number(r.seq),
    entityType: r.entity_type,
    entityId: r.entity_id,
    op: r.op,
    version: Number(r.version),
    createdAt: r.created_at,
  }));
  const nextCursor = page.length ? Number(page[page.length - 1].seq) : since;

  return c.json({
    changes,
    nextCursor,
    hasMore,
    protocolVersion: PROTOCOL_VERSION,
  });
});
