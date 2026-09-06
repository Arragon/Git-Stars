import { randomUUID } from "node:crypto";
import { getDb, inTransaction } from "../db.js";
import { getProvider } from "../providers/registry.js";
import { recordChange } from "./mutations.js";
import {
  LIST_FORMAT,
  LIST_SCHEMA_VERSION,
  parseListExport,
  sanitizeItems,
  type ListExport,
} from "../../src/lib/list-format.js";

// Lists/Library export + import engine (INH-402, ARCHITECTURE.md 22-27).
// Pipeline: size -> parse -> validate -> sanitize -> preview -> confirm -> import.
// Import is idempotent and never silently discards unknown-provider items (retained as
// repositories with status 'unresolved' so they can be resolved later).

function defaultHost(provider: string): string {
  return getProvider(provider)?.defaultHost ?? provider;
}

export function exportList(userId: string, listId: string): ListExport | null {
  const db = getDb();
  const list = db
    .prepare(
      "SELECT id, name, description FROM lists WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
    )
    .get(listId, userId) as unknown as
    { id: string; name: string; description: string } | undefined;
  if (!list) return null;

  const rows = db
    .prepare(
      `SELECT sr.id AS saved_id, sr.note AS note, r.provider_type, r.host, r.remote_id, r.namespace_path, r.name, r.visibility
       FROM list_items li
       JOIN saved_repositories sr ON sr.id = li.saved_repository_id
       JOIN repositories r ON r.id = sr.repository_id
       WHERE li.list_id = ? ORDER BY li.position ASC`,
    )
    .all(listId) as unknown as Array<{
    saved_id: string;
    note: string | null;
    provider_type: string;
    host: string;
    remote_id: string;
    namespace_path: string | null;
    name: string;
    visibility: string | null;
  }>;

  const savedIds = rows.map((r) => r.saved_id);
  const tagMap = new Map<string, string[]>();
  if (savedIds.length > 0) {
    const tagRows = db
      .prepare(
        `SELECT rt.saved_repository_id AS saved_id, t.name FROM repository_tags rt JOIN tags t ON t.id = rt.tag_id
         WHERE rt.saved_repository_id IN (${savedIds.map(() => "?").join(",")})`,
      )
      .all(...savedIds) as unknown as Array<{ saved_id: string; name: string }>;
    for (const t of tagRows) {
      const arr = tagMap.get(t.saved_id) ?? [];
      arr.push(t.name);
      tagMap.set(t.saved_id, arr);
    }
  }

  const items = sanitizeItems(
    rows.map((r) => ({
      provider: r.provider_type,
      host: r.host,
      remoteId: r.remote_id,
      path: r.namespace_path ? `${r.namespace_path}/${r.name}` : r.name,
      visibility: r.visibility,
      note: r.note,
      tags: tagMap.get(r.saved_id),
    })),
  );

  return {
    format: LIST_FORMAT,
    schema_version: LIST_SCHEMA_VERSION,
    title: list.name,
    description: list.description || undefined,
    exported_at: new Date().toISOString(),
    items,
  };
}

export type ImportItemStatus = "existing" | "new" | "unresolved";

export interface ImportPreview {
  ok: boolean;
  errors: string[];
  title?: string;
  summary: { total: number; existing: number; new: number; unresolved: number };
  items: Array<{
    provider: string;
    host: string;
    remoteId: string;
    path?: string;
    status: ImportItemStatus;
  }>;
}

export function importPreview(userId: string, text: string): ImportPreview {
  const { doc, errors } = parseListExport(text);
  const emptySummary = { total: 0, existing: 0, new: 0, unresolved: 0 };
  if (!doc) return { ok: false, errors, summary: emptySummary, items: [] };

  const db = getDb();
  const items = doc.items.map((item) => {
    const host = item.source.host || defaultHost(item.source.provider);
    const repo = db
      .prepare(
        "SELECT id FROM repositories WHERE provider_type = ? AND host = ? AND remote_id = ?",
      )
      .get(item.source.provider, host, item.source.remote_id) as unknown as
      { id: string } | undefined;
    let status: ImportItemStatus;
    if (repo) {
      const saved = db
        .prepare(
          "SELECT id FROM saved_repositories WHERE user_id = ? AND repository_id = ? AND deleted_at IS NULL",
        )
        .get(userId, repo.id);
      status = saved ? "existing" : "new";
    } else {
      status = getProvider(item.source.provider) ? "new" : "unresolved";
    }
    return {
      provider: item.source.provider,
      host,
      remoteId: item.source.remote_id,
      path: item.source.path,
      status,
    };
  });

  const summary = {
    total: items.length,
    existing: items.filter((i) => i.status === "existing").length,
    new: items.filter((i) => i.status === "new").length,
    unresolved: items.filter((i) => i.status === "unresolved").length,
  };
  return { ok: true, errors: [], title: doc.title, summary, items };
}

function ensureTag(userId: string, name: string, nowIso: string): string {
  const db = getDb();
  const existing = db
    .prepare("SELECT id FROM tags WHERE user_id = ? AND name = ?")
    .get(userId, name) as unknown as { id: string } | undefined;
  if (existing) return existing.id;
  const id = randomUUID();
  db.prepare(
    "INSERT INTO tags (id, user_id, name, created_at) VALUES (?, ?, ?, ?)",
  ).run(id, userId, name, nowIso);
  recordChange(userId, "tag", id, "created", 1);
  return id;
}

