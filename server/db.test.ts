import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

// Mock env before importing db
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
  },
  isProduction: false,
  githubOAuthConfigured: false,
  devLoginEnabled: false,
}));

import { resetDbForTests } from "./db.js";

// Re-create the schema inline for testing (mirrors server/db.ts SCHEMA).
const TEST_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  github_id TEXT UNIQUE NOT NULL,
  username TEXT NOT NULL,
  email TEXT,
  avatar_url TEXT,
  full_name TEXT,
  access_token TEXT,
  last_synced_at TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  github_id INTEGER UNIQUE NOT NULL,
  name TEXT NOT NULL,
  full_name TEXT NOT NULL,
  description TEXT,
  language TEXT,
  stars_count INTEGER NOT NULL DEFAULT 0,
  forks_count INTEGER NOT NULL DEFAULT 0,
  html_url TEXT NOT NULL,
  github_created_at TEXT,
  github_updated_at TEXT,
  activity_index REAL NOT NULL DEFAULT 0,
  activity_details TEXT NOT NULL DEFAULT '{}',
  activity_analyzed_at TEXT,
  ai_summary TEXT,
  ai_tags TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('star', 'fork')),
  starred_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, project_id, type)
);

CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  auto_collect_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, name)
);

CREATE TABLE IF NOT EXISTS collection_projects (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'auto')),
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(collection_id, project_id)
);
`;

describe("SQLite schema", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(TEST_SCHEMA);
    resetDbForTests(db);
  });

  afterEach(() => {
    resetDbForTests(null);
  });

  it("creates all required tables", () => {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);

    expect(names).toContain("users");
    expect(names).toContain("sessions");
    expect(names).toContain("projects");
    expect(names).toContain("user_projects");
    expect(names).toContain("collections");
    expect(names).toContain("collection_projects");
  });

  it("enforces UNIQUE constraint on users.github_id", () => {
    const id1 = randomUUID();
    const id2 = randomUUID();

    db.prepare(
      "INSERT INTO users (id, github_id, username) VALUES (?, ?, ?)",
    ).run(id1, "gh-123", "alice");

    expect(() => {
      db.prepare(
        "INSERT INTO users (id, github_id, username) VALUES (?, ?, ?)",
      ).run(id2, "gh-123", "bob");
    }).toThrow(/UNIQUE constraint failed/i);
  });

  it("enforces UNIQUE constraint on collections(user_id, name)", () => {
    const userId = randomUUID();
    db.prepare(
      "INSERT INTO users (id, github_id, username) VALUES (?, ?, ?)",
    ).run(userId, "gh-1", "alice");

    db.prepare(
      "INSERT INTO collections (id, user_id, name) VALUES (?, ?, ?)",
    ).run(randomUUID(), userId, "My List");

    expect(() => {
      db.prepare(
        "INSERT INTO collections (id, user_id, name) VALUES (?, ?, ?)",
      ).run(randomUUID(), userId, "My List");
    }).toThrow(/UNIQUE constraint failed/i);
  });

  it("cascades user deletion to sessions, user_projects, and collections", () => {
    const userId = randomUUID();
    const projectId = randomUUID();
    const collectionId = randomUUID();

    db.prepare(
      "INSERT INTO users (id, github_id, username) VALUES (?, ?, ?)",
    ).run(userId, "gh-1", "alice");
    db.prepare(
      "INSERT INTO projects (id, github_id, name, full_name, html_url) VALUES (?, ?, ?, ?, ?)",
    ).run(projectId, 1, "repo", "owner/repo", "https://github.com/owner/repo");
    db.prepare(
      "INSERT INTO user_projects (id, user_id, project_id, type) VALUES (?, ?, ?, ?)",
    ).run(randomUUID(), userId, projectId, "star");
    db.prepare(
      "INSERT INTO collections (id, user_id, name) VALUES (?, ?, ?)",
    ).run(collectionId, userId, "My List");
    db.prepare(
      "INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)",
    ).run(randomUUID(), userId, Date.now() + 100000);

    db.prepare("DELETE FROM users WHERE id = ?").run(userId);

    const sessions = db
      .prepare("SELECT COUNT(*) as count FROM sessions WHERE user_id = ?")
      .get(userId) as { count: number };
    const userProjects = db
      .prepare("SELECT COUNT(*) as count FROM user_projects WHERE user_id = ?")
      .get(userId) as { count: number };
    const collections = db
      .prepare("SELECT COUNT(*) as count FROM collections WHERE user_id = ?")
      .get(userId) as { count: number };

    expect(sessions.count).toBe(0);
    expect(userProjects.count).toBe(0);
    expect(collections.count).toBe(0);
  });

  it("cascades collection deletion to collection_projects", () => {
    const userId = randomUUID();
    const projectId = randomUUID();
    const collectionId = randomUUID();

    db.prepare(
      "INSERT INTO users (id, github_id, username) VALUES (?, ?, ?)",
    ).run(userId, "gh-1", "alice");
    db.prepare(
      "INSERT INTO projects (id, github_id, name, full_name, html_url) VALUES (?, ?, ?, ?, ?)",
    ).run(projectId, 1, "repo", "owner/repo", "https://github.com/owner/repo");
    db.prepare(
      "INSERT INTO collections (id, user_id, name) VALUES (?, ?, ?)",
    ).run(collectionId, userId, "My List");
    db.prepare(
      "INSERT INTO collection_projects (id, collection_id, project_id) VALUES (?, ?, ?)",
    ).run(randomUUID(), collectionId, projectId);

    db.prepare("DELETE FROM collections WHERE id = ?").run(collectionId);

    const links = db
      .prepare(
        "SELECT COUNT(*) as count FROM collection_projects WHERE collection_id = ?",
      )
      .get(collectionId) as { count: number };
    expect(links.count).toBe(0);
  });

  it("enforces CHECK constraint on user_projects.type", () => {
    const userId = randomUUID();
    const projectId = randomUUID();

    db.prepare(
      "INSERT INTO users (id, github_id, username) VALUES (?, ?, ?)",
    ).run(userId, "gh-1", "alice");
    db.prepare(
      "INSERT INTO projects (id, github_id, name, full_name, html_url) VALUES (?, ?, ?, ?, ?)",
    ).run(projectId, 1, "repo", "owner/repo", "https://github.com/owner/repo");

    expect(() => {
      db.prepare(
        "INSERT INTO user_projects (id, user_id, project_id, type) VALUES (?, ?, ?, ?)",
      ).run(randomUUID(), userId, projectId, "invalid");
    }).toThrow(/CHECK constraint failed/i);
  });
});
