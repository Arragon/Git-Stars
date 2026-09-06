import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { encryptSecret } from "./crypto.js";
import { MIN_APP_VERSION } from "./versions.js";
import { generateBetween } from "./lib/fractionalIndex.js";

// Additive migration runner (ADR-0003, ARCHITECTURE.md 33, Roadmap rule 12).
// Legacy tables (projects/user_projects/collections/collection_projects) are NEVER dropped
// here; new domain tables are added and backfilled. Removal is a later, separate phase.

export interface Migration {
  version: number;
  name: string;
  up(db: DatabaseSync): void;
}

function all<T>(db: DatabaseSync, sql: string): T[] {
  return db.prepare(sql).all() as unknown as T[];
}

const DOMAIN_DDL = `
CREATE TABLE IF NOT EXISTS repositories (
  id TEXT PRIMARY KEY,
  provider_type TEXT NOT NULL,
  host TEXT NOT NULL,
  remote_id TEXT NOT NULL,
  canonical_key TEXT NOT NULL,
  namespace_path TEXT,
  name TEXT NOT NULL,
  web_url TEXT NOT NULL,
  description TEXT,
  visibility TEXT,
  primary_language TEXT,
  stars_count INTEGER NOT NULL DEFAULT 0,
  forks_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  provider_created_at TEXT,
  provider_updated_at TEXT,
  metadata_fetched_at TEXT,
  provider_data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(provider_type, host, remote_id)
);

CREATE TABLE IF NOT EXISTS provider_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_type TEXT NOT NULL,
  host TEXT NOT NULL,
  remote_user_id TEXT,
  remote_username TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  scopes TEXT NOT NULL DEFAULT '',
  encrypted_token TEXT,
  token_updated_at TEXT,
  last_verified_at TEXT,
  connection_meta TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, provider_type, host, remote_user_id)
);

CREATE TABLE IF NOT EXISTS saved_repositories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'saved',
  note TEXT,
  ai_summary TEXT,
  ai_tags TEXT NOT NULL DEFAULT '[]',
  version INTEGER NOT NULL DEFAULT 1,
  added_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(user_id, repository_id)
);

CREATE TABLE IF NOT EXISTS remote_memberships (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  provider_account_id TEXT REFERENCES provider_accounts(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  remote_created_at TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  source_data TEXT NOT NULL DEFAULT '{}',
  UNIQUE(user_id, repository_id, provider_account_id, kind)
);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, name)
);

CREATE TABLE IF NOT EXISTS repository_tags (
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  saved_repository_id TEXT NOT NULL REFERENCES saved_repositories(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY(tag_id, saved_repository_id)
);

CREATE TABLE IF NOT EXISTS lists (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(user_id, name)
);

CREATE TABLE IF NOT EXISTS list_items (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  saved_repository_id TEXT NOT NULL REFERENCES saved_repositories(id) ON DELETE CASCADE,
  position REAL NOT NULL DEFAULT 0,
  note TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(list_id, saved_repository_id)
);

CREATE TABLE IF NOT EXISTS preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_states (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_account_id TEXT REFERENCES provider_accounts(id) ON DELETE CASCADE,
  resource_kind TEXT NOT NULL,
  cursor TEXT NOT NULL DEFAULT '{}',
  cursor_version INTEGER NOT NULL DEFAULT 1,
  last_attempt_at TEXT,
  last_success_at TEXT,
  last_full_reconcile_at TEXT,
  last_error_code TEXT,
  last_error_message TEXT,
  UNIQUE(user_id, provider_account_id, resource_kind)
);

CREATE TABLE IF NOT EXISTS change_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  op TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT NOT NULL,
  user_id TEXT NOT NULL,
  response TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(key, user_id)
);

CREATE INDEX IF NOT EXISTS idx_repositories_identity ON repositories(provider_type, host, remote_id);
CREATE INDEX IF NOT EXISTS idx_provider_accounts_user ON provider_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_repositories_user ON saved_repositories(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_repositories_repo ON saved_repositories(repository_id);
CREATE INDEX IF NOT EXISTS idx_remote_memberships_user ON remote_memberships(user_id, active);
CREATE INDEX IF NOT EXISTS idx_remote_memberships_repo ON remote_memberships(repository_id);
CREATE INDEX IF NOT EXISTS idx_tags_user ON tags(user_id);
CREATE INDEX IF NOT EXISTS idx_repository_tags_saved ON repository_tags(saved_repository_id);
CREATE INDEX IF NOT EXISTS idx_lists_user ON lists(user_id);
CREATE INDEX IF NOT EXISTS idx_list_items_list ON list_items(list_id, position);
CREATE INDEX IF NOT EXISTS idx_list_items_saved ON list_items(saved_repository_id);
CREATE INDEX IF NOT EXISTS idx_sync_states_user ON sync_states(user_id);
CREATE INDEX IF NOT EXISTS idx_change_log_user_seq ON change_log(user_id, seq);
`;

