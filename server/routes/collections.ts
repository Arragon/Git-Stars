import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { getDb, inTransaction } from "../db.js";
import { requireUser, type AuthedVariables } from "../middleware/auth.js";

interface CollectionRow {
  id: string;
  user_id: string;
  name: string;
  description: string;
  auto_collect_enabled: number;
  created_at: string;
  updated_at: string;
}

interface CollectionProjectRow {
  id: string;
  collection_id: string;
  project_id: string;
  source: "manual" | "auto";
  reason: string | null;
  created_at: string;
  updated_at: string;
}

function serializeCollection(
  row: CollectionRow,
  projects: CollectionProjectRow[] = [],
) {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    description: row.description,
    auto_collect_enabled: Boolean(row.auto_collect_enabled),
    created_at: row.created_at,
    updated_at: row.updated_at,
    collection_projects: projects.map((p) => ({
      id: p.id,
      collection_id: p.collection_id,
      project_id: p.project_id,
      source: p.source,
      reason: p.reason ?? "",
      created_at: p.created_at,
      updated_at: p.updated_at,
    })),
  };
}

function loadOwnedCollection(
  collectionId: string,
  userId: string,
): CollectionRow | null {
  const row = getDb()
    .prepare("SELECT * FROM collections WHERE id = ? AND user_id = ?")
    .get(collectionId, userId) as unknown as CollectionRow | undefined;
  return row ?? null;
}

export const collectionRoutes = new Hono<{ Variables: AuthedVariables }>();

collectionRoutes.use("*", requireUser);

collectionRoutes.get("/", (c) => {
  const userId = c.get("userId");
  const db = getDb();
  const collections = db
    .prepare(
      "SELECT * FROM collections WHERE user_id = ? ORDER BY created_at ASC",
    )
    .all(userId) as unknown as CollectionRow[];

  if (collections.length === 0) return c.json([]);

  const ids = collections.map((col) => col.id);
  const placeholders = ids.map(() => "?").join(",");
  const projects = db
    .prepare(
      `SELECT * FROM collection_projects WHERE collection_id IN (${placeholders})`,
    )
    .all(...ids) as unknown as CollectionProjectRow[];

  const byCollection = new Map<string, CollectionProjectRow[]>();
  for (const project of projects) {
    const list = byCollection.get(project.collection_id) ?? [];
    list.push(project);
    byCollection.set(project.collection_id, list);
  }

  return c.json(
    collections.map((col) =>
      serializeCollection(col, byCollection.get(col.id) ?? []),
    ),
  );
});

