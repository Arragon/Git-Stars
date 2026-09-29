import { randomBytes, randomUUID } from "node:crypto";
import { getDb, inTransaction } from "../db.js";
import {
  LIST_FORMAT,
  LIST_SCHEMA_VERSION,
  type ListExport,
} from "../../src/lib/list-format.js";

// M5 sharing & hub engine (INH-431/435/437/443/447).
//
// IMPORTANT: publications are NOT user-state sync entities (ADR-0004 D1 lists the
// sync units; shares are not among them). Nothing here may call recordChange — the
// change feed is only for replicated user state. Audit events (audit_events) are
// the operational trail for publish/unpublish/hub/report/takedown actions.

export type PublicationStatus = "active" | "revoked" | "takedown";

export const REPORT_REASONS = [
  "spam",
  "inappropriate",
  "copyright",
  "other",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_DETAIL_MAX = 500;
export const SHARE_ID_LENGTH = 26;

// Crockford base32 (no I/L/O/U) over 128 random bits -> 26 chars. Deliberately
// NOT a UUID and NOT the internal list id: it is the only public handle.
const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function generateShareId(): string {
  const bytes = randomBytes(16);
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let out = "";
  for (let i = 0; i < SHARE_ID_LENGTH; i++) {
    out = CROCKFORD_ALPHABET[Number(value % 32n)] + out;
    value /= 32n;
  }
  return out;
}

// --- Sanitized snapshot payload (what gets frozen into a publication) ---

export interface SnapshotItem {
  providerType: string;
  host: string;
  remoteId: string;
  canonicalKey: string;
  name: string;
  webUrl: string;
  description: string | null;
  primaryLanguage: string | null;
  starsCount: number;
}

export type SnapshotEntry = SnapshotItem | { unavailable: true };

export interface ListSnapshotPayload {
  title: string;
  description: string;
  repositoryCount: number;
  items: SnapshotEntry[];
}

interface SnapshotRow {
  provider_type: string;
  host: string;
  remote_id: string;
  canonical_key: string;
  name: string;
  web_url: string;
  description: string | null;
  primary_language: string | null;
  stars_count: number;
  visibility: string | null;
}

// Build the sanitized public payload for an owned list: order preserved by
// position_key, private repositories replaced by { unavailable: true }
// placeholders (count preserved so the page can show "N items unavailable").
// Notes, tags, AI data, user ids, emails, tokens and internal UUIDs never enter.
export function buildSnapshot(
  userId: string,
  listId: string,
): ListSnapshotPayload | null {
  const db = getDb();
  const list = db
    .prepare(
      "SELECT name, description FROM lists WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
    )
    .get(listId, userId) as unknown as
    { name: string; description: string } | undefined;
  if (!list) return null;

  const rows = db
    .prepare(
      `SELECT r.provider_type, r.host, r.remote_id, r.canonical_key, r.name, r.web_url,
              r.description, r.primary_language, r.stars_count, r.visibility
       FROM list_items li
       JOIN saved_repositories sr ON sr.id = li.saved_repository_id
       JOIN repositories r ON r.id = sr.repository_id
       WHERE li.list_id = ?
       ORDER BY li.position_key ASC, li.position ASC`,
    )
    .all(listId) as unknown as SnapshotRow[];

  const items: SnapshotEntry[] = rows.map((r) => {
    if (r.visibility !== null && r.visibility !== "public") {
      return { unavailable: true };
    }
    return {
      providerType: r.provider_type,
      host: r.host,
      remoteId: r.remote_id,
      canonicalKey: r.canonical_key,
      name: r.name,
      webUrl: r.web_url,
      description: r.description,
      primaryLanguage: r.primary_language,
      starsCount: Number(r.stars_count),
    };
  });
  return {
    title: list.name,
    description: list.description ?? "",
    repositoryCount: rows.length,
    items,
  };
}

// --- Publication rows ---

interface PublicationRow {
  id: string;
  list_id: string;
  user_id: string;
  status: string;
  hub_opt_in: number;
  snapshot_version: number;
  title: string;
  description: string;
  repository_count: number;
  payload: string;
  created_at: string;
  updated_at: string;
}

export interface PublicationView {
  shareId: string;
  status: PublicationStatus;
  snapshotVersion: number;
  title: string;
  repositoryCount: number;
  updatedAt: string;
  shareUrl: string;
  hubOptIn: boolean;
}

export function serializePublication(row: PublicationRow): PublicationView {
  return {
    shareId: row.id,
    status: row.status as PublicationStatus,
    snapshotVersion: Number(row.snapshot_version),
    title: row.title,
    repositoryCount: Number(row.repository_count),
    updatedAt: row.updated_at,
    shareUrl: `/s/${row.id}`,
    hubOptIn: Boolean(row.hub_opt_in),
  };
}

function recordAudit(
  actor: string,
  action: string,
  subject: string,
  meta: Record<string, unknown> = {},
): void {
  getDb()
    .prepare(
      `INSERT INTO audit_events (id, actor, action, subject, meta, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      actor,
      action,
      subject,
      JSON.stringify(meta),
      new Date().toISOString(),
    );
}

export type PublishMode = "created" | "republished" | "reactivated";

export type PublishResult =
  | { ok: true; mode: PublishMode; publication: PublicationView }
  | { ok: false; reason: "not_found" | "takedown" };

// Publish / republish a list. Upsert keyed by UNIQUE(list_id): first publish
// mints a shareId (audit 'publish'), an active publication is refreshed in place
// with snapshot_version+1 (audit 'republish'), a revoked one is reactivated
// (audit 'publish'). A takedown can only be lifted by an admin, never by
// republishing.
export function publish(userId: string, listId: string): PublishResult {
  const db = getDb();
  const snapshot = buildSnapshot(userId, listId);
  if (!snapshot) return { ok: false, reason: "not_found" };

  const existing = db
    .prepare("SELECT * FROM list_publications WHERE list_id = ?")
    .get(listId) as unknown as PublicationRow | undefined;
  const now = new Date().toISOString();

  return inTransaction(() => {
    if (!existing) {
      const shareId = generateShareId();
      db.prepare(
        `INSERT INTO list_publications
           (id, list_id, user_id, status, hub_opt_in, snapshot_version, title, description,
            repository_count, payload, created_at, updated_at)
         VALUES (?, ?, ?, 'active', 0, 1, ?, ?, ?, ?, ?, ?)`,
      ).run(
        shareId,
        listId,
        userId,
        snapshot.title,
        snapshot.description,
        snapshot.repositoryCount,
        JSON.stringify(snapshot),
        now,
        now,
      );
      recordAudit(userId, "publish", shareId);
      const row = db
        .prepare("SELECT * FROM list_publications WHERE id = ?")
        .get(shareId) as unknown as PublicationRow;
      return {
        ok: true as const,
        mode: "created" as const,
        publication: serializePublication(row),
      };
    }

    if (existing.status === "takedown") {
      return { ok: false as const, reason: "takedown" as const };
    }

    const mode: PublishMode =
      existing.status === "active" ? "republished" : "reactivated";
    const nextVersion = Number(existing.snapshot_version) + 1;
    db.prepare(
      `UPDATE list_publications SET status = 'active', snapshot_version = ?, title = ?,
         description = ?, repository_count = ?, payload = ?, updated_at = ? WHERE id = ?`,
    ).run(
      nextVersion,
      snapshot.title,
      snapshot.description,
      snapshot.repositoryCount,
      JSON.stringify(snapshot),
      now,
      existing.id,
    );
    recordAudit(
      userId,
      mode === "reactivated" ? "publish" : "republish",
      existing.id,
    );
    const row = db
      .prepare("SELECT * FROM list_publications WHERE id = ?")
      .get(existing.id) as unknown as PublicationRow;
    return { ok: true as const, mode, publication: serializePublication(row) };
  });
}

function loadPublication(shareId: string): PublicationRow | null {
  const row = getDb()
    .prepare("SELECT * FROM list_publications WHERE id = ?")
    .get(shareId) as unknown as PublicationRow | undefined;
  return row ?? null;
}

// Owner-only status lookup (never public): resolve by list id or shareId.
export function getPublicationRow(
  userId: string,
  target: { shareId?: string; listId?: string },
): PublicationRow | null {
  const db = getDb();
  const row = (target.shareId !== undefined
    ? db
        .prepare("SELECT * FROM list_publications WHERE id = ? AND user_id = ?")
        .get(target.shareId, userId)
    : db
        .prepare(
          "SELECT * FROM list_publications WHERE list_id = ? AND user_id = ?",
        )
        .get(target.listId, userId)) as unknown as PublicationRow | undefined;
  return row ?? null;
}

// --- Public read model ---

export interface PublicSnapshotItem extends SnapshotItem {
  repositoryId?: string;
}

export interface PublicSnapshot {
  shareId: string;
  title: string;
  description: string;
  repositoryCount: number;
  availableCount: number;
  updatedAt: string;
  hubOptIn: boolean;
  items: Array<PublicSnapshotItem | { unavailable: true }>;
}

// Anonymous read of an active publication. Each available item is resolved at
// read time to the internal repositories.id (join by provider identity) so
// logged-in viewers can open the Repository View; unresolvable or since-then
// privatized items degrade to { unavailable: true } with no id/name leaked.
// Returns null for unknown, revoked and takedown shareIds alike (callers must
// answer 404 with an identical message so shareIds cannot be enumerated).
export function getPublicSnapshot(shareId: string): PublicSnapshot | null {
  const row = loadPublication(shareId);
  if (!row || row.status !== "active") return null;
  const payload = JSON.parse(row.payload) as ListSnapshotPayload;
  const resolve = getDb().prepare(
    "SELECT id, visibility FROM repositories WHERE provider_type = ? AND host = ? AND canonical_key = ?",
  );
  let availableCount = 0;
  const items: Array<PublicSnapshotItem | { unavailable: true }> =
    payload.items.map((item) => {
      if ("unavailable" in item) return { unavailable: true };
      const repo = resolve.get(
        item.providerType,
        item.host,
        item.canonicalKey,
      ) as unknown as { id: string; visibility: string | null } | undefined;
      if (!repo || (repo.visibility !== null && repo.visibility !== "public")) {
        return { unavailable: true };
      }
      availableCount += 1;
      return { ...item, repositoryId: repo.id };
    });
  return {
    shareId: row.id,
    title: payload.title,
    description: payload.description,
    repositoryCount: Number(row.repository_count),
    availableCount,
    updatedAt: row.updated_at,
    hubOptIn: Boolean(row.hub_opt_in),
    items,
  };
}

// Revoke (unpublish). Owner-scoped; accepts either the shareId or the list id.
export function revoke(
  userId: string,
  target: { shareId?: string; listId?: string },
): boolean {
  const db = getDb();
  const row = (target.shareId !== undefined
    ? db
        .prepare(
          "SELECT id FROM list_publications WHERE id = ? AND user_id = ?",
        )
        .get(target.shareId, userId)
    : db
        .prepare(
          "SELECT id FROM list_publications WHERE list_id = ? AND user_id = ?",
        )
        .get(target.listId, userId)) as unknown as { id: string } | undefined;
  if (!row) return false;
  db.prepare(
    "UPDATE list_publications SET status = 'revoked', updated_at = ? WHERE id = ?",
  ).run(new Date().toISOString(), row.id);
  recordAudit(userId, "unpublish", row.id);
  return true;
}

// Hub visibility toggle. Only allowed while the publication is active.
export function setHubOptIn(
  userId: string,
  listId: string,
  optIn: boolean,
): boolean {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT id, status, hub_opt_in FROM list_publications WHERE list_id = ? AND user_id = ?",
    )
    .get(listId, userId) as unknown as
    { id: string; status: string; hub_opt_in: number } | undefined;
  if (!row || row.status !== "active") return false;
  if (Boolean(row.hub_opt_in) !== optIn) {
    db.prepare(
      "UPDATE list_publications SET hub_opt_in = ?, updated_at = ? WHERE id = ?",
    ).run(optIn ? 1 : 0, new Date().toISOString(), row.id);
    recordAudit(userId, optIn ? "hub_opt_in" : "hub_opt_out", row.id);
  }
  return true;
}

// --- Hub catalog ---

export interface CatalogEntry {
  shareId: string;
  title: string;
  description: string;
  repositoryCount: number;
  updatedAt: string;
}

export interface CatalogPage {
  items: CatalogEntry[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface CatalogQuery {
  q?: string;
  sort?: "recent" | "title";
  cursor?: string;
  limit?: number;
}

// Opaque keyset cursor: base64("<sort key>|<id>"). id (a shareId) never
// contains "|", so decode splits on the LAST pipe.
function encodeCursor(key: string, id: string): string {
  return Buffer.from(`${key}|${id}`, "utf8").toString("base64");
}

function decodeCursor(
  cursor: string | undefined,
): { key: string; id: string } | null {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, "base64").toString("utf8");
    const idx = raw.lastIndexOf("|");
    if (idx <= 0 || idx === raw.length - 1) return null;
    return { key: raw.slice(0, idx), id: raw.slice(idx + 1) };
  } catch {
    return null;
  }
}

// Hub catalog: ONLY active + hub_opt_in publications are ever visible here.
// Link-only (hub_opt_in=0), revoked and takedown publications are excluded by
// the WHERE clause itself, not by post-filtering. Keyset pagination keeps the
// result deterministic for identical queries.
export function listCatalog(query: CatalogQuery): CatalogPage {
  const db = getDb();
  const limit = Math.min(Math.max(1, Math.floor(query.limit ?? 20)), 50);
  const sort = query.sort === "title" ? "title" : "recent";

  const where = ["hub_opt_in = 1", "status = 'active'"];
  const params: Array<string | number> = [];
  if (query.q) {
    const escaped = query.q.replace(/[\\%_]/g, (ch) => `\\${ch}`);
    where.push("(title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')");
    params.push(`%${escaped}%`, `%${escaped}%`);
  }

  let orderBy: string;
  let cursorSql = "";
  const cursor = decodeCursor(query.cursor);
  const cursorParams: Array<string> = [];
  if (sort === "recent") {
    orderBy = "updated_at DESC, id DESC";
    if (cursor) {
      cursorSql = " AND (updated_at < ? OR (updated_at = ? AND id < ?))";
      cursorParams.push(cursor.key, cursor.key, cursor.id);
    }
  } else {
    orderBy = "title COLLATE NOCASE ASC, id ASC";
    if (cursor) {
      cursorSql =
        " AND (title > ? COLLATE NOCASE OR (title COLLATE NOCASE = ? COLLATE NOCASE AND id > ?))";
      cursorParams.push(cursor.key, cursor.key, cursor.id);
    }
  }

  const rows = db
    .prepare(
      `SELECT id, title, description, repository_count, updated_at
       FROM list_publications
       WHERE ${where.join(" AND ")}${cursorSql}
       ORDER BY ${orderBy}
       LIMIT ?`,
    )
    .all(...params, ...cursorParams, limit + 1) as unknown as Array<{
    id: string;
    title: string;
    description: string;
    repository_count: number;
    updated_at: string;
  }>;

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCursor(sort === "recent" ? last.updated_at : last.title, last.id)
      : null;
  return {
    items: page.map((r) => ({
      shareId: r.id,
      title: r.title,
      description: r.description,
      repositoryCount: Number(r.repository_count),
      updatedAt: r.updated_at,
    })),
    nextCursor,
    hasMore,
  };
}

// --- Reports & takedown ---

export type ReportOutcome = "ok" | "invalid_reason" | "not_found";

export function recordReport(
  shareId: string,
  reason: string,
  detail?: string,
): ReportOutcome {
  if (!(REPORT_REASONS as readonly string[]).includes(reason)) {
    return "invalid_reason";
  }
  const row = loadPublication(shareId);
  // Unknown shareId: accept silently (the route answers 202 either way so
  // existence cannot be probed); there is just no report row to attach.
  if (!row) return "not_found";
  const capped =
    typeof detail === "string" ? detail.slice(0, REPORT_DETAIL_MAX) : null;
  getDb()
    .prepare(
      `INSERT INTO publication_reports (id, publication_id, reason, detail, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(randomUUID(), row.id, reason, capped, new Date().toISOString());
  recordAudit("anonymous", "report", shareId, { reason });
  return "ok";
}

// Admin takedown. The private source list is never touched; the publication
// simply stops resolving publicly. Only an admin can lift this (republish is
// refused while status='takedown').
export function takedown(shareId: string): boolean {
  const row = loadPublication(shareId);
  if (!row) return false;
  getDb()
    .prepare(
      "UPDATE list_publications SET status = 'takedown', updated_at = ? WHERE id = ?",
    )
    .run(new Date().toISOString(), shareId);
  recordAudit("admin", "takedown", shareId);
  return true;
}

// --- Import bridge (public snapshot -> portable List v0) ---

function pathFromCanonicalKey(
  prefix: string,
  canonicalKey: string,
): string | undefined {
  return canonicalKey.startsWith(prefix)
    ? canonicalKey.slice(prefix.length) || undefined
    : undefined;
}

// Build a PortableList v0 document from a public snapshot so the existing
// import engine (server/services/listsIo.ts) can be reused verbatim: available
// entries map to portable sources, unavailable placeholders are dropped, and
// unknown providers are retained as 'unresolved' by the engine.
export function snapshotToPortable(snapshot: PublicSnapshot): ListExport {
  return {
    format: LIST_FORMAT,
    schema_version: LIST_SCHEMA_VERSION,
    title: `${snapshot.title} (imported)`,
    description: snapshot.description || undefined,
    exported_at: new Date().toISOString(),
    items: snapshot.items.flatMap((item) => {
      if ("unavailable" in item) return [];
      const prefix = `${item.providerType}:${item.host}/`;
      const path = pathFromCanonicalKey(prefix, item.canonicalKey);
      return [
        {
          source: {
            provider: item.providerType,
            host: item.host,
            remote_id: item.remoteId,
            ...(path ? { path } : {}),
          },
        },
      ];
    }),
  };
}
