// server/services/accountExport.ts
// Full authenticated user-data export (INH-476): everything the user produced,
// in a portable JSON bundle. Excludes secrets by construction — provider tokens
// are NEVER read, not even to be redacted. Provider connection metadata is
// limited to non-secret fields (provider, host, username, scopes, status).
//
// Contract notes:
// - Notes (saved_repositories.note, list_items.note) ARE user data and are
//   included, unlike the sanitized PUBLIC snapshot (INH-431).
// - Rebuildable provider metadata (repositories rows) is included inline within
//   each library entry for portability, marked as such.
// - The bundle shape is versioned: format "gitstars-account-export",
//   schemaVersion 1.

import { getDb } from "../db.js";

export const ACCOUNT_EXPORT_FORMAT = "gitstars-account-export";
export const ACCOUNT_EXPORT_SCHEMA_VERSION = 1;

interface SavedRow {
  id: string;
  repository_id: string;
  status: string;
  note: string | null;
  ai_summary: string | null;
  ai_tags: string;
  added_at: string;
  updated_at: string;
  deleted_at: string | null;
  provider_type: string;
  host: string;
  remote_id: string;
  canonical_key: string;
  namespace_path: string | null;
  name: string;
  web_url: string;
  description: string | null;
  visibility: string | null;
  primary_language: string | null;
  stars_count: number;
  forks_count: number;
}

