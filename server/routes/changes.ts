import { Hono } from "hono";
import { getDb } from "../db.js";
import { requireUser, type AuthedVariables } from "../middleware/auth.js";
import { PROTOCOL_VERSION } from "../versions.js";
import { makeEtag } from "../services/mutations.js";
import { apiError } from "../httpErrors.js";

// Change feed pull endpoint (ADR-0004 D6). Client passes the last seen seq as `since`.
// Each entry carries an optional `data` payload with the row's current committed state
// (additive optional field per ADR-0004 D5) so pull clients can materialize their local
// replica without a per-entity refetch. Payloads contain user-state fields only — never
// provider tokens or credentials.
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

  // INH-410: a cursor ahead of the user's feed tail (e.g. after a server-side database
  // reset) can never converge — the client would see an empty feed forever. Signal a
  // full re-pull instead; pending client mutations are unaffected.
  const tailRow = getDb()
    .prepare("SELECT MAX(seq) AS maxSeq FROM change_log WHERE user_id = ?")
    .get(userId) as unknown as { maxSeq: number | null };
  const feedTail = tailRow?.maxSeq ? Number(tailRow.maxSeq) : 0;
  if (since > feedTail) {
    return apiError(
      c,
      410,
      "CURSOR_INVALID",
      "Sync cursor is ahead of the change feed; full re-pull required",
      { current: feedTail },
    );
  }

  const rows = getDb()
    .prepare(
      `SELECT seq, entity_type, entity_id, op, version, created_at
       FROM change_log WHERE user_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?`,
    )
    .all(userId, since, limit + 1) as unknown as ChangeRow[];

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const payloadBySeq = buildPayloads(userId, page);
  const changes = page.map((r) => ({
    seq: Number(r.seq),
    entityType: r.entity_type,
    entityId: r.entity_id,
    op: r.op,
    version: Number(r.version),
    createdAt: r.created_at,
    data: payloadBySeq.get(Number(r.seq)) ?? null,
  }));
  const nextCursor = page.length ? Number(page[page.length - 1].seq) : since;

  return c.json({
    changes,
    nextCursor,
    hasMore,
    protocolVersion: PROTOCOL_VERSION,
  });
});

