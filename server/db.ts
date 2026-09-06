import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { env } from "./env.js";
import { runMigrations } from "./migrations.js";

const SCHEMA = `
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

CREATE INDEX IF NOT EXISTS idx_users_github_id ON users(github_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_projects_github_id ON projects(github_id);
CREATE INDEX IF NOT EXISTS idx_projects_language ON projects(language);
CREATE INDEX IF NOT EXISTS idx_user_projects_user_id ON user_projects(user_id);
CREATE INDEX IF NOT EXISTS idx_user_projects_project_id ON user_projects(project_id);
CREATE INDEX IF NOT EXISTS idx_collections_user_id ON collections(user_id);
CREATE INDEX IF NOT EXISTS idx_collection_projects_collection_id ON collection_projects(collection_id);
CREATE INDEX IF NOT EXISTS idx_collection_projects_project_id ON collection_projects(project_id);
`;

let dbInstance: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (dbInstance) return dbInstance;
  throw new Error("Database not initialized. Call initDb() first.");
}

export function initDb(databasePath: string = env.databasePath): DatabaseSync {
  if (dbInstance) return dbInstance;

  const absolutePath =
    databasePath === ":memory:" ? ":memory:" : resolve(databasePath);
  if (absolutePath !== ":memory:") {
    mkdirSync(dirname(absolutePath), { recursive: true });
  }

  const db = new DatabaseSync(absolutePath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA);
  // Additive new-domain tables + backfill from legacy (ADR-0003). Legacy tables are kept.
  runMigrations(db);

  dbInstance = db;
  return db;
}

// Test helper: reset the singleton so a fresh in-memory DB can be attached.
export function resetDbForTests(next: DatabaseSync | null): void {
  if (dbInstance && dbInstance !== next) {
    try {
      dbInstance.close();
    } catch {
      // ignore
    }
  }
  dbInstance = next;
}

// Run a callback inside a SQLite transaction. node:sqlite has no .transaction() helper,
// so we manage BEGIN/COMMIT/ROLLBACK manually.
export function inTransaction<T>(fn: () => T): T {
  const db = getDb();
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // ignore rollback failure
    }
    throw error;
  }
}