function migrationV1(db: DatabaseSync): void {
  db.exec(DOMAIN_DDL);

  const nowIso = new Date().toISOString();
  const uuid = () => randomUUID();

  // 1. provider_accounts from users (encrypt plaintext token, then wipe the plaintext).
  const providerAccountIdByUser = new Map<string, string>();
  const users = all<{
    id: string;
    github_id: string;
    username: string | null;
    access_token: string | null;
  }>(db, "SELECT id, github_id, username, access_token FROM users");
  const insertAccount = db.prepare(
    `INSERT INTO provider_accounts
       (id, user_id, provider_type, host, remote_user_id, remote_username, status, scopes,
        encrypted_token, token_updated_at, last_verified_at, created_at, updated_at)
     VALUES (?, ?, 'github', 'github.com', ?, ?, 'active', ?, ?, ?, ?, ?, ?)`,
  );
  for (const u of users) {
    const userId = String(u.id);
    const token =
      typeof u.access_token === "string" && u.access_token
        ? u.access_token
        : null;
    const accountId = uuid();
    insertAccount.run(
      accountId,
      userId,
      String(u.github_id),
      u.username ?? null,
      token ? "read:user user:email" : "",
      token ? encryptSecret(token) : null,
      token ? nowIso : null,
      nowIso,
      nowIso,
      nowIso,
    );
    providerAccountIdByUser.set(userId, accountId);
  }
  // Wipe plaintext tokens now that they live encrypted in the vault (ADR-0005 D3).
  db.prepare("UPDATE users SET access_token = NULL").run();

  // 2. repositories from projects.
  const repoIdByProjectId = new Map<string, string>();
  const projects = all<{
    id: string;
    github_id: number;
    name: string;
    full_name: string;
    description: string | null;
    language: string | null;
    stars_count: number;
    forks_count: number;
    html_url: string;
    github_created_at: string | null;
    github_updated_at: string | null;
    updated_at: string | null;
  }>(
    db,
    `SELECT id, github_id, name, full_name, description, language, stars_count, forks_count,
            html_url, github_created_at, github_updated_at, updated_at
     FROM projects`,
  );
  const insertRepo = db.prepare(
    `INSERT INTO repositories
       (id, provider_type, host, remote_id, canonical_key, namespace_path, name, web_url,
        description, visibility, primary_language, stars_count, forks_count, status,
        provider_created_at, provider_updated_at, metadata_fetched_at, provider_data, created_at, updated_at)
     VALUES (?, 'github', 'github.com', ?, ?, ?, ?, ?, ?, 'public', ?, ?, ?, 'active', ?, ?, ?, '{}', ?, ?)`,
  );
  for (const p of projects) {
    const fullName = String(p.full_name ?? "");
    const slash = fullName.indexOf("/");
    const namespace = slash > 0 ? fullName.slice(0, slash) : null;
    const repoId = uuid();
    insertRepo.run(
      repoId,
      String(p.github_id),
      `github:github.com/${fullName}`,
      namespace,
      String(p.name ?? fullName),
      String(p.html_url ?? ""),
      p.description ?? null,
      p.language ?? null,
      Number(p.stars_count ?? 0),
      Number(p.forks_count ?? 0),
      p.github_created_at ?? null,
      p.github_updated_at ?? null,
      p.updated_at ?? nowIso,
      nowIso,
      nowIso,
    );
    repoIdByProjectId.set(String(p.id), repoId);
  }

  // 3. saved_repositories (one per distinct user+project) carrying AI metadata forward.
  const savedIdByUserProject = new Map<string, string>();
  const pairs = all<{
    user_id: string;
    project_id: string;
    ai_summary: string | null;
    ai_tags: string | null;
    added_at: string | null;
  }>(
    db,
    `SELECT DISTINCT up.user_id AS user_id, up.project_id AS project_id,
            p.ai_summary AS ai_summary, p.ai_tags AS ai_tags,
            MIN(up.created_at) AS added_at
     FROM user_projects up JOIN projects p ON p.id = up.project_id
     GROUP BY up.user_id, up.project_id`,
  );
  const insertSaved = db.prepare(
    `INSERT INTO saved_repositories
       (id, user_id, repository_id, status, note, ai_summary, ai_tags, version, added_at, updated_at, deleted_at)
     VALUES (?, ?, ?, 'saved', NULL, ?, ?, 1, ?, ?, NULL)`,
  );
  for (const r of pairs) {
    const repositoryId = repoIdByProjectId.get(String(r.project_id));
    if (!repositoryId) continue;
    const savedId = uuid();
    const addedAt = String(r.added_at ?? nowIso);
    insertSaved.run(
      savedId,
      String(r.user_id),
      repositoryId,
      r.ai_summary ?? null,
      typeof r.ai_tags === "string" && r.ai_tags ? r.ai_tags : "[]",
      addedAt,
      addedAt,
    );
    savedIdByUserProject.set(
      `${String(r.user_id)}:${String(r.project_id)}`,
      savedId,
    );
  }

  // 4. remote_memberships from user_projects (star/fork), active.
  const insertMembership = db.prepare(
    `INSERT INTO remote_memberships
       (id, user_id, repository_id, provider_account_id, kind, active, remote_created_at, first_seen_at, last_seen_at, source_data)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, '{}')`,
  );
  const memberships = all<{
    user_id: string;
    project_id: string;
    type: string;
    starred_at: string | null;
    created_at: string | null;
  }>(
    db,
    "SELECT user_id, project_id, type, starred_at, created_at FROM user_projects",
  );
  for (const m of memberships) {
    const repositoryId = repoIdByProjectId.get(String(m.project_id));
    if (!repositoryId) continue;
    const seen = String(m.starred_at ?? m.created_at ?? nowIso);
    insertMembership.run(
      uuid(),
      String(m.user_id),
      repositoryId,
      providerAccountIdByUser.get(String(m.user_id)) ?? null,
      String(m.type),
      m.starred_at ?? null,
      seen,
      seen,
    );
  }

  // 5. lists from collections (reuse collection id as list id; both are UUIDs).
  const collections = all<{
    id: string;
    user_id: string;
    name: string;
    description: string | null;
    created_at: string | null;
    updated_at: string | null;
  }>(
    db,
    "SELECT id, user_id, name, description, created_at, updated_at FROM collections",
  );
  const insertList = db.prepare(
    `INSERT INTO lists (id, user_id, name, description, version, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, NULL)`,
  );
  for (const col of collections) {
    insertList.run(
      String(col.id),
      String(col.user_id),
      String(col.name),
      col.description ?? "",
      String(col.created_at ?? nowIso),
      String(col.updated_at ?? nowIso),
    );
  }

  // 6. list_items from collection_projects (ensure a saved_repository exists for the owner).
  const positionByList = new Map<string, number>();
  const insertListItem = db.prepare(
    `INSERT INTO list_items (id, list_id, saved_repository_id, position, note, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, 1, ?, ?)`,
  );
  const links = all<{
    collection_id: string;
    project_id: string;
    created_at: string | null;
    user_id: string;
  }>(
    db,
    `SELECT cp.collection_id AS collection_id, cp.project_id AS project_id, cp.created_at AS created_at,
            c.user_id AS user_id
     FROM collection_projects cp JOIN collections c ON c.id = cp.collection_id
     ORDER BY cp.created_at ASC`,
  );
  for (const l of links) {
    const userId = String(l.user_id);
    const projectId = String(l.project_id);
    const listId = String(l.collection_id);
    let savedId = savedIdByUserProject.get(`${userId}:${projectId}`);
    if (!savedId) {
      // Collection member the user never starred/forked: materialize a saved_repository.
      const repositoryId = repoIdByProjectId.get(projectId);
      if (!repositoryId) continue;
      savedId = uuid();
      const addedAt = String(l.created_at ?? nowIso);
      insertSaved.run(
        savedId,
        userId,
        repositoryId,
        null,
        "[]",
        addedAt,
        addedAt,
      );
      savedIdByUserProject.set(`${userId}:${projectId}`, savedId);
    }
    const pos = positionByList.get(listId) ?? 0;
    positionByList.set(listId, pos + 1);
    const created = String(l.created_at ?? nowIso);
    insertListItem.run(uuid(), listId, savedId, pos, created, created);
  }
}

