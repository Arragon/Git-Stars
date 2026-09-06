import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { getDb, inTransaction } from "../db.js";
import { requireUser, type AuthedVariables } from "../middleware/auth.js";
import {
  getIdempotentResponse,
  makeEtag,
  parseIfMatch,
  recordChange,
  storeIdempotentResponse,
} from "../services/mutations.js";
import { exportList } from "../services/listsIo.js";
import { apiError } from "../httpErrors.js";
import { generateBetween } from "../lib/fractionalIndex.js";

// Lists + ordered ListItems (ADR-0003, ADR-0004 D4). A ListItem references a SavedRepository,
// so it is inherently user-owned and cross-provider.
// ponytail: integer positions; move to fractional indexing when concurrent reorder merging matters (M4).

interface ListRow {
  id: string;
  user_id: string;
  name: string;
  description: string;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface ItemRow {
  id: string;
  list_id: string;
  saved_repository_id: string;
  position: number;
  position_key: string;
  note: string | null;
  version: number;
  repository_id: string;
  provider_type: string;
  name: string;
  web_url: string;
}

const SELECT_ITEMS = `
  SELECT li.id, li.list_id, li.saved_repository_id, li.position, li.position_key, li.note, li.version,
         sr.repository_id, r.provider_type, r.name, r.web_url
  FROM list_items li
  JOIN saved_repositories sr ON sr.id = li.saved_repository_id
  JOIN repositories r ON r.id = sr.repository_id`;

function serializeList(row: ListRow, itemCount?: number) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    version: Number(row.version),
    etag: makeEtag(row.id, Number(row.version)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    itemCount,
  };
}

function serializeItem(row: ItemRow) {
  return {
    id: row.id,
    savedRepositoryId: row.saved_repository_id,
    position: row.position_key || String(Number(row.position)),
    note: row.note ?? undefined,
    repository: {
      id: row.repository_id,
      providerType: row.provider_type,
      name: row.name,
      webUrl: row.web_url,
    },
  };
}

function loadOwnedList(listId: string, userId: string): ListRow | null {
  const row = getDb()
    .prepare(
      "SELECT * FROM lists WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
    )
    .get(listId, userId) as unknown as ListRow | undefined;
  return row ?? null;
}

export const listRoutes = new Hono<{ Variables: AuthedVariables }>();

listRoutes.use("*", requireUser);

listRoutes.get("/", (c) => {
  const userId = c.get("userId");
  const rows = getDb()
    .prepare(
      "SELECT * FROM lists WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at ASC",
    )
    .all(userId) as unknown as ListRow[];
  const counts = getDb()
    .prepare(
      `SELECT list_id, COUNT(*) AS n FROM list_items WHERE list_id IN (${rows.map(() => "?").join(",") || "''"}) GROUP BY list_id`,
    )
    .all(...rows.map((r) => r.id)) as unknown as Array<{
    list_id: string;
    n: number;
  }>;
  const countMap = new Map(counts.map((x) => [x.list_id, Number(x.n)]));
  return c.json(rows.map((r) => serializeList(r, countMap.get(r.id) ?? 0)));
});

listRoutes.post("/", async (c) => {
  const userId = c.get("userId");
  const idemKey = c.req.header("Idempotency-Key");
  const cached = getIdempotentResponse(idemKey, userId);
  if (cached) return c.json(JSON.parse(cached) as unknown);

  let body: { name?: unknown; description?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 400, "VALIDATION", "Request body must be JSON");
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return apiError(c, 400, "VALIDATION", "List name is required");
  const description =
    typeof body.description === "string" ? body.description : "";

  const db = getDb();
  const clash = db
    .prepare(
      "SELECT id FROM lists WHERE user_id = ? AND name = ? AND deleted_at IS NULL",
    )
    .get(userId, name) as { id: string } | undefined;
  if (clash)
    return apiError(c, 409, "CONFLICT", "A list with this name already exists");

  const id = randomUUID();
  const nowIso = new Date().toISOString();
  db.prepare(
    `INSERT INTO lists (id, user_id, name, description, version, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)`,
  ).run(id, userId, name, description, nowIso, nowIso);
  recordChange(userId, "list", id, "created", 1);

  const row = db
    .prepare("SELECT * FROM lists WHERE id = ?")
    .get(id) as unknown as ListRow;
  const res = serializeList(row, 0);
  storeIdempotentResponse(idemKey, userId, res);
  return c.json(res, 201);
});

