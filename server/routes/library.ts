import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { getDb } from "../db.js";
import { requireUser, type AuthedVariables } from "../middleware/auth.js";
import {
  getIdempotentResponse,
  makeEtag,
  parseIfMatch,
  recordChange,
  storeIdempotentResponse,
} from "../services/mutations.js";
import { importCommit, importPreview } from "../services/listsIo.js";
import { apiError } from "../httpErrors.js";

// Library = SavedRepository CRUD (ADR-0003, ADR-0006). User-owned knowledge; provider
// metadata (repositories) is read-only here and rebuilt by sync (M2).

interface JoinedRow {
  id: string;
  user_id: string;
  repository_id: string;
  status: string;
  note: string | null;
  ai_summary: string | null;
  ai_tags: string;
  version: number;
  added_at: string;
  updated_at: string;
  deleted_at: string | null;
  provider_type: string;
  host: string;
  remote_id: string;
  canonical_key: string;
  namespace_path: string | null;
  name: string;
  web_url: string;
  description: string | null;
  visibility: string | null;
  primary_language: string | null;
  stars_count: number;
  forks_count: number;
  repo_status: string;
}

const SELECT_JOIN = `
  SELECT sr.id, sr.user_id, sr.repository_id, sr.status, sr.note, sr.ai_summary, sr.ai_tags,
         sr.version, sr.added_at, sr.updated_at, sr.deleted_at,
         r.provider_type, r.host, r.remote_id, r.canonical_key, r.namespace_path, r.name,
         r.web_url, r.description, r.visibility, r.primary_language, r.stars_count, r.forks_count,
         r.status AS repo_status
  FROM saved_repositories sr JOIN repositories r ON r.id = sr.repository_id`;

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function tagsFor(
  savedIds: string[],
): Map<string, Array<{ id: string; name: string }>> {
  const result = new Map<string, Array<{ id: string; name: string }>>();
  if (savedIds.length === 0) return result;
  const placeholders = savedIds.map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT rt.saved_repository_id AS saved_id, t.id, t.name
       FROM repository_tags rt JOIN tags t ON t.id = rt.tag_id
       WHERE rt.saved_repository_id IN (${placeholders}) ORDER BY t.name ASC`,
    )
    .all(...savedIds) as unknown as Array<{
    saved_id: string;
    id: string;
    name: string;
  }>;
  for (const row of rows) {
    const list = result.get(row.saved_id) ?? [];
    list.push({ id: row.id, name: row.name });
    result.set(row.saved_id, list);
  }
  return result;
}

function serialize(row: JoinedRow, tags: Array<{ id: string; name: string }>) {
  return {
    id: row.id,
    version: Number(row.version),
    etag: makeEtag(row.id, Number(row.version)),
    status: row.status,
    note: row.note ?? undefined,
    aiSummary: row.ai_summary ?? undefined,
    aiTags: parseJson<string[]>(row.ai_tags, []),
    addedAt: row.added_at,
    updatedAt: row.updated_at,
    repository: {
      id: row.repository_id,
      providerType: row.provider_type,
      host: row.host,
      remoteId: row.remote_id,
      canonicalKey: row.canonical_key,
      name: row.name,
      namespacePath: row.namespace_path ?? undefined,
      webUrl: row.web_url,
      description: row.description ?? undefined,
      visibility: row.visibility ?? undefined,
      primaryLanguage: row.primary_language ?? undefined,
      starsCount: Number(row.stars_count),
      forksCount: Number(row.forks_count),
      status: row.repo_status,
    },
    tags,
  };
}

export const libraryRoutes = new Hono<{ Variables: AuthedVariables }>();

libraryRoutes.use("*", requireUser);

libraryRoutes.get("/", (c) => {
  const userId = c.get("userId");
  const provider = c.req.query("provider");
  const status = c.req.query("status");
  const tag = c.req.query("tag");
  const sort = c.req.query("sort") ?? "added_at";
  const order =
    (c.req.query("order") ?? "desc").toLowerCase() === "asc" ? "ASC" : "DESC";

  const where = ["sr.user_id = ?", "sr.deleted_at IS NULL"];
  const params: Array<string | number> = [userId];
  if (provider) {
    where.push("r.provider_type = ?");
    params.push(provider);
  }
  if (status) {
    where.push("sr.status = ?");
    params.push(status);
  }
  if (tag) {
    where.push(
      "EXISTS (SELECT 1 FROM repository_tags rt JOIN tags t ON t.id = rt.tag_id WHERE rt.saved_repository_id = sr.id AND t.name = ?)",
    );
    params.push(tag);
  }
  const sortCol =
    sort === "stars"
      ? "r.stars_count"
      : sort === "name"
        ? "r.name"
        : "sr.added_at";

  const rows = getDb()
    .prepare(
      `${SELECT_JOIN} WHERE ${where.join(" AND ")} ORDER BY ${sortCol} ${order}`,
    )
    .all(...params) as unknown as JoinedRow[];
  const tagMap = tagsFor(rows.map((r) => r.id));
  return c.json(rows.map((r) => serialize(r, tagMap.get(r.id) ?? [])));
});

// Save a repository to the user's library. Idempotent by (user, repository): re-saving an
// existing (or soft-deleted) item restores/returns it rather than duplicating.
libraryRoutes.post("/", async (c) => {
  const userId = c.get("userId");
  const idemKey = c.req.header("Idempotency-Key");
  const cached = getIdempotentResponse(idemKey, userId);
  if (cached) return c.json(JSON.parse(cached) as unknown);

  let body: { repositoryId?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 400, "VALIDATION", "Request body must be JSON");
  }
  const repositoryId =
    typeof body.repositoryId === "string" ? body.repositoryId : "";
  if (!repositoryId)
    return apiError(c, 400, "VALIDATION", "repositoryId is required");

  const db = getDb();
  const repo = db
    .prepare("SELECT id FROM repositories WHERE id = ?")
    .get(repositoryId) as { id: string } | undefined;
  if (!repo) return apiError(c, 404, "NOT_FOUND", "Repository not found");

  const nowIso = new Date().toISOString();
  const existing = db
    .prepare(
      "SELECT id, version, deleted_at FROM saved_repositories WHERE user_id = ? AND repository_id = ?",
    )
    .get(userId, repositoryId) as unknown as
    { id: string; version: number; deleted_at: string | null } | undefined;

  let savedId: string;
  let version: number;
  let op: "created" | "updated";
  if (existing) {
    savedId = existing.id;
    version = Number(existing.version) + 1;
    op = "updated";
    db.prepare(
      `UPDATE saved_repositories SET deleted_at = NULL, status = 'saved', version = ?, updated_at = ? WHERE id = ?`,
    ).run(version, nowIso, savedId);
  } else {
    savedId = randomUUID();
    version = 1;
    op = "created";
    db.prepare(
      `INSERT INTO saved_repositories (id, user_id, repository_id, status, version, added_at, updated_at)
       VALUES (?, ?, ?, 'saved', 1, ?, ?)`,
    ).run(savedId, userId, repositoryId, nowIso, nowIso);
  }
  recordChange(userId, "saved_repository", savedId, op, version);

  const row = db
    .prepare(`${SELECT_JOIN} WHERE sr.id = ?`)
    .get(savedId) as unknown as JoinedRow;
  const res = serialize(row, tagsFor([savedId]).get(savedId) ?? []);
  storeIdempotentResponse(idemKey, userId, res);
  return c.json(res, op === "created" ? 201 : 200);
});

libraryRoutes.get("/:id", (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const row = getDb()
    .prepare(`${SELECT_JOIN} WHERE sr.id = ? AND sr.user_id = ?`)
    .get(id, userId) as unknown as JoinedRow | undefined;
  if (!row || row.deleted_at)
    return apiError(c, 404, "NOT_FOUND", "Saved repository not found");
  return c.json(serialize(row, tagsFor([id]).get(id) ?? []));
});

// Update note/status/ai with an optional If-Match version guard (ADR-0004 D4: version-guarded LWW).
libraryRoutes.put("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const idemKey = c.req.header("Idempotency-Key");
  const cached = getIdempotentResponse(idemKey, userId);
  if (cached) return c.json(JSON.parse(cached) as unknown);

  const db = getDb();
  const current = db
    .prepare(
      "SELECT id, version, note, status, ai_summary, ai_tags FROM saved_repositories WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
    )
    .get(id, userId) as unknown as
    | {
        id: string;
        version: number;
        note: string | null;
        status: string;
        ai_summary: string | null;
        ai_tags: string;
      }
    | undefined;
  if (!current)
    return apiError(c, 404, "NOT_FOUND", "Saved repository not found");

  const ifMatch = parseIfMatch(c.req.header("If-Match"));
  if (ifMatch && ifMatch.version !== Number(current.version)) {
    return apiError(
      c,
      409,
      "VERSION_CONFLICT",
      "Saved repository was modified",
      { current: makeEtag(id, Number(current.version)) },
    );
  }

  let body: {
    note?: unknown;
    status?: unknown;
    aiSummary?: unknown;
    aiTags?: unknown;
  };
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 400, "VALIDATION", "Request body must be JSON");
  }

  const note = typeof body.note === "string" ? body.note : current.note;
  const status = typeof body.status === "string" ? body.status : current.status;
  const aiSummary =
    typeof body.aiSummary === "string" ? body.aiSummary : current.ai_summary;
  const aiTags = Array.isArray(body.aiTags)
    ? JSON.stringify(
        body.aiTags.filter((t): t is string => typeof t === "string"),
      )
    : current.ai_tags;

  const nextVersion = Number(current.version) + 1;
  const nowIso = new Date().toISOString();
  db.prepare(
    `UPDATE saved_repositories SET note = ?, status = ?, ai_summary = ?, ai_tags = ?, version = ?, updated_at = ? WHERE id = ?`,
  ).run(note, status, aiSummary, aiTags, nextVersion, nowIso, id);
  recordChange(userId, "saved_repository", id, "updated", nextVersion);

  const row = db
    .prepare(`${SELECT_JOIN} WHERE sr.id = ?`)
    .get(id) as unknown as JoinedRow;
  const res = serialize(row, tagsFor([id]).get(id) ?? []);
  storeIdempotentResponse(idemKey, userId, res);
  return c.json(res);
});

// Soft delete (tombstone): sets deleted_at + bumps version + emits a change-feed deletion.
libraryRoutes.delete("/:id", (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const db = getDb();
  const current = db
    .prepare(
      "SELECT id, version FROM saved_repositories WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
    )
    .get(id, userId) as unknown as { id: string; version: number } | undefined;
  if (!current)
    return apiError(c, 404, "NOT_FOUND", "Saved repository not found");

  const nextVersion = Number(current.version) + 1;
  db.prepare(
    "UPDATE saved_repositories SET deleted_at = ?, version = ?, updated_at = ? WHERE id = ?",
  ).run(new Date().toISOString(), nextVersion, new Date().toISOString(), id);
  recordChange(userId, "saved_repository", id, "deleted", nextVersion);
  return c.json({ ok: true, version: nextVersion });
});

// Tag attach/detach use set semantics (idempotent) - ADR-0004 D4.
libraryRoutes.put("/:id/tags/:tagId", (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const tagId = c.req.param("tagId");
  const db = getDb();
  const saved = db
    .prepare(
      "SELECT id FROM saved_repositories WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
    )
    .get(id, userId) as { id: string } | undefined;
  if (!saved)
    return apiError(c, 404, "NOT_FOUND", "Saved repository not found");
  const tag = db
    .prepare("SELECT id FROM tags WHERE id = ? AND user_id = ?")
    .get(tagId, userId) as { id: string } | undefined;
  if (!tag) return apiError(c, 404, "NOT_FOUND", "Tag not found");

  const nowIso = new Date().toISOString();
  db.prepare(
    `INSERT INTO repository_tags (tag_id, saved_repository_id, created_at) VALUES (?, ?, ?)
     ON CONFLICT(tag_id, saved_repository_id) DO NOTHING`,
  ).run(tagId, id, nowIso);
  recordChange(userId, "repository_tag", `${id}:${tagId}`, "created", 1);
  return c.json({ ok: true });
});

libraryRoutes.delete("/:id/tags/:tagId", (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const tagId = c.req.param("tagId");
  const db = getDb();
  const saved = db
    .prepare("SELECT id FROM saved_repositories WHERE id = ? AND user_id = ?")
    .get(id, userId) as { id: string } | undefined;
  if (!saved)
    return apiError(c, 404, "NOT_FOUND", "Saved repository not found");
  db.prepare(
    "DELETE FROM repository_tags WHERE tag_id = ? AND saved_repository_id = ?",
  ).run(tagId, id);
  recordChange(userId, "repository_tag", `${id}:${tagId}`, "deleted", 0);
  return c.json({ ok: true });
});

// Import a portable List: dry-run preview by default; mutate only on explicit confirm
// (INH-402, ARCHITECTURE.md 25). Untrusted input is size-guarded, parsed, validated, sanitized.
libraryRoutes.post("/import", async (c) => {
  const userId = c.get("userId");
  let body: { text?: unknown; confirm?: unknown; listName?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 400, "VALIDATION", "Request body must be JSON");
  }
  const text = typeof body.text === "string" ? body.text : "";
  if (!text)
    return apiError(c, 400, "VALIDATION", "text (raw list JSON) is required");

  if (body.confirm === true) {
    const result = importCommit(userId, text, {
      listName: typeof body.listName === "string" ? body.listName : undefined,
    });
    if (!result.ok) {
      return apiError(c, 400, "VALIDATION", "Import validation failed", {
        errors: result.errors,
      });
    }
    return c.json({ dryRun: false, ...result });
  }

  const preview = importPreview(userId, text);
  if (!preview.ok) {
    return apiError(c, 400, "VALIDATION", "Import validation failed", {
      errors: preview.errors,
    });
  }
  return c.json({ dryRun: true, ...preview });
});
