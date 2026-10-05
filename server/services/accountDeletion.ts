// server/services/accountDeletion.ts
// Account deletion workflow (INH-476): two-step request → confirm state machine.
//
// Deletion order and atomicity:
// 1. The whole execution runs in ONE SQLite transaction — a failure at any point
//    rolls back completely, so a retry resumes from a clean state and can never
//    leave "account deleted but public share still alive" (no orphan publications).
// 2. Inside the transaction, user-owned rows are removed via FK cascades
//    (saved_repositories, lists → list_items, tags, repository_tags, provider
//    accounts incl. encrypted tokens, remote memberships, preferences, sync
//    states, list_publications → publication_reports, sessions), then the rows
//    WITHOUT a user FK are purged explicitly (change_log, idempotency_keys,
//    audit_events authored by the user). The users row itself goes last.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getDb, inTransaction } from "../db.js";
import { recordAudit } from "./publication.js";

const TOKEN_BYTES = 32;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Step 1: request deletion. Returns the one-time confirmation token (shown to
// the user by the client); only its SHA-256 is persisted.
export function requestDeletion(userId: string): string {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  getDb()
    .prepare(
      `INSERT INTO account_deletions (user_id, token_hash, requested_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET token_hash = excluded.token_hash, requested_at = excluded.requested_at`,
    )
    .run(userId, hashToken(token), new Date().toISOString());
  return token;
}

export function hasPendingDeletion(userId: string): boolean {
  return (
    getDb()
      .prepare("SELECT 1 FROM account_deletions WHERE user_id = ?")
      .get(userId) !== undefined
  );
}

// Step 2: confirm and execute. Returns false on token mismatch/absence.
export function confirmDeletion(userId: string, token: string): boolean {
  const row = getDb()
    .prepare("SELECT token_hash FROM account_deletions WHERE user_id = ?")
    .get(userId) as unknown as { token_hash: string } | undefined;
  if (!row) return false;
  const provided = Buffer.from(hashToken(token));
  const stored = Buffer.from(row.token_hash);
  if (provided.length !== stored.length || !timingSafeEqual(provided, stored)) {
    return false;
  }

  const db = getDb();
  // Audit the deletion intent BEFORE the transaction removes the rows; the
  // audit row itself is purged by the same transaction (actor = user).
  recordAudit(userId, "account_deleted", userId);

  inTransaction(() => {
    // Non-FK user data first (explicit purge; cascade cannot reach these).
    db.prepare("DELETE FROM change_log WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM idempotency_keys WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM audit_events WHERE actor = ?").run(userId);
    // The users row goes last: ON DELETE CASCADE removes sessions, provider
    // accounts (encrypted tokens), saved repositories, lists → list items, tags,
    // memberships, preferences, sync states and list publications (public shares
    // and Hub entries disappear atomically with the account).
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  });
  return true;
}
