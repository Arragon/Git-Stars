// server/services/accountImport.ts
// Portable account restore (M8-09). The export is a user-owned JSON bundle; import is
// dry-run first, then one transaction. Semantics frozen for schemaVersion 1:
//   preserve: notes, aiSummary, aiTags, tags, list names/descriptions, list order, notes
//   map:      provider identity (provider_type+host+remote_id / canonical_key)
//   rebuild:  local UUIDs (saved ids, list ids, item ids, tag ids)
//   drop:     credentials/sessions, publication/share state, private repos the user
//             cannot currently access (reported as unresolved, never imported)
import { randomUUID } from "node:crypto";
import { getDb, inTransaction } from "../db.js";
import { canViewRepository } from "./repository.js";
import { generateBetween } from "../lib/fractionalIndex.js";
import type { AccountExport } from "./accountExport.js";

export const ACCOUNT_IMPORT_FORMAT = "gitstars-account-export";
const SUPPORTED_SCHEMA_VERSIONS = [1];
const MAX_ITEMS = 20000;
const MAX_NOTE = 20000;

export interface AccountImportCounts {
  repositories: number;
  savedCreate: number;
  savedExisting: number;
  unresolved: number;
  tagsCreate: number;
  tagLinks: number;
  listsCreate: number;
  listsExisting: number;
  listItems: number;
  preferences: "apply" | "keep";
}

export interface AccountImportResult {
  ok: boolean;
  dryRun: boolean;
  counts?: AccountImportCounts;
  errors: string[];
}

interface RepoRow {
  id: string;
  visibility: string | null;
  provider_type: string;
  host: string;
}

function emptyCounts(): AccountImportCounts {
  return {
    repositories: 0,
    savedCreate: 0,
    savedExisting: 0,
    unresolved: 0,
    tagsCreate: 0,
    tagLinks: 0,
    listsCreate: 0,
    listsExisting: 0,
    listItems: 0,
    preferences: "keep",
  };
}

function validate(bundle: unknown): {
  errors: string[];
  doc?: AccountExport;
} {
  const errors: string[] = [];
  if (!bundle || typeof bundle !== "object") {
    return { errors: ["bundle must be a JSON object"] };
  }
  const doc = bundle as Partial<AccountExport>;
  if (doc.format !== ACCOUNT_IMPORT_FORMAT) {
    errors.push(`unsupported format (expected ${ACCOUNT_IMPORT_FORMAT})`);
  }
  if (
    typeof doc.schemaVersion !== "number" ||
    !SUPPORTED_SCHEMA_VERSIONS.includes(doc.schemaVersion)
  ) {
    errors.push(
      `unsupported schemaVersion (expected one of ${SUPPORTED_SCHEMA_VERSIONS.join(", ")})`,
    );
  }
  if (!Array.isArray(doc.library)) errors.push("library must be an array");
  else if (doc.library.length > MAX_ITEMS)
    errors.push(`library exceeds ${MAX_ITEMS} items`);
  if (!Array.isArray(doc.lists)) errors.push("lists must be an array");
  else if (doc.lists.length > MAX_ITEMS)
    errors.push(`lists exceeds ${MAX_ITEMS} items`);
  if (!Array.isArray(doc.providers)) errors.push("providers must be an array");
  return {
    errors,
    doc: errors.length === 0 ? (doc as AccountExport) : undefined,
  };
}

export function planAccountImport(
  userId: string,
  bundle: unknown,
): AccountImportResult {
  return runImport(userId, bundle, true);
}

export function applyAccountImport(
  userId: string,
  bundle: unknown,
): AccountImportResult {
  return runImport(userId, bundle, false);
}