listRoutes.get("/:id", (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const list = loadOwnedList(id, userId);
  if (!list) return apiError(c, 404, "NOT_FOUND", "List not found");
  const items = getDb()
    .prepare(`${SELECT_ITEMS} WHERE li.list_id = ? ORDER BY li.position_key ASC, li.position ASC`)
    .all(id) as unknown as ItemRow[];
  return c.json({
    ...serializeList(list, items.length),
    items: items.map(serializeItem),
  });
});

listRoutes.put("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const idemKey = c.req.header("Idempotency-Key");
  const cached = getIdempotentResponse(idemKey, userId);
  if (cached) return c.json(JSON.parse(cached) as unknown);

  const list = loadOwnedList(id, userId);
  if (!list) return apiError(c, 404, "NOT_FOUND", "List not found");

  const ifMatch = parseIfMatch(c.req.header("If-Match"));
  if (ifMatch && ifMatch.version !== Number(list.version)) {
    return apiError(c, 409, "VERSION_CONFLICT", "List was modified", {
      current: makeEtag(id, Number(list.version)),
    });
  }

  let body: { name?: unknown; description?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 400, "VALIDATION", "Request body must be JSON");
  }
  const name =
    typeof body.name === "string" && body.name.trim()
      ? body.name.trim()
      : list.name;
  const description =
    typeof body.description === "string" ? body.description : list.description;

  const db = getDb();
  if (name !== list.name) {
    const clash = db
      .prepare(
        "SELECT id FROM lists WHERE user_id = ? AND name = ? AND id != ? AND deleted_at IS NULL",
      )
      .get(userId, name, id) as { id: string } | undefined;
    if (clash)
      return apiError(
        c,
        409,
        "CONFLICT",
        "A list with this name already exists",
      );
  }

  const nextVersion = Number(list.version) + 1;
  const nowIso = new Date().toISOString();
  db.prepare(
    "UPDATE lists SET name = ?, description = ?, version = ?, updated_at = ? WHERE id = ?",
  ).run(name, description, nextVersion, nowIso, id);
  recordChange(userId, "list", id, "updated", nextVersion);

  const row = db
    .prepare("SELECT * FROM lists WHERE id = ?")
    .get(id) as unknown as ListRow;
  const res = serializeList(row);
  storeIdempotentResponse(idemKey, userId, res);
  return c.json(res);
});

listRoutes.delete("/:id", (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const list = loadOwnedList(id, userId);
  if (!list) return apiError(c, 404, "NOT_FOUND", "List not found");
  const nextVersion = Number(list.version) + 1;
  const nowIso = new Date().toISOString();
  getDb()
    .prepare(
      "UPDATE lists SET deleted_at = ?, version = ?, updated_at = ? WHERE id = ?",
    )
    .run(nowIso, nextVersion, nowIso, id);
  recordChange(userId, "list", id, "deleted", nextVersion);
  return c.json({ ok: true, version: nextVersion });
});