// Attach current-row payloads for one feed page: one batched query per entity type.
// Rows hard-deleted on the server (list_item, tag, repository_tag) get `data: null` —
// the client deletes by entityId. Tombstoned rows (saved_repository, list) keep their
// row so the payload carries `deletedAt`.
function buildPayloads(
  userId: string,
  rows: ChangeRow[],
): Map<number, Record<string, unknown>> {
  const result = new Map<number, Record<string, unknown>>();
  if (rows.length === 0) return result;

  const byType = new Map<string, ChangeRow[]>();
  for (const r of rows) {
    const list = byType.get(r.entity_type) ?? [];
    list.push(r);
    byType.set(r.entity_type, list);
  }

  const db = getDb();
  const ids = (list: ChangeRow[]) => list.map((r) => r.entity_id);
  const placeholders = (n: number) =>
    n > 0 ? Array(n).fill("?").join(",") : "''";

  // saved_repositories: tombstones remain as rows.
  const savedChanges = byType.get("saved_repository");
  if (savedChanges) {
    const table = db
      .prepare(
        `SELECT id, repository_id, status, note, ai_tags, version, added_at, updated_at, deleted_at
         FROM saved_repositories WHERE user_id = ? AND id IN (${placeholders(savedChanges.length)})`,
      )
      .all(userId, ...ids(savedChanges)) as unknown as Array<{
      id: string;
      repository_id: string;
      status: string;
      note: string | null;
      ai_tags: string;
      version: number;
      added_at: string;
      updated_at: string;
      deleted_at: string | null;
    }>;
    const rowById = new Map(table.map((r) => [r.id, r]));
    for (const change of savedChanges) {
      const row = rowById.get(change.entity_id);
      result.set(
        Number(change.seq),
        row
          ? {
              repositoryId: row.repository_id,
              status: row.status,
              note: row.note ?? undefined,
              aiTags: safeParseArray(row.ai_tags),
              version: Number(row.version),
              etag: makeEtag(row.id, Number(row.version)),
              addedAt: row.added_at,
              updatedAt: row.updated_at,
              ...(row.deleted_at ? { deletedAt: row.deleted_at } : {}),
            }
          : null,
      );
    }
  }

  // lists: tombstones remain as rows.
  const listChanges = byType.get("list");
  if (listChanges) {
    const table = db
      .prepare(
        `SELECT id, name, description, version, created_at, updated_at, deleted_at
         FROM lists WHERE user_id = ? AND id IN (${placeholders(listChanges.length)})`,
      )
      .all(userId, ...ids(listChanges)) as unknown as Array<{
      id: string;
      name: string;
      description: string;
      version: number;
      created_at: string;
      updated_at: string;
      deleted_at: string | null;
    }>;
    const rowById = new Map(table.map((r) => [r.id, r]));
    for (const change of listChanges) {
      const row = rowById.get(change.entity_id);
      result.set(
        Number(change.seq),
        row
          ? {
              name: row.name,
              description: row.description,
              version: Number(row.version),
              etag: makeEtag(row.id, Number(row.version)),
              createdAt: row.created_at,
              updatedAt: row.updated_at,
              ...(row.deleted_at ? { deletedAt: row.deleted_at } : {}),
            }
          : null,
      );
    }
  }

  // list_items: hard-deleted rows leave no trace; `data: null` means "delete locally".
  const itemChanges = byType.get("list_item");
  if (itemChanges) {
    const table = db
      .prepare(
        `SELECT id, list_id, saved_repository_id, position, position_key, note, version, created_at, updated_at
         FROM list_items WHERE id IN (${placeholders(itemChanges.length)})`,
      )
      .all(...ids(itemChanges)) as unknown as Array<{
      id: string;
      list_id: string;
      saved_repository_id: string;
      position: number;
      position_key: string;
      note: string | null;
      version: number;
      created_at: string;
      updated_at: string;
    }>;
    const rowById = new Map(table.map((r) => [r.id, r]));
    for (const change of itemChanges) {
      const row = rowById.get(change.entity_id);
      result.set(
        Number(change.seq),
        row
          ? {
              listId: row.list_id,
              savedRepositoryId: row.saved_repository_id,
              position: row.position_key || String(Number(row.position)),
              note: row.note ?? undefined,
              version: Number(row.version),
              createdAt: row.created_at,
              updatedAt: row.updated_at,
            }
          : null,
      );
    }
  }

  // tags: hard-deleted.
  const tagChanges = byType.get("tag");
  if (tagChanges) {
    const table = db
      .prepare(
        `SELECT id, name, created_at FROM tags WHERE id IN (${placeholders(tagChanges.length)})`,
      )
      .all(...ids(tagChanges)) as unknown as Array<{
      id: string;
      name: string;
      created_at: string;
    }>;
    const rowById = new Map(table.map((r) => [r.id, r]));
    for (const change of tagChanges) {
      const row = rowById.get(change.entity_id);
      result.set(
        Number(change.seq),
        row ? { name: row.name, createdAt: row.created_at } : null,
      );
    }
  }

  // repository_tag: entityId is `${savedRepositoryId}:${tagId}` (see routes/library.ts),
  // so even hard-deleted entries can reconstruct the client's composite key.
  const repoTagChanges = byType.get("repository_tag");
  if (repoTagChanges) {
    const liveIds = repoTagChanges
      .filter((r) => r.op !== "deleted")
      .map((r) => r.entity_id);
    const rowById = new Map<
      string,
      { tag_id: string; saved_repository_id: string; created_at: string }
    >();
    if (liveIds.length > 0) {
      const table = db
        .prepare(
          `SELECT tag_id, saved_repository_id, created_at FROM repository_tags
           WHERE saved_repository_id || ':' || tag_id IN (${placeholders(liveIds.length)})`,
        )
        .all(...liveIds) as unknown as Array<{
        tag_id: string;
        saved_repository_id: string;
        created_at: string;
      }>;
      for (const r of table) {
        rowById.set(`${r.saved_repository_id}:${r.tag_id}`, r);
      }
    }
    for (const change of repoTagChanges) {
      const row = rowById.get(change.entity_id);
      if (row) {
        result.set(Number(change.seq), {
          tagId: row.tag_id,
          savedRepositoryId: row.saved_repository_id,
          createdAt: row.created_at,
        });
      } else {
        const [savedRepositoryId, tagId] = change.entity_id.split(":");
        result.set(
          Number(change.seq),
          savedRepositoryId && tagId ? { savedRepositoryId, tagId } : null,
        );
      }
    }
  }

  // preferences: singleton row per user.
  const prefChanges = byType.get("preference");
  if (prefChanges) {
    const row = db
      .prepare(
        "SELECT data, version, updated_at FROM preferences WHERE user_id = ?",
      )
      .get(userId) as unknown as
      | {
          data: string;
          version: number;
          updated_at: string;
        }
      | undefined;
    for (const change of prefChanges) {
      result.set(
        Number(change.seq),
        row
          ? {
              data: safeParseObject(row.data),
              version: Number(row.version),
              etag: makeEtag(userId, Number(row.version)),
              updatedAt: row.updated_at,
            }
          : null,
      );
    }
  }

  return result;
}

function safeParseArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

function safeParseObject(
  raw: string | null | undefined,
): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