function runImport(
  userId: string,
  bundle: unknown,
  dryRun: boolean,
): AccountImportResult {
  const { errors, doc } = validate(bundle);
  if (!doc) return { ok: false, dryRun, errors };

  const db = getDb();
  const counts = emptyCounts();
  // Canonical key -> saved id (real or planned in dry-run).
  const savedByCanonical = new Map<string, string>();
  const plannedRepos = new Map<string, RepoRow>();
  const plannedTags = new Map<string, string>();
  const plannedLists = new Map<string, string>();

  const findRepoByIdentity = (
    providerType: string,
    host: string,
    remoteId: string,
  ): RepoRow | undefined => {
    const row = db
      .prepare(
        "SELECT id, visibility, provider_type, host FROM repositories WHERE provider_type = ? AND host = ? AND remote_id = ?",
      )
      .get(providerType, host, remoteId) as unknown as RepoRow | undefined;
    return row;
  };

  const work = () => {
    for (const entry of doc.library) {
      const repo = entry.repository;
      if (!repo?.providerType || !repo?.host || !repo?.remoteId) {
        counts.unresolved += 1;
        continue;
      }
      let row = findRepoByIdentity(repo.providerType, repo.host, repo.remoteId);
      const visibility = repo.visibility ?? "public";
      if (!row) {
        if (visibility === "private") {
          // No local row and no proof of access: never import private metadata.
          counts.unresolved += 1;
          continue;
        }
        const id = randomUUID();
        row = {
          id,
          visibility,
          provider_type: repo.providerType,
          host: repo.host,
        };
        plannedRepos.set(repo.canonicalKey, row);
        counts.repositories += 1;
        if (!dryRun) {
          db.prepare(
            `INSERT INTO repositories
               (id, provider_type, host, remote_id, canonical_key, namespace_path, name,
                web_url, description, visibility, primary_language, stars_count, forks_count,
                status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
          ).run(
            id,
            repo.providerType,
            repo.host,
            repo.remoteId,
            repo.canonicalKey,
            repo.namespacePath ?? null,
            repo.name,
            repo.webUrl,
            repo.description ?? null,
            visibility,
            repo.primaryLanguage ?? null,
            Number(repo.starsCount ?? 0),
            Number(repo.forksCount ?? 0),
            entry.addedAt ?? new Date().toISOString(),
            entry.updatedAt ?? new Date().toISOString(),
          );
        }
      } else if (!canViewRepository(userId, row)) {
        counts.unresolved += 1;
        continue;
      }

      const existing = db
        .prepare(
          "SELECT id FROM saved_repositories WHERE user_id = ? AND repository_id = ? AND deleted_at IS NULL",
        )
        .get(userId, row.id) as unknown as { id: string } | undefined;

      let savedId: string;
      if (existing) {
        savedId = existing.id;
        counts.savedExisting += 1;
      } else {
        savedId = dryRun ? `dry:saved:${savedByCanonical.size}` : randomUUID();
        counts.savedCreate += 1;
        if (!dryRun) {
          const now = new Date().toISOString();
          db.prepare(
            `INSERT INTO saved_repositories
               (id, user_id, repository_id, status, note, ai_summary, ai_summary_sources, ai_tags, version, added_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          ).run(
            savedId,
            userId,
            row.id,
            typeof entry.status === "string" ? entry.status : "saved",
            (entry.note ?? "").slice(0, MAX_NOTE) || null,
            entry.aiSummary ?? null,
            Array.isArray(entry.aiSummarySources)
              ? JSON.stringify(entry.aiSummarySources.slice(0, 32))
              : null,
            JSON.stringify(Array.isArray(entry.aiTags) ? entry.aiTags : []),
            entry.addedAt ?? new Date().toISOString(),
            now,
          );
          db.prepare(
            `INSERT INTO change_log (user_id, entity_type, entity_id, op, version, created_at)
             VALUES (?, 'saved_repository', ?, 'created', 1, ?)`,
          ).run(userId, savedId, now);
        }
      }
      savedByCanonical.set(repo.canonicalKey, savedId);

      for (const name of entry.tags ?? []) {
        if (typeof name !== "string" || !name.trim()) continue;
        let tagId = plannedTags.get(name);
        if (!tagId) {
          const existingTag = db
            .prepare("SELECT id FROM tags WHERE user_id = ? AND name = ?")
            .get(userId, name) as unknown as { id: string } | undefined;
          if (existingTag) {
            tagId = existingTag.id;
          } else {
            tagId = dryRun ? `dry:tag:${plannedTags.size}` : randomUUID();
            counts.tagsCreate += 1;
            if (!dryRun) {
              db.prepare(
                "INSERT INTO tags (id, user_id, name, created_at) VALUES (?, ?, ?, ?)",
              ).run(tagId, userId, name, new Date().toISOString());
            }
          }
          plannedTags.set(name, tagId);
        }
        counts.tagLinks += 1;
        if (!dryRun) {
          db.prepare(
            `INSERT INTO repository_tags (tag_id, saved_repository_id, created_at)
             VALUES (?, ?, ?) ON CONFLICT(tag_id, saved_repository_id) DO NOTHING`,
          ).run(tagId, savedId, new Date().toISOString());
        }
      }
    }

    for (const list of doc.lists) {
      const name = (list.name || "Imported list").slice(0, 200);
      const now = new Date().toISOString();
      // Repeated import reuses the list with the same name instead of duplicating it.
      const existingList = db
        .prepare(
          "SELECT id FROM lists WHERE user_id = ? AND name = ? AND deleted_at IS NULL",
        )
        .get(userId, name) as unknown as { id: string } | undefined;
      let listId = existingList?.id ?? plannedLists.get(name);
      if (listId) {
        counts.listsExisting += 1;
      } else {
        listId = dryRun ? `dry:list:${counts.listsCreate}` : randomUUID();
        plannedLists.set(name, listId);
        counts.listsCreate += 1;
        if (!dryRun) {
          db.prepare(
            `INSERT INTO lists (id, user_id, name, description, version, created_at, updated_at)
             VALUES (?, ?, ?, ?, 1, ?, ?)`,
          ).run(
            listId,
            userId,
            name,
            (list.description ?? "").slice(0, 2000),
            list.createdAt ?? now,
            now,
          );
          db.prepare(
            `INSERT INTO change_log (user_id, entity_type, entity_id, op, version, created_at)
             VALUES (?, 'list', ?, 'created', 1, ?)`,
          ).run(userId, listId, now);
        }
      }
      let lastKey: string | null = null;
      for (const item of list.items ?? []) {
        const canonical = item.repository?.canonicalKey;
        const savedId = canonical ? savedByCanonical.get(canonical) : undefined;
        if (!savedId) {
          counts.unresolved += 1;
          continue;
        }
        const alreadyThere = dryRun
          ? false
          : Boolean(
              db
                .prepare(
                  "SELECT 1 AS one FROM list_items WHERE list_id = ? AND saved_repository_id = ?",
                )
                .get(listId, savedId),
            );
        if (alreadyThere) continue;
        counts.listItems += 1;
        if (dryRun) continue;
        const positionKey = generateBetween(lastKey, null);
        lastKey = positionKey;
        const itemId = randomUUID();
        db.prepare(
          `INSERT INTO list_items
             (id, list_id, saved_repository_id, position, position_key, note, version, created_at, updated_at)
           VALUES (?, ?, ?, 0, ?, ?, 1, ?, ?)`,
        ).run(
          itemId,
          listId,
          savedId,
          positionKey,
          item.note ?? null,
          now,
          now,
        );
        db.prepare(
          `INSERT INTO change_log (user_id, entity_type, entity_id, op, version, created_at)
           VALUES (?, 'list_item', ?, 'created', 1, ?)`,
        ).run(userId, itemId, now);
      }
    }

    const prefs = db
      .prepare("SELECT data FROM preferences WHERE user_id = ?")
      .get(userId) as unknown as { data: string } | undefined;
    const hasPreferences = prefs
      ? Object.keys(JSON.parse(prefs.data)).length > 0
      : false;
    if (doc.preferences && Object.keys(doc.preferences).length > 0) {
      counts.preferences = hasPreferences ? "keep" : "apply";
      if (!dryRun && !hasPreferences) {
        db.prepare(
          `INSERT INTO preferences (user_id, data, version, updated_at)
           VALUES (?, ?, 1, ?)
           ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, version = version + 1, updated_at = excluded.updated_at`,
        ).run(
          userId,
          JSON.stringify(doc.preferences),
          new Date().toISOString(),
        );
      }
    }
  };

  try {
    if (dryRun) work();
    else inTransaction(work);
  } catch (error) {
    return {
      ok: false,
      dryRun,
      errors: [error instanceof Error ? error.message : "import failed"],
    };
  }
  return { ok: true, dryRun, counts, errors: [] };
}