function migrationV2(db: DatabaseSync): void {
  // Idempotent: check if position_key column already exists.
  const cols = all<{ name: string }>(db, "PRAGMA table_info('list_items')");
  if (cols.some((c) => c.name === "position_key")) return;

  db.exec(
    "ALTER TABLE list_items ADD COLUMN position_key TEXT NOT NULL DEFAULT ''",
  );

  // Backfill: for each list, order items by position ASC, assign fractional keys
  // with generous spacing.
  const lists = all<{ id: string }>(db, "SELECT id FROM lists");
  for (const list of lists) {
    const rows = db
      .prepare(
        "SELECT id, position FROM list_items WHERE list_id = ? ORDER BY position ASC",
      )
      .all(list.id) as Array<{ id: string; position: number }>;

    const n = rows.length;
    for (let i = 0; i < n; i++) {
      const key = generateKeyForIndex(i);
      db.prepare("UPDATE list_items SET position_key = ? WHERE id = ?").run(
        key,
        rows[i].id,
      );
    }
  }

  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_list_items_list_position_key ON list_items(list_id, position_key)",
  );
}

// Generate a fractional key for a given index with generous spacing.
// Uses single letters spaced apart: 'd','h','l','p','t','x' for up to ~6 items,
// then falls back to fractional subdivision.
function generateKeyForIndex(i: number): string {
  // First 20 items get single letters with spacing of ~1.3 letters apart.
  const spacedLetters = [
    "a",
    "d",
    "g",
    "j",
    "m",
    "p",
    "s",
    "v",
    "y",
    "ac",
    "af",
    "ai",
    "al",
    "ao",
    "ar",
    "au",
    "ax",
    "ba",
    "bd",
    "bg",
  ];
  if (i < spacedLetters.length) return spacedLetters[i];
  // Beyond 20: append fractional suffix to last.
  return "bg" + generateBetween(null, null); // 'bgm' fallback
}

