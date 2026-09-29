import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { getDb } from "../db.js";
import { recordChange } from "../services/mutations.js";
import {
  requestDeletion,
  confirmDeletion,
  hasPendingDeletion,
} from "../services/accountDeletion.js";
import { buildAccountExport } from "../services/accountExport.js";
import {
  bootstrapDb,
  seedUser,
  seedRepository,
  cookieFor,
  teardownDb,
} from "../testing/bootstrap.js";
import { readSession } from "../session.js";

vi.mock("../env.js", () => ({
  env: {
    nodeEnv: "test",
    port: 3001,
    databasePath: ":memory:",
    sessionSecret: "test-secret-key-for-testing",
    publicUrl: "http://localhost:3001",
    cookieSecure: false,
    githubClientId: "",
    githubClientSecret: "",
    localDevUser: "",
    credentialKey: "",
    allowDevLogin: false,
    adminToken: "",
  },
  isProduction: false,
  githubOAuthConfigured: false,
  devLoginEnabled: false,
}));

const USER = "delete-user";

function seedWorld(): void {
  const db = bootstrapDb();
  seedUser(db, USER, "9001", "doomed");
  seedRepository(db, "repo-del-1", {
    remoteId: "700001",
    name: "x",
    fullName: "o/x",
  });
  db.prepare(
    `INSERT INTO saved_repositories (id, user_id, repository_id, status, note, ai_tags, version, added_at, updated_at)
     VALUES ('sr-del-1', ?, 'repo-del-1', 'saved', 'a note', '[]', 1, '2026-01-01', '2026-01-01')`,
  ).run(USER);
  db.prepare(
    `INSERT INTO lists (id, user_id, name, description, version, created_at, updated_at)
     VALUES ('list-del-1', ?, 'Doomed list', '', 1, '2026-01-01', '2026-01-01')`,
  ).run(USER);
  db.prepare(
    `INSERT INTO list_items (id, list_id, saved_repository_id, position, position_key, note, version, created_at, updated_at)
     VALUES ('item-del-1', 'list-del-1', 'sr-del-1', 0, 'a', 'item note', 1, '2026-01-01', '2026-01-01')`,
  ).run();
  db.prepare(
    `INSERT INTO provider_accounts
       (id, user_id, provider_type, host, remote_user_id, remote_username, status, scopes, encrypted_token, created_at, updated_at)
     VALUES ('pa-del-1', ?, 'github', 'github.com', '9001', 'doomed', 'active', 'read:user', 'ciphertext', '2026-01-01', '2026-01-01')`,
  ).run(USER);
  // Seed a live publication for the user (public share + hub opt-in).
  db.prepare(
    `INSERT INTO list_publications
       (id, list_id, user_id, status, hub_opt_in, snapshot_version, title, description, repository_count, payload, created_at, updated_at)
     VALUES ('pub-del-1', 'list-del-1', ?, 'active', 1, 1, 'Doomed list', '', 1, '{}', '2026-01-01', '2026-01-01')`,
  ).run(USER);
  recordChange(USER, "saved_repository", "sr-del-1", "created", 1);
  db.prepare(
    `INSERT INTO idempotency_keys (key, user_id, response, created_at)
     VALUES ('idem-del-1', ?, '{}', '2026-01-01')`,
  ).run(USER);
}

function userExists(userId: string): boolean {
  return (
    getDb().prepare("SELECT 1 FROM users WHERE id = ?").get(userId) !==
    undefined
  );
}

describe("account deletion (INH-476)", () => {
  beforeEach(seedWorld);
  afterEach(() => teardownDb());

  it("export then delete: two-step flow with token hash, wrong token rejected", () => {
    // Export works right before deletion (user can take their data).
    const doc = buildAccountExport(USER);
    expect(doc.library).toHaveLength(1);

    const token = requestDeletion(USER);
    expect(hasPendingDeletion(USER)).toBe(true);
    // Only the hash is stored.
    const stored = (
      getDb()
        .prepare("SELECT token_hash FROM account_deletions WHERE user_id = ?")
        .get(USER) as unknown as { token_hash: string }
    ).token_hash;
    expect(stored).not.toBe(token);
    expect(confirmDeletion(USER, "wrong-token")).toBe(false);
    expect(userExists(USER)).toBe(true);
    // Correct token still works after a failed attempt.
    expect(confirmDeletion(USER, token)).toBe(true);
  });

  it("confirming deletion removes the user and every owned row atomically", () => {
    const token = requestDeletion(USER);
    expect(confirmDeletion(USER, token)).toBe(true);

    const db = getDb();
    expect(userExists(USER)).toBe(false);
    // Cascaded user-owned rows. list_items has no user_id column — its rows
    // cascade via lists; the seed created exactly one globally.
    for (const table of [
      "saved_repositories",
      "lists",
      "provider_accounts",
      "preferences",
      "sync_states",
      "list_publications",
      "account_deletions",
      "sessions",
    ]) {
      const row = db
        .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`)
        .get(USER) as unknown as { n: number };
      expect(row.n).toBe(0);
    }
    expect(
      (
        db.prepare("SELECT COUNT(*) AS n FROM list_items").get() as unknown as {
          n: number;
        }
      ).n,
    ).toBe(0);
    // Non-FK rows purged explicitly.
    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS n FROM change_log WHERE user_id = ?")
          .get(USER) as unknown as { n: number }
      ).n,
    ).toBe(0);
    expect(
      (
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM idempotency_keys WHERE user_id = ?",
          )
          .get(USER) as unknown as { n: number }
      ).n,
    ).toBe(0);
    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS n FROM audit_events WHERE actor = ?")
          .get(USER) as unknown as { n: number }
      ).n,
    ).toBe(0);
    // Public share gone: no active publication with that shareId remains.
    expect(
      db
        .prepare("SELECT COUNT(*) AS n FROM list_publications")
        .get() as unknown as {
        n: number;
      },
    ).toEqual({ n: 0 });
  });

  it("old sessions are invalid after deletion (session rows cascade)", () => {
    const cookieValue = cookieFor(USER).split("=")[1];
    expect(readSession(cookieValue)).not.toBeNull();

    const token = requestDeletion(USER);
    expect(confirmDeletion(USER, token)).toBe(true);
    // The session row cascaded away with the user: every old cookie is dead.
    expect(readSession(cookieValue)).toBeNull();
  });

  it("mid-deletion failure rolls back completely and a retry succeeds (recovery-safe)", () => {
    const db = getDb();
    // Sabotage: a trigger aborts the users DELETE mid-transaction.
    db.exec(
      `CREATE TRIGGER abort_user_delete BEFORE DELETE ON users
       BEGIN SELECT RAISE(ABORT, 'injected failure'); END;`,
    );
    const token = requestDeletion(USER);
    expect(() => confirmDeletion(USER, token)).toThrow(/injected failure/);
    // Nothing was partially deleted: user + publication + change_log intact.
    expect(userExists(USER)).toBe(true);
    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS n FROM list_publications")
          .get() as unknown as { n: number }
      ).n,
    ).toBe(1);
    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS n FROM change_log WHERE user_id = ?")
          .get(USER) as unknown as { n: number }
      ).n,
    ).toBeGreaterThan(0);
    db.exec("DROP TRIGGER abort_user_delete");

    // Retry after fixing the failure completes cleanly (no orphan publications).
    expect(confirmDeletion(USER, token)).toBe(true);
    expect(userExists(USER)).toBe(false);
    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS n FROM list_publications")
          .get() as unknown as { n: number }
      ).n,
    ).toBe(0);
  });
});