interface ListRow {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface ItemRow {
  id: string;
  list_id: string;
  note: string | null;
  position_key: string;
  canonical_key: string;
  name: string;
  web_url: string;
  provider_type: string;
  host: string;
}

export interface AccountExport {
  format: typeof ACCOUNT_EXPORT_FORMAT;
  schemaVersion: typeof ACCOUNT_EXPORT_SCHEMA_VERSION;
  exportedAt: string;
  profile: {
    username: string;
    email: string | null;
    fullName: string | null;
    githubId: string;
  };
  library: Array<{
    id: string;
    status: string;
    note: string | null;
    aiSummary: string | null;
    aiTags: string[];
    addedAt: string;
    updatedAt: string;
    deletedAt: string | null;
    tags: string[];
    repository: {
      providerType: string;
      host: string;
      remoteId: string;
      canonicalKey: string;
      namespacePath: string | null;
      name: string;
      webUrl: string;
      description: string | null;
      visibility: string | null;
      primaryLanguage: string | null;
      starsCount: number;
      forksCount: number;
    };
  }>;
  lists: Array<{
    id: string;
    name: string;
    description: string;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
    items: Array<{
      note: string | null;
      positionKey: string;
      repository: {
        providerType: string;
        host: string;
        canonicalKey: string;
        name: string;
        webUrl: string;
      };
    }>;
  }>;
  preferences: Record<string, unknown>;
  providers: Array<{
    providerType: string;
    host: string;
    remoteUsername: string | null;
    scopes: string;
    status: string;
  }>;
}

export function buildAccountExport(userId: string): AccountExport {
  const db = getDb();
  const exportedAt = new Date().toISOString();

  const user = db
    .prepare(
      "SELECT github_id, username, email, full_name FROM users WHERE id = ?",
    )
    .get(userId) as unknown as
    | {
        github_id: string;
        username: string;
        email: string | null;
        full_name: string | null;
      }
    | undefined;

  const savedRows = db
    .prepare(
      `SELECT sr.id, sr.repository_id, sr.status, sr.note, sr.ai_summary, sr.ai_tags,
              sr.added_at, sr.updated_at, sr.deleted_at,
              r.provider_type, r.host, r.remote_id, r.canonical_key, r.namespace_path,
              r.name, r.web_url, r.description, r.visibility, r.primary_language,
              r.stars_count, r.forks_count
       FROM saved_repositories sr JOIN repositories r ON r.id = sr.repository_id
       WHERE sr.user_id = ? ORDER BY sr.added_at ASC`,
    )
    .all(userId) as unknown as SavedRow[];

  const tagRows = db
    .prepare(
      `SELECT rt.saved_repository_id AS saved_id, t.name
       FROM repository_tags rt JOIN tags t ON t.id = rt.tag_id
       WHERE t.user_id = ? ORDER BY t.name ASC`,
    )
    .all(userId) as unknown as Array<{ saved_id: string; name: string }>;
  const tagsBySaved = new Map<string, string[]>();
  for (const row of tagRows) {
    const list = tagsBySaved.get(row.saved_id) ?? [];
    list.push(row.name);
    tagsBySaved.set(row.saved_id, list);
  }

  const listRows = db
    .prepare(
      "SELECT id, name, description, created_at, updated_at, deleted_at FROM lists WHERE user_id = ? ORDER BY created_at ASC",
    )
    .all(userId) as unknown as ListRow[];

  const itemRows = db
    .prepare(
      `SELECT li.id, li.list_id, li.note, li.position_key,
              r.canonical_key, r.name, r.web_url, r.provider_type, r.host
       FROM list_items li
       JOIN saved_repositories sr ON sr.id = li.saved_repository_id
       JOIN repositories r ON r.id = sr.repository_id
       WHERE sr.user_id = ?
       ORDER BY li.position_key ASC`,
    )
    .all(userId) as unknown as ItemRow[];
  const itemsByList = new Map<string, ItemRow[]>();
  for (const item of itemRows) {
    const list = itemsByList.get(item.list_id) ?? [];
    list.push(item);
    itemsByList.set(item.list_id, list);
  }

  const prefRow = db
    .prepare("SELECT data FROM preferences WHERE user_id = ?")
    .get(userId) as unknown as { data: string } | undefined;
  let preferences: Record<string, unknown> = {};
  if (prefRow) {
    try {
      preferences = JSON.parse(prefRow.data) as Record<string, unknown>;
    } catch {
      preferences = {};
    }
  }

  const providerRows = db
    .prepare(
      "SELECT provider_type, host, remote_username, scopes, status FROM provider_accounts WHERE user_id = ?",
    )
    .all(userId) as unknown as Array<{
    provider_type: string;
    host: string;
    remote_username: string | null;
    scopes: string;
    status: string;
  }>;

  return {
    format: ACCOUNT_EXPORT_FORMAT,
    schemaVersion: ACCOUNT_EXPORT_SCHEMA_VERSION,
    exportedAt,
    profile: {
      username: user?.username ?? "",
      email: user?.email ?? null,
      fullName: user?.full_name ?? null,
      githubId: user?.github_id ?? "",
    },
    library: savedRows.map((row) => ({
      id: row.id,
      status: row.status,
      note: row.note,
      aiSummary: row.ai_summary,
      aiTags: safeArray(row.ai_tags),
      addedAt: row.added_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
      tags: tagsBySaved.get(row.id) ?? [],
      repository: {
        providerType: row.provider_type,
        host: row.host,
        remoteId: row.remote_id,
        canonicalKey: row.canonical_key,
        namespacePath: row.namespace_path,
        name: row.name,
        webUrl: row.web_url,
        description: row.description,
        visibility: row.visibility,
        primaryLanguage: row.primary_language,
        starsCount: Number(row.stars_count),
        forksCount: Number(row.forks_count),
      },
    })),
    lists: listRows.map((list) => ({
      id: list.id,
      name: list.name,
      description: list.description,
      createdAt: list.created_at,
      updatedAt: list.updated_at,
      deletedAt: list.deleted_at,
      items: (itemsByList.get(list.id) ?? []).map((item) => ({
        note: item.note,
        positionKey: item.position_key,
        repository: {
          providerType: item.provider_type,
          host: item.host,
          canonicalKey: item.canonical_key,
          name: item.name,
          webUrl: item.web_url,
        },
      })),
    })),
    preferences,
    providers: providerRows.map((row) => ({
      providerType: row.provider_type,
      host: row.host,
      remoteUsername: row.remote_username,
      scopes: row.scopes,
      status: row.status,
    })),
  };
}

function safeArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}