// Ordered membership edit: {add?, remove?, reorder?} with set semantics (ADR-0004 D4).
listRoutes.put("/:id/items", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const idemKey = c.req.header("Idempotency-Key");
  const cached = getIdempotentResponse(idemKey, userId);
  if (cached) return c.json(JSON.parse(cached) as unknown);

  const list = loadOwnedList(id, userId);
  if (!list) return apiError(c, 404, "NOT_FOUND", "List not found");

  let body: { add?: unknown; remove?: unknown; reorder?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 400, "VALIDATION", "Request body must be JSON");
  }
  const strArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  const add = strArray(body.add);
  const remove = strArray(body.remove);
  const reorder = strArray(body.reorder);

  const db = getDb();
  const nowIso = new Date().toISOString();

  inTransaction(() => {
    // remove (set delete; change-feed entry is the tombstone)
    for (const savedId of remove) {
      const existing = db
        .prepare(
          "SELECT id FROM list_items WHERE list_id = ? AND saved_repository_id = ?",
        )
        .get(id, savedId) as unknown as { id: string } | undefined;
      if (!existing) continue;
      db.prepare("DELETE FROM list_items WHERE id = ?").run(existing.id);
      recordChange(userId, "list_item", existing.id, "deleted", 0);
    }

    // add (idempotent insert at end using fractional index)
    const lastItem = db
      .prepare(
        "SELECT position_key FROM list_items WHERE list_id = ? ORDER BY position_key DESC, position DESC LIMIT 1",
      )
      .get(id) as unknown as { position_key: string } | undefined;
    const lastKey = lastItem?.position_key || null;
    for (const savedId of add) {
      const owned = db
        .prepare(
          "SELECT id FROM saved_repositories WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
        )
        .get(savedId, userId) as unknown as { id: string } | undefined;
      if (!owned) continue;
      const exists = db
        .prepare(
          "SELECT id FROM list_items WHERE list_id = ? AND saved_repository_id = ?",
        )
        .get(id, savedId) as unknown as { id: string } | undefined;
      if (exists) continue;
      const itemId = randomUUID();
      const newKey = generateBetween(lastKey, null);
      db.prepare(
        `INSERT INTO list_items (id, list_id, saved_repository_id, position, position_key, version, created_at, updated_at)
         VALUES (?, ?, ?, 0, ?, 1, ?, ?)`,
      ).run(itemId, id, savedId, newKey, nowIso, nowIso);
      recordChange(userId, "list_item", itemId, "created", 1);
    }

    // reorder (fractional indexing between neighbors for desired order)
    if (reorder.length > 0) {
      // Fetch current items sorted by position_key to determine neighbors.
      const currentItems = db
        .prepare(
          `${SELECT_ITEMS} WHERE li.list_id = ? ORDER BY li.position_key ASC, li.position ASC`,
        )
        .all(id) as unknown as ItemRow[];

      // Build a map of saved_repository_id → position_key for current items.
      const keyBySavedId = new Map<string, string>();
      for (const item of currentItems) {
        keyBySavedId.set(item.saved_repository_id, item.position_key);
      }

      // For each item in the desired reorder, compute new fractional key.
      for (let i = 0; i < reorder.length; i++) {
        const savedId = reorder[i];
        const item = db
          .prepare(
            "SELECT id, version FROM list_items WHERE list_id = ? AND saved_repository_id = ?",
          )
          .get(id, savedId) as unknown as
          { id: string; version: number } | undefined;
        if (!item) continue;

        // Find neighbors in the desired order among current items.
        // Items not in reorder list keep their relative position.
        const prevKey = i > 0
          ? keyBySavedId.get(reorder[i - 1]) ?? null
          : null;
        const nextKey = i < reorder.length - 1
          ? keyBySavedId.get(reorder[i + 1]) ?? null
          : null;

        const newKey = generateBetween(prevKey, nextKey);
        const nextVersion = Number(item.version) + 1;
        db.prepare(
          "UPDATE list_items SET position_key = ?, version = ?, updated_at = ? WHERE id = ?",
        ).run(newKey, nextVersion, nowIso, item.id);
        recordChange(userId, "list_item", item.id, "updated", nextVersion);

        // Update the map for subsequent iterations.
        keyBySavedId.set(savedId, newKey);
      }
    }

    const nextListVersion = Number(list.version) + 1;
    db.prepare("UPDATE lists SET version = ?, updated_at = ? WHERE id = ?").run(
      nextListVersion,
      nowIso,
      id,
    );
    recordChange(userId, "list", id, "updated", nextListVersion);
  });

  const items = db
    .prepare(`${SELECT_ITEMS} WHERE li.list_id = ? ORDER BY li.position_key ASC, li.position ASC`)
    .all(id) as unknown as ItemRow[];
  const fresh = db
    .prepare("SELECT * FROM lists WHERE id = ?")
    .get(id) as unknown as ListRow;
  const res = {
    ...serializeList(fresh, items.length),
    items: items.map(serializeItem),
  };
  storeIdempotentResponse(idemKey, userId, res);
  return c.json(res);
});

// Export a list as a portable, sanitized GitStars List document (INH-384/402).
listRoutes.post("/:id/export", (c) => {
  const userId = c.get("userId");
  const doc = exportList(userId, c.req.param("id"));
  if (!doc) return apiError(c, 404, "NOT_FOUND", "List not found");
  return c.json(doc);
});