collectionRoutes.post("/", async (c) => {
  const userId = c.get("userId");
  let body: {
    name?: unknown;
    description?: unknown;
    auto_collect_enabled?: unknown;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { code: "INVALID_JSON", message: "Request body must be JSON" },
      400,
    );
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return c.json(
      { code: "INVALID_NAME", message: "Collection name is required" },
      400,
    );
  }
  const description =
    typeof body.description === "string" ? body.description : "";
  const autoCollect = body.auto_collect_enabled === true ? 1 : 0;

  const db = getDb();
  const existing = db
    .prepare("SELECT id FROM collections WHERE user_id = ? AND name = ?")
    .get(userId, name) as unknown as { id: string } | undefined;
  if (existing) {
    return c.json(
      {
        code: "DUPLICATE_NAME",
        message: "A collection with this name already exists",
      },
      409,
    );
  }

  const id = randomUUID();
  const nowIso = new Date().toISOString();
  db.prepare(
    `INSERT INTO collections (id, user_id, name, description, auto_collect_enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, userId, name, description, autoCollect, nowIso, nowIso);

  const row = db
    .prepare("SELECT * FROM collections WHERE id = ?")
    .get(id) as unknown as CollectionRow;
  return c.json(serializeCollection(row), 201);
});

collectionRoutes.patch("/:id", async (c) => {
  const userId = c.get("userId");
  const collectionId = c.req.param("id");
  const existing = loadOwnedCollection(collectionId, userId);
  if (!existing) {
    return c.json(
      { code: "COLLECTION_NOT_FOUND", message: "Collection not found" },
      404,
    );
  }

  let body: {
    name?: unknown;
    description?: unknown;
    auto_collect_enabled?: unknown;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { code: "INVALID_JSON", message: "Request body must be JSON" },
      400,
    );
  }

  const name = typeof body.name === "string" ? body.name.trim() : existing.name;
  if (!name) {
    return c.json(
      { code: "INVALID_NAME", message: "Collection name is required" },
      400,
    );
  }
  const description =
    typeof body.description === "string"
      ? body.description
      : existing.description;
  const autoCollect =
    typeof body.auto_collect_enabled === "boolean"
      ? body.auto_collect_enabled
        ? 1
        : 0
      : existing.auto_collect_enabled;

  const db = getDb();
  if (name !== existing.name) {
    const clash = db
      .prepare(
        "SELECT id FROM collections WHERE user_id = ? AND name = ? AND id != ?",
      )
      .get(userId, name, collectionId) as unknown as { id: string } | undefined;
    if (clash) {
      return c.json(
        {
          code: "DUPLICATE_NAME",
          message: "A collection with this name already exists",
        },
        409,
      );
    }
  }

  const nowIso = new Date().toISOString();
  db.prepare(
    `UPDATE collections SET name = ?, description = ?, auto_collect_enabled = ?, updated_at = ? WHERE id = ?`,
  ).run(name, description, autoCollect, nowIso, collectionId);

  const row = db
    .prepare("SELECT * FROM collections WHERE id = ?")
    .get(collectionId) as unknown as CollectionRow;
  const projects = db
    .prepare("SELECT * FROM collection_projects WHERE collection_id = ?")
    .all(collectionId) as unknown as CollectionProjectRow[];
  return c.json(serializeCollection(row, projects));
});

collectionRoutes.delete("/:id", (c) => {
  const userId = c.get("userId");
  const collectionId = c.req.param("id");
  const existing = loadOwnedCollection(collectionId, userId);
  if (!existing) {
    return c.json(
      { code: "COLLECTION_NOT_FOUND", message: "Collection not found" },
      404,
    );
  }
  getDb()
    .prepare("DELETE FROM collections WHERE id = ? AND user_id = ?")
    .run(collectionId, userId);
  return c.json({ ok: true });
});

// -------- collection_projects --------

collectionRoutes.post("/-projects", async (c) => {
  const userId = c.get("userId");
  let body: { items?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { code: "INVALID_JSON", message: "Request body must be JSON" },
      400,
    );
  }

  const items = Array.isArray(body.items) ? body.items : null;
  if (!items || items.length === 0) {
    return c.json(
      { code: "INVALID_PAYLOAD", message: "items array is required" },
      400,
    );
  }

  const db = getDb();
  const nowIso = new Date().toISOString();
  const results: Array<{
    id: string;
    collection_id: string;
    project_id: string;
    source: "manual" | "auto";
    reason: string;
    created_at: string;
    updated_at: string;
  }> = [];

  inTransaction(() => {
    for (const raw of items) {
      const item = raw as {
        collection_id?: unknown;
        project_id?: unknown;
        source?: unknown;
        reason?: unknown;
      };
      const collectionId =
        typeof item.collection_id === "string" ? item.collection_id : "";
      const projectId =
        typeof item.project_id === "string" ? item.project_id : "";
      if (!collectionId || !projectId) continue;

      const collection = loadOwnedCollection(collectionId, userId);
      if (!collection) continue;

      const projectExists = db
        .prepare("SELECT id FROM projects WHERE id = ?")
        .get(projectId) as unknown as { id: string } | undefined;
      if (!projectExists) continue;

      const source: "manual" | "auto" =
        item.source === "auto" ? "auto" : "manual";
      const reason = typeof item.reason === "string" ? item.reason : "";

      const existing = db
        .prepare(
          "SELECT id FROM collection_projects WHERE collection_id = ? AND project_id = ?",
        )
        .get(collectionId, projectId) as unknown as { id: string } | undefined;

      const id = existing?.id ?? randomUUID();
      db.prepare(
        `INSERT INTO collection_projects (id, collection_id, project_id, source, reason, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(collection_id, project_id) DO UPDATE SET
           source = excluded.source,
           reason = excluded.reason,
           updated_at = excluded.updated_at`,
      ).run(id, collectionId, projectId, source, reason, nowIso, nowIso);

      results.push({
        id,
        collection_id: collectionId,
        project_id: projectId,
        source,
        reason,
        created_at: nowIso,
        updated_at: nowIso,
      });
    }
  });

  return c.json({ items: results, inserted: results.length });
});

collectionRoutes.delete("/-projects", async (c) => {
  const userId = c.get("userId");
  let body: { collection_id?: unknown; project_ids?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { code: "INVALID_JSON", message: "Request body must be JSON" },
      400,
    );
  }

  const collectionId =
    typeof body.collection_id === "string" ? body.collection_id : "";
  const projectIds = Array.isArray(body.project_ids)
    ? body.project_ids.filter((id): id is string => typeof id === "string")
    : [];

  if (!collectionId || projectIds.length === 0) {
    return c.json(
      {
        code: "INVALID_PAYLOAD",
        message: "collection_id and project_ids[] are required",
      },
      400,
    );
  }

  const collection = loadOwnedCollection(collectionId, userId);
  if (!collection) {
    return c.json(
      { code: "COLLECTION_NOT_FOUND", message: "Collection not found" },
      404,
    );
  }

  const db = getDb();
  const placeholders = projectIds.map(() => "?").join(",");
  const result = db
    .prepare(
      `DELETE FROM collection_projects WHERE collection_id = ? AND project_id IN (${placeholders})`,
    )
    .run(collectionId, ...projectIds);

  return c.json({ ok: true, deleted: Number(result.changes) });
});
