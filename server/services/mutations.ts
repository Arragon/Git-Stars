import { getDb } from "../db.js";

// Shared user-state mutation mechanics (ADR-0004): version bump + change feed + idempotency
// + etag/If-Match. Kept deliberately small; routes compose these helpers.

export type EntityType =
  | "saved_repository"
  | "list"
  | "list_item"
  | "tag"
  | "repository_tag"
  | "preference";

export type ChangeOp = "created" | "updated" | "deleted";

// Append a change-feed entry. Called AFTER the entity row is committed so the feed never
// references an uncommitted write (ADR-0004 D3).
export function recordChange(
  userId: string,
  entityType: EntityType,
  entityId: string,
  op: ChangeOp,
  version: number,
): void {
  getDb()
    .prepare(
      `INSERT INTO change_log (user_id, entity_type, entity_id, op, version, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(userId, entityType, entityId, op, version, new Date().toISOString());
}

export function makeEtag(entityId: string, version: number): string {
  return `"${entityId}:${version}"`;
}

export function parseIfMatch(
  header: string | undefined | null,
): { entityId: string; version: number } | null {
  if (!header) return null;
  const match = /^"?([^:"]+):(\d+)"?$/.exec(header.trim());
  if (!match) return null;
  return { entityId: match[1], version: Number(match[2]) };
}

// Idempotency (ADR-0004 D2): a replayed Idempotency-Key returns the stored response and
// does NOT re-apply the mutation.
export function getIdempotentResponse(
  key: string | undefined | null,
  userId: string,
): string | null {
  if (!key) return null;
  const row = getDb()
    .prepare(
      "SELECT response FROM idempotency_keys WHERE key = ? AND user_id = ?",
    )
    .get(key, userId) as unknown as { response: string } | undefined;
  return row?.response ?? null;
}

export function storeIdempotentResponse(
  key: string | undefined | null,
  userId: string,
  response: unknown,
): void {
  if (!key) return;
  getDb()
    .prepare(
      `INSERT INTO idempotency_keys (key, user_id, response, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(key, user_id) DO NOTHING`,
    )
    .run(key, userId, JSON.stringify(response), new Date().toISOString());
}
