import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";

vi.mock("./env.js", () => ({
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
  },
  isProduction: false,
  githubOAuthConfigured: false,
  devLoginEnabled: false,
}));

import { runMigrations } from "./migrations.js";
import { decryptSecret } from "./crypto.js";
import { resetDbForTests } from "./db.js";

const LEGACY_SCHEMA = `
CREATE TABLE users (
  id TEXT PRIMARY KEY, github_id TEXT UNIQUE NOT NULL, username TEXT NOT NULL, email TEXT,
  avatar_url TEXT, full_name TEXT, access_token TEXT, last_synced_at TEXT, last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE projects (
  id TEXT PRIMARY KEY, github_id INTEGER UNIQUE NOT NULL, name TEXT NOT NULL, full_name TEXT NOT NULL,
  description TEXT, language TEXT, stars_count INTEGER NOT NULL DEFAULT 0, forks_count INTEGER NOT NULL DEFAULT 0,
  html_url TEXT NOT NULL, github_created_at TEXT, github_updated_at TEXT, activity_index REAL NOT NULL DEFAULT 0,
  activity_details TEXT NOT NULL DEFAULT '{}', activity_analyzed_at TEXT, ai_summary TEXT, ai_tags TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE user_projects (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('star','fork')), starred_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, project_id, type)
);
CREATE TABLE collections (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '', auto_collect_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(user_id, name)
);
CREATE TABLE collection_projects (
  id TEXT PRIMARY KEY, collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, source TEXT NOT NULL DEFAULT 'manual',
  reason TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(collection_id, project_id)
);
`;

function seedLegacy(db: DatabaseSync): void {
  db.exec(LEGACY_SCHEMA);
  db.prepare(
    `INSERT INTO users (id, github_id, username, access_token) VALUES ('u1','111','alice','ghp_super_secret')`,
  ).run();
  db.prepare(
    `INSERT INTO projects (id, github_id, name, full_name, html_url, language, stars_count, ai_summary, ai_tags)
     VALUES ('p1', 42, 'hono', 'honojs/hono', 'https://github.com/honojs/hono', 'TypeScript', 100, 'a summary', '["web"]')`,
  ).run();
  db.prepare(
    `INSERT INTO user_projects (id, user_id, project_id, type, starred_at) VALUES ('up1','u1','p1','star','2026-01-01T00:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO collections (id, user_id, name) VALUES ('c1','u1','Faves')`,
  ).run();
  db.prepare(
    `INSERT INTO collection_projects (id, collection_id, project_id) VALUES ('cp1','c1','p1')`,
  ).run();
}

const count = (db: DatabaseSync, table: string): number =>
  Number(
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n,
  );

describe("migration v1: new domain + backfill", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
  });
  afterEach(() => {
    resetDbForTests(null);
  });

  it("creates all new domain tables", () => {
    seedLegacy(db);
    runMigrations(db);
    const tables = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as Array<{ name: string }>
    ).map((t) => t.name);
    for (const name of [
      "repositories",
      "saved_repositories",
      "remote_memberships",
      "provider_accounts",
      "lists",
      "list_items",
      "tags",
      "repository_tags",
      "preferences",
      "sync_states",
      "change_log",
      "idempotency_keys",
      "schema_meta",
      "migrations",
    ]) {
      expect(tables).toContain(name);
    }
  });

  it("backfills repositories, saved_repositories, memberships, lists and list_items", () => {
    seedLegacy(db);
    runMigrations(db);

    const repo = db
      .prepare(
        "SELECT provider_type, host, remote_id, canonical_key, primary_language, stars_count FROM repositories",
      )
      .get() as {
      provider_type: string;
      host: string;
      remote_id: string;
      canonical_key: string;
      primary_language: string;
      stars_count: number;
    };
    expect(repo.provider_type).toBe("github");
    expect(repo.remote_id).toBe("42");
    expect(repo.canonical_key).toBe("github:github.com/honojs/hono");
    expect(repo.primary_language).toBe("TypeScript");

    const saved = db
      .prepare("SELECT ai_summary, ai_tags, status FROM saved_repositories")
      .get() as { ai_summary: string; ai_tags: string; status: string };
    expect(saved.ai_summary).toBe("a summary");
    expect(saved.ai_tags).toBe('["web"]');
    expect(saved.status).toBe("saved");

    const membership = db
      .prepare("SELECT kind, active FROM remote_memberships")
      .get() as { kind: string; active: number };
    expect(membership.kind).toBe("star");
    expect(membership.active).toBe(1);

    expect(count(db, "lists")).toBe(1);
    expect(count(db, "list_items")).toBe(1);
  });

  it("encrypts the provider token into the vault and wipes plaintext users.access_token", () => {
    seedLegacy(db);
    runMigrations(db);
    const acct = db
      .prepare("SELECT encrypted_token FROM provider_accounts")
      .get() as { encrypted_token: string };
    expect(acct.encrypted_token).toBeTruthy();
    expect(acct.encrypted_token).not.toContain("ghp_super_secret");
    expect(decryptSecret(acct.encrypted_token)).toBe("ghp_super_secret");
    const user = db
      .prepare("SELECT access_token FROM users WHERE id = ?")
      .get("u1") as { access_token: string | null };
    expect(user.access_token).toBeNull();
  });

  it("is idempotent: a second run applies no new migrations or rows", () => {
    seedLegacy(db);
    runMigrations(db);
    const reposBefore = count(db, "repositories");
    runMigrations(db);
    expect(count(db, "repositories")).toBe(reposBefore);
    expect(count(db, "migrations")).toBe(2);
  });

  it("protects user knowledge: a repository referenced by a SavedRepository cannot be deleted", () => {
    seedLegacy(db);
    runMigrations(db);
    const repoId = (
      db.prepare("SELECT id FROM repositories").get() as { id: string }
    ).id;
    expect(() =>
      db.prepare("DELETE FROM repositories WHERE id = ?").run(repoId),
    ).toThrow(/FOREIGN KEY constraint failed/i);
    expect(count(db, "saved_repositories")).toBe(1);
  });

  it("deactivating a membership preserves the SavedRepository (unstar invariant)", () => {
    seedLegacy(db);
    runMigrations(db);
    db.prepare("UPDATE remote_memberships SET active = 0").run();
    expect(count(db, "saved_repositories")).toBe(1);
    expect(count(db, "list_items")).toBe(1);
  });
});
