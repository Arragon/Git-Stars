import { DatabaseSync } from "node:sqlite";
import { runMigrations } from "../migrations.js";
import { resetDbForTests } from "../db.js";
import {
  createSession,
  encodeCookieValue,
  SESSION_COOKIE_NAME,
} from "../session.js";

// Shared test bootstrap: an in-memory DB with the legacy schema + all new-domain migrations
// applied, matching what initDb() produces at runtime. Not a *.test.ts file, so Vitest does
// not collect it as a suite.

export const LEGACY_SCHEMA = `
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

export function bootstrapDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(LEGACY_SCHEMA);
  runMigrations(db);
  resetDbForTests(db);
  return db;
}

export function teardownDb(): void {
  resetDbForTests(null);
}

export function seedUser(
  db: DatabaseSync,
  id: string,
  githubId: string,
  username: string,
): void {
  db.prepare(
    "INSERT INTO users (id, github_id, username) VALUES (?, ?, ?)",
  ).run(id, githubId, username);
}

export function seedRepository(
  db: DatabaseSync,
  id: string,
  opts: {
    remoteId?: string;
    name?: string;
    fullName?: string;
    provider?: string;
  } = {},
): void {
  const provider = opts.provider ?? "github";
  const name = opts.name ?? "hono";
  const fullName = opts.fullName ?? "honojs/hono";
  db.prepare(
    `INSERT INTO repositories
       (id, provider_type, host, remote_id, canonical_key, namespace_path, name, web_url,
        visibility, stars_count, forks_count, status, created_at, updated_at)
     VALUES (?, ?, 'github.com', ?, ?, ?, ?, ?, 'public', 100, 5, 'active', '2026-01-01', '2026-01-01')`,
  ).run(
    id,
    provider,
    opts.remoteId ?? "42",
    `${provider}:github.com/${fullName}`,
    fullName.split("/")[0] ?? null,
    name,
    `https://github.com/${fullName}`,
  );
}

// Create a session for the user and return the Cookie header value for authenticated requests.
export function cookieFor(userId: string): string {
  const session = createSession(userId);
  return `${SESSION_COOKIE_NAME}=${encodeCookieValue(session.id)}`;
}