export interface ImportCommitResult {
  ok: boolean;
  errors: string[];
  listId?: string;
  counts?: {
    total: number;
    imported: number;
    existing: number;
    unresolved: number;
  };
}

// Commit an import. Idempotent: re-importing the same list does not duplicate repositories,
// saved items, or list memberships.
export function importCommit(
  userId: string,
  text: string,
  opts: { listName?: string } = {},
): ImportCommitResult {
  const { doc, errors } = parseListExport(text);
  if (!doc) return { ok: false, errors };

  const db = getDb();
  const nowIso = new Date().toISOString();
  const listName = (opts.listName ?? "").trim() || doc.title || "Imported";
  const counts = {
    total: doc.items.length,
    imported: 0,
    existing: 0,
    unresolved: 0,
  };
  let listId = "";

  inTransaction(() => {
    const existingList = db
      .prepare(
        "SELECT id FROM lists WHERE user_id = ? AND name = ? AND deleted_at IS NULL",
      )
      .get(userId, listName) as unknown as { id: string } | undefined;
    if (existingList) {
      listId = existingList.id;
    } else {
      listId = randomUUID();
      db.prepare(
        `INSERT INTO lists (id, user_id, name, description, version, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)`,
      ).run(listId, userId, listName, doc.description ?? "", nowIso, nowIso);
      recordChange(userId, "list", listId, "created", 1);
    }

    const maxPos = db
      .prepare(
        "SELECT COALESCE(MAX(position), -1) AS m FROM list_items WHERE list_id = ?",
      )
      .get(listId) as unknown as { m: number };
    let position = Number(maxPos.m) + 1;

    for (const item of doc.items) {
      const provider = item.source.provider;
      const host = item.source.host || defaultHost(provider);
      const path = item.source.path ?? "";
      const slash = path.lastIndexOf("/");
      const name =
        slash > 0 ? path.slice(slash + 1) : path || item.source.remote_id;
      const namespace = slash > 0 ? path.slice(0, slash) : null;

      const existingRepo = db
        .prepare(
          "SELECT id FROM repositories WHERE provider_type = ? AND host = ? AND remote_id = ?",
        )
        .get(provider, host, item.source.remote_id) as unknown as
        { id: string } | undefined;
      let repositoryId: string;
      if (existingRepo) {
        repositoryId = existingRepo.id;
      } else {
        repositoryId = randomUUID();
        const known = Boolean(getProvider(provider));
        if (!known) counts.unresolved += 1;
        db.prepare(
          `INSERT INTO repositories
             (id, provider_type, host, remote_id, canonical_key, namespace_path, name, web_url, visibility,
              status, stars_count, forks_count, provider_data, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'public', ?, 0, 0, '{}', ?, ?)`,
        ).run(
          repositoryId,
          provider,
          host,
          item.source.remote_id,
          `${provider}:${host}/${path || item.source.remote_id}`,
          namespace,
          name,
          path ? `https://${host}/${path}` : `https://${host}/`,
          known ? "imported" : "unresolved",
          nowIso,
          nowIso,
        );
      }

      const existingSaved = db
        .prepare(
          "SELECT id FROM saved_repositories WHERE user_id = ? AND repository_id = ?",
        )
        .get(userId, repositoryId) as unknown as { id: string } | undefined;
      let savedId: string;
      if (existingSaved) {
        savedId = existingSaved.id;
        counts.existing += 1;
        db.prepare(
          "UPDATE saved_repositories SET deleted_at = NULL, note = COALESCE(?, note), updated_at = ? WHERE id = ?",
        ).run(item.note ?? null, nowIso, savedId);
      } else {
        savedId = randomUUID();
        db.prepare(
          `INSERT INTO saved_repositories (id, user_id, repository_id, status, note, version, added_at, updated_at)
           VALUES (?, ?, ?, 'saved', ?, 1, ?, ?)`,
        ).run(savedId, userId, repositoryId, item.note ?? null, nowIso, nowIso);
        recordChange(userId, "saved_repository", savedId, "created", 1);
        counts.imported += 1;
      }

      for (const tagName of item.tags ?? []) {
        const tagId = ensureTag(userId, tagName, nowIso);
        db.prepare(
          `INSERT INTO repository_tags (tag_id, saved_repository_id, created_at) VALUES (?, ?, ?)
           ON CONFLICT(tag_id, saved_repository_id) DO NOTHING`,
        ).run(tagId, savedId, nowIso);
      }

      const existingItem = db
        .prepare(
          "SELECT id FROM list_items WHERE list_id = ? AND saved_repository_id = ?",
        )
        .get(listId, savedId) as unknown as { id: string } | undefined;
      if (!existingItem) {
        const itemId = randomUUID();
        db.prepare(
          `INSERT INTO list_items (id, list_id, saved_repository_id, position, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?)`,
        ).run(itemId, listId, savedId, position, nowIso, nowIso);
        position += 1;
        recordChange(userId, "list_item", itemId, "created", 1);
      }
    }
  });

  return { ok: true, errors: [], listId, counts };
}