export const MIGRATIONS: Migration[] = [
  { version: 1, name: "new_domain_tables_and_backfill", up: migrationV1 },
  { version: 2, name: "list_items_position_key_fractional", up: migrationV2 },
];

export function latestSchemaVersion(): number {
  return MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0);
}

// Apply pending migrations in order, each in its own transaction, then record schema_meta.
export function runMigrations(db: DatabaseSync): { applied: number[] } {
  db.exec(
    `CREATE TABLE IF NOT EXISTS migrations (
       version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL
     );
     CREATE TABLE IF NOT EXISTS schema_meta (
       id INTEGER PRIMARY KEY CHECK (id = 1),
       schema_version INTEGER NOT NULL,
       minimum_app_version TEXT,
       updated_at TEXT NOT NULL
     );`,
  );

  const appliedVersions = new Set(
    all<{ version: number }>(db, "SELECT version FROM migrations").map((r) =>
      Number(r.version),
    ),
  );
  const pending = MIGRATIONS.filter(
    (m) => !appliedVersions.has(m.version),
  ).sort((a, b) => a.version - b.version);

  const applied: number[] = [];
  for (const migration of pending) {
    db.exec("BEGIN");
    try {
      migration.up(db);
      db.prepare(
        "INSERT INTO migrations (version, name, applied_at) VALUES (?, ?, ?)",
      ).run(migration.version, migration.name, new Date().toISOString());
      db.exec("COMMIT");
      applied.push(migration.version);
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // ignore rollback failure
      }
      throw error;
    }
  }

  const nowIso = new Date().toISOString();
  db.prepare(
    `INSERT INTO schema_meta (id, schema_version, minimum_app_version, updated_at)
     VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       schema_version = excluded.schema_version,
       minimum_app_version = excluded.minimum_app_version,
       updated_at = excluded.updated_at`,
  ).run(latestSchemaVersion(), MIN_APP_VERSION, nowIso);

  return { applied };
}

export function readSchemaVersion(db: DatabaseSync): number | null {
  const row = db
    .prepare("SELECT schema_version FROM schema_meta WHERE id = 1")
    .get() as { schema_version: number } | undefined;
  return row ? Number(row.schema_version) : null;
}
