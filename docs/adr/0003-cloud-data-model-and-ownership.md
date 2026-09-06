# ADR-0003: Cloud Data Model and Ownership Boundaries

- Status: Accepted (frozen)
- Date: 2026-09-05
- Linear: [INH-307](https://linear.app/inhandy/issue/INH-307/freeze-cloud-data-model-and-ownership-boundaries)
- Milestone: M0 - Architecture Contracts
- Depends on: ADR-0001, ADR-0002. Blocks: ADR-0004 (sync), ADR-0005 (authz), INH-326 (migrations).

## Context

The authoritative data layer must decouple provider metadata (rebuildable) from user
personal state (non-regenerable knowledge). It must run on SQLite locally and on a
managed DB in cloud with the same schema. Migration from the current legacy schema
(`projects`, `user_projects`, `collections`, `collection_projects`) is **additive**:
new tables are added and backfilled; legacy tables are kept this phase
(ARCHITECTURE.md 33, Roadmap rule 12).

## Decision

### D1. Logical ERD

```
User 1---* ProviderAccount        (a connected forge account; credentials encrypted)
User 1---* SavedRepository *---1 Repository(Ref)   (user knowledge about a repo)
User 1---* RemoteMembership *---1 Repository, *---1 ProviderAccount  (star/fork/... evidence)
SavedRepository 1---* RepositoryTag *---1 Tag      (tags on a saved repo)
User 1---* List 1---* ListItem *---1 SavedRepository (ordered membership)
User 1---1 Preference
User 1---* SyncState *---1 ProviderAccount         (per-resource cursor)
Repository: identity = (provider_type, host, remote_id)  [ADR-0002]
```

Note is a field on SavedRepository in v1 (single note per saved repo). Splitting Note
into its own entity is deferred until multi-note/threading is a real requirement
(ARCHITECTURE.md 7.1). `ponytail:` note-inline; extract Note entity if per-repo
threading/history is ever needed.

### D2. Schema contract / migration baseline (SQLite; additive)

All ids are TEXT (UUID) unless noted. All user-state tables carry `user_id` for
ownership. Timestamps are ISO-8601 TEXT (SQLite) - the cloud profile maps these to
`timestamptz`. `version` is the sync version (ADR-0004).

```sql
-- provider metadata (rebuildable)
CREATE TABLE repositories (
  id TEXT PRIMARY KEY,
  provider_type TEXT NOT NULL, host TEXT NOT NULL, remote_id TEXT NOT NULL,
  canonical_key TEXT NOT NULL,
  namespace_path TEXT, name TEXT NOT NULL, web_url TEXT NOT NULL,
  description TEXT, visibility TEXT, primary_language TEXT,
  stars_count INTEGER NOT NULL DEFAULT 0, forks_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',        -- active | deleted | private-limited
  provider_created_at TEXT, provider_updated_at TEXT, metadata_fetched_at TEXT,
  provider_data TEXT NOT NULL DEFAULT '{}',      -- small escape hatch, not raw payloads
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(provider_type, host, remote_id)
);

-- forge connection (credentials encrypted; see ADR-0005)
CREATE TABLE provider_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_type TEXT NOT NULL, host TEXT NOT NULL,
  remote_user_id TEXT, remote_username TEXT,
  status TEXT NOT NULL DEFAULT 'active',         -- active | revoked | error
  scopes TEXT NOT NULL DEFAULT '',
  encrypted_token TEXT,                           -- AES-256-GCM; NULL for tokenless/dev
  token_updated_at TEXT, last_verified_at TEXT,
  connection_meta TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(user_id, provider_type, host, remote_user_id)
);

-- user knowledge (NON-regenerable)
CREATE TABLE saved_repositories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE RESTRICT,  -- protects user knowledge: a repository cache row cannot be deleted while a SavedRepository references it
  status TEXT NOT NULL DEFAULT 'saved',           -- saved | archived
  note TEXT, ai_summary TEXT, ai_tags TEXT NOT NULL DEFAULT '[]',
  version INTEGER NOT NULL DEFAULT 1,
  added_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  deleted_at TEXT,                                -- soft delete / tombstone (ADR-0004)
  UNIQUE(user_id, repository_id)
);

CREATE TABLE remote_memberships (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  provider_account_id TEXT REFERENCES provider_accounts(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,                             -- star | fork | watch | own (no enum)
  active INTEGER NOT NULL DEFAULT 1,
  remote_created_at TEXT, first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
  source_data TEXT NOT NULL DEFAULT '{}',
  UNIQUE(user_id, repository_id, provider_account_id, kind)
);

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(user_id, name)
);
CREATE TABLE repository_tags (
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  saved_repository_id TEXT NOT NULL REFERENCES saved_repositories(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY(tag_id, saved_repository_id)
);

CREATE TABLE lists (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
  UNIQUE(user_id, name)
);
CREATE TABLE list_items (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  saved_repository_id TEXT NOT NULL REFERENCES saved_repositories(id) ON DELETE CASCADE,
  position REAL NOT NULL DEFAULT 0,               -- fractional index for ordered edits
  note TEXT, version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(list_id, saved_repository_id)
);

CREATE TABLE preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL DEFAULT '{}', version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
);

-- sync / operational
CREATE TABLE sync_states (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_account_id TEXT REFERENCES provider_accounts(id) ON DELETE CASCADE,
  resource_kind TEXT NOT NULL,                    -- starred | forked | ...
  cursor TEXT NOT NULL DEFAULT '{}', cursor_version INTEGER NOT NULL DEFAULT 1,
  last_attempt_at TEXT, last_success_at TEXT, last_full_reconcile_at TEXT,
  last_error_code TEXT, last_error_message TEXT,
  UNIQUE(user_id, provider_account_id, resource_kind)
);

CREATE TABLE change_log (                         -- change feed (ADR-0004)
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  op TEXT NOT NULL,                               -- created | updated | deleted
  version INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE idempotency_keys (
  key TEXT NOT NULL, user_id TEXT NOT NULL,
  response TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY(key, user_id)
);
CREATE TABLE schema_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  schema_version INTEGER NOT NULL, minimum_app_version TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE migrations (
  version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL
);
```

`Share`/`PublicListSnapshot` are contract-only here (Hub = M5); no tables created now.

### D3. Ownership & deletion matrix

| Entity                        | Owner               | Hard delete allowed?                             | Cascade on owner delete                     | Notes                               |
| ----------------------------- | ------------------- | ------------------------------------------------ | ------------------------------------------- | ----------------------------------- |
| repositories                  | none (shared cache) | by GC only when no membership/saved ref          | n/a                                         | rebuildable                         |
| provider_accounts             | user                | yes (revoke)                                     | memberships.provider_account_id -> SET NULL | token wiped on revoke               |
| saved_repositories            | user                | soft (`deleted_at`); hard only on account delete | repository_tags, list_items cascade         | NON-regenerable                     |
| remote_memberships            | user                | yes (reconciliation)                             | none to user state                          | deactivate, don't delete, on unstar |
| tags / repository_tags        | user                | yes                                              | join rows cascade                           |                                     |
| lists / list_items            | user                | soft (`deleted_at`); hard on account delete      | list_items cascade                          | NON-regenerable                     |
| preferences                   | user                | yes                                              | n/a                                         |                                     |
| change_log / idempotency_keys | user                | prunable by retention                            | n/a                                         | operational                         |

Critical invariant (ARCHITECTURE.md 8.1): removing a `remote_membership` (unstar) or a
`repositories` cache row MUST NOT delete `saved_repositories`, `tags`, `lists`, or notes.

### D4. Rebuildable vs non-losable data

- Rebuildable from forge: `repositories`, `remote_memberships`, activity, README/tree.
- NON-regenerable user knowledge (first-class backup, ARCHITECTURE.md 34):
  `saved_repositories.note/status/ai_*`, `tags`, `repository_tags`, `lists`,
  `list_items`, `preferences`.

Export (INH-384/402) and backup derive their field set directly from this classification.

### D5. Deployment profiles (local-first reconciliation)

| Aspect         | Local profile (default)                           | Cloud profile (user-owned)                    |
| -------------- | ------------------------------------------------- | --------------------------------------------- |
| Process        | single Node (Hono)                                | same image, managed runtime                   |
| DB             | SQLite file `data/gitstars.db`                    | managed Postgres (same schema, `timestamptz`) |
| Auth           | `LOCAL_DEV_USER` bypass and/or GitHub OAuth       | OAuth required                                |
| Credential key | `CREDENTIAL_KEY` or derived from `SESSION_SECRET` | `CREDENTIAL_KEY` from secret manager          |
| Clients        | Web SPA served by same process                    | Web SPA + future clients                      |

Same schema and API contract across profiles; only `server/infra/*` config differs.
Cloud DB migration is deferred until a real hosted deployment is required
(`ponytail:` SQLite-only now; swap infra/db adapter when cloud deploy is real).

### D6. Version & timestamp fields

Every user-state entity has `version INTEGER` (bumped per mutation, ADR-0004) and
`updated_at`; soft-deletable entities add `deleted_at` (tombstone). `schema_meta`
tracks `schema_version` + `minimum_app_version` for the compatibility guard
(ARCHITECTURE.md 12/32, Roadmap I1).

## Acceptance (INH-307)

- Deleting provider cache does not delete saved/lists/tags/notes: D3 invariant.
- Fields needed for user-data export are derivable from schema: D2 + D4.
- ListItem can reference a SavedRepository across providers (via RepositoryRef): D1/D2.
- Public share does not expose private tables or implicitly inherit private fields:
  Share is contract-only (D2); sanitization enforced at export (INH-384) + ADR-0005.
- Every entity defines create/update/delete + version semantics: D2/D3/D6.
