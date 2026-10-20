import { randomUUID } from "node:crypto";
import { getDb, inTransaction } from "../db.js";
import { getProvider } from "../providers/registry.js";
import {
  ProviderError,
  type MembershipKind,
  type RepositorySnapshot,
} from "../providers/types.js";
import { loadContext, upsertRepositoryFromSnapshot } from "./repository.js";

// Provider-neutral sync engine (ADR-0001 Sync domain, ARCHITECTURE.md 15-17). Knows the
// RepositoryProvider contract and the domain tables; knows NO provider endpoints.
//
// Invariants enforced here:
//  - idempotent: repeated runs converge, no duplicate rows;
//  - a run that fetched nothing before failing writes nothing and keeps the cursor;
//  - a run that stopped early (page cap / rate limit / network) commits the pages it
//    fetched, reports `completion: "partial"` and stores a resumable page cursor;
//  - remote removal is reconciled only after a sweep that covered the whole source;
//  - remote removal deactivates the membership but NEVER deletes the SavedRepository.

const MAX_PAGES_PER_RUN = 20;

export type SyncCompletion = "complete" | "partial" | "failed" | "paused";

export interface SyncCounts {
  repositories: number;
  membershipsActive: number;
  savedCreated: number;
  deactivated: number;
}

export interface SyncResumePoint {
  kind: MembershipKind;
  page: number;
}

export interface SyncOutcome {
  ok: boolean;
  provider: string;
  startedAt: string;
  completedAt?: string;
  counts?: SyncCounts;
  code?: string;
  message?: string;
  resetAt?: number;
  /** "complete" only when the source was exhausted; "partial" carries resume points. */
  completion: SyncCompletion;
  pagesFetched: number;
  resume: SyncResumePoint[];
  // Normalized data, returned so callers can mirror to the legacy schema during migration.
  repos: RepositorySnapshot[];
  memberships: Array<{
    repositoryId: string;
    remoteId: string;
    kind: MembershipKind;
    remoteCreatedAt: string | null;
  }>;
}

interface SyncCursor {
  /** Next page to fetch (2-based); null means "start a fresh sweep at page 1". */
  nextPage: number | null;
  /** Remote ids already observed in the in-progress sweep (survives across runs). */
  sweepSeen: string[];
}

function readCursor(
  userId: string,
  accountId: string | null,
  kind: MembershipKind,
): SyncCursor {
  const row = getDb()
    .prepare(
      `SELECT cursor FROM sync_states
       WHERE user_id = ? AND COALESCE(provider_account_id,'') = COALESCE(?,'') AND resource_kind = ?`,
    )
    .get(userId, accountId, kind) as unknown as { cursor: string } | undefined;
  if (!row?.cursor) return { nextPage: null, sweepSeen: [] };
  try {
    const parsed = JSON.parse(row.cursor) as {
      v?: number;
      kind?: string;
      nextPage?: unknown;
      sweepSeen?: unknown;
    };
    // Legacy v1 cursors (`{kind, syncedAt}`) cannot be resumed — start a fresh sweep.
    if (parsed?.v !== 2 || parsed.kind !== kind)
      return { nextPage: null, sweepSeen: [] };
    const nextPage =
      typeof parsed.nextPage === "number" && parsed.nextPage >= 2
        ? Math.floor(parsed.nextPage)
        : null;
    const sweepSeen = Array.isArray(parsed.sweepSeen)
      ? parsed.sweepSeen.filter((id): id is string => typeof id === "string")
      : [];
    return { nextPage, sweepSeen };
  } catch {
    return { nextPage: null, sweepSeen: [] };
  }
}

function classifyFailure(error: unknown): {
  code: string;
  message: string;
  resetAt?: number;
} {
  if (error instanceof ProviderError) {
    return { code: error.code, message: error.message, resetAt: error.resetAt };
  }
  return { code: "SYNC_FAILED", message: "Unexpected sync error" };
}

export async function syncProvider(
  userId: string,
  providerType: string,
): Promise<SyncOutcome> {
  const startedAt = new Date().toISOString();
  const empty: SyncOutcome = {
    ok: false,
    provider: providerType,
    startedAt,
    completion: "failed",
    pagesFetched: 0,
    resume: [],
    repos: [],
    memberships: [],
  };

  const provider = getProvider(providerType);
  if (!provider) {
    return {
      ...empty,
      code: "PROVIDER_NOT_IMPLEMENTED",
      message: `No provider registered for ${providerType}`,
    };
  }

  const db = getDb();
  const ctx = loadContext(userId, providerType);
  const account = db
    .prepare(
      `SELECT id FROM provider_accounts WHERE user_id = ? AND provider_type = ? AND status = 'active'
       ORDER BY last_verified_at DESC LIMIT 1`,
    )
    .get(userId, providerType) as unknown as { id: string } | undefined;
  const accountId = account?.id ?? null;

  const counts: SyncCounts = {
    repositories: 0,
    membershipsActive: 0,
    savedCreated: 0,
    deactivated: 0,
  };
  const outRepos: RepositorySnapshot[] = [];
  const outMemberships: SyncOutcome["memberships"] = [];
  const resume: SyncResumePoint[] = [];
  let pagesFetched = 0;
  let completion: SyncCompletion = "complete";
  let failure: { code: string; message: string; resetAt?: number } | null =
    null;

  try {
    for (const kind of provider.capabilities.memberships) {
      const cursor = readCursor(userId, accountId, kind);
      const startPage = cursor.nextPage ?? 1;
      const sweepSeen = new Set<string>(cursor.sweepSeen);

      // 1. Fetch pages OUTSIDE the transaction (network is not transactional).
      const fetched: Array<{
        snapshot: RepositorySnapshot;
        kind: MembershipKind;
        remoteCreatedAt: string | null;
      }> = [];
      let page = startPage;
      let pagesThisKind = 0;
      let exhausted = false;

      while (pagesThisKind < MAX_PAGES_PER_RUN) {
        let result;
        try {
          result = await provider.listMemberships(
            ctx,
            kind,
            page === 1 ? null : String(page),
          );
        } catch (error) {
          // Nothing fetched at all in this run -> hard failure (no write, no cursor move).
          if (pagesFetched === 0 && fetched.length === 0) throw error;
          // Partial progress: keep what we have and remember where to resume.
          failure = classifyFailure(error);
          completion = "partial";
          break;
        }
        pagesThisKind += 1;
        pagesFetched += 1;
        for (const item of result.items) {
          if (!item.snapshot) continue;
          fetched.push({
            snapshot: item.snapshot as RepositorySnapshot,
            kind,
            remoteCreatedAt: item.remoteCreatedAt,
          });
          sweepSeen.add(item.snapshot.identity.remoteId);
        }
        if (!result.nextCursor) {
          exhausted = true;
          break;
        }
        page += 1;
      }

      const sweptSource = exhausted;
      const nextPage = sweptSource ? null : page;
      if (!sweptSource) completion = "partial";
      if (nextPage !== null) resume.push({ kind, page: nextPage });

      // 2. Write inside one transaction; the cursor advances only if this commits.
      inTransaction(() => {
        const seenRemoteIds = new Set<string>();
        for (const item of fetched) {
          const repositoryId = upsertRepositoryFromSnapshot(item.snapshot);
          seenRemoteIds.add(item.snapshot.identity.remoteId);
          counts.repositories += 1;
          outRepos.push(item.snapshot);
          outMemberships.push({
            repositoryId,
            remoteId: item.snapshot.identity.remoteId,
            kind,
            remoteCreatedAt: item.remoteCreatedAt,
          });

          const nowIso = new Date().toISOString();
          const existingMembership = db
            .prepare(
              `SELECT id FROM remote_memberships
               WHERE user_id = ? AND repository_id = ? AND COALESCE(provider_account_id,'') = COALESCE(?,'') AND kind = ?`,
            )
            .get(userId, repositoryId, accountId, kind) as unknown as
            { id: string } | undefined;
          if (existingMembership) {
            db.prepare(
              `UPDATE remote_memberships SET active = 1, last_seen_at = ?, remote_created_at = COALESCE(?, remote_created_at) WHERE id = ?`,
            ).run(nowIso, item.remoteCreatedAt, existingMembership.id);
          } else {
            db.prepare(
              `INSERT INTO remote_memberships
                 (id, user_id, repository_id, provider_account_id, kind, active, remote_created_at, first_seen_at, last_seen_at)
               VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
            ).run(
              randomUUID(),
              userId,
              repositoryId,
              accountId,
              kind,
              item.remoteCreatedAt,
              nowIso,
              nowIso,
            );
          }
          counts.membershipsActive += 1;

          // Library-first: ensure one SavedRepository per user/repository (never removed by unstar).
          const saved = db
            .prepare(
              "SELECT id FROM saved_repositories WHERE user_id = ? AND repository_id = ?",
            )
            .get(userId, repositoryId) as unknown as { id: string } | undefined;
          if (!saved) {
            const savedId = randomUUID();
            db.prepare(
              `INSERT INTO saved_repositories (id, user_id, repository_id, status, version, added_at, updated_at)
               VALUES (?, ?, ?, 'saved', 1, ?, ?)`,
            ).run(savedId, userId, repositoryId, nowIso, nowIso);
            db.prepare(
              `INSERT INTO change_log (user_id, entity_type, entity_id, op, version, created_at)
               VALUES (?, 'saved_repository', ?, 'created', 1, ?)`,
            ).run(userId, savedId, nowIso);
            counts.savedCreated += 1;
          }
        }

        // 3. Reconcile only after a sweep that started at page 1 and exhausted the source.
        // A resumed run that only fetched the tail marks `complete` but leaves the
        // deactivation pass to the next full sweep: absence is only evidence of removal
        // when the whole remote set was observed by this sweep.
        if (sweptSource && startPage === 1) {
          const active = db
            .prepare(
              `SELECT rm.id AS id, r.remote_id AS remote_id
               FROM remote_memberships rm
               JOIN repositories r ON r.id = rm.repository_id
               WHERE rm.user_id = ? AND rm.kind = ? AND rm.active = 1
                 AND COALESCE(rm.provider_account_id,'') = COALESCE(?,'')`,
            )
            .all(userId, kind, accountId) as unknown as Array<{
            id: string;
            remote_id: string;
          }>;
          for (const membership of active) {
            if (!seenRemoteIds.has(membership.remote_id)) {
              db.prepare(
                "UPDATE remote_memberships SET active = 0 WHERE id = ?",
              ).run(membership.id);
              counts.deactivated += 1;
            }
          }
        }

        // 4. Persist a versioned, resumable cursor after a successful write.
        const nowIso = new Date().toISOString();
        const stateRow = db
          .prepare(
            `SELECT id FROM sync_states
             WHERE user_id = ? AND COALESCE(provider_account_id,'') = COALESCE(?,'') AND resource_kind = ?`,
          )
          .get(userId, accountId, kind) as unknown as
          { id: string } | undefined;
        const cursorJson = JSON.stringify({
          v: 2,
          kind,
          nextPage,
          // Keep the sweep accumulator only while a sweep is still in progress.
          sweepSeen: nextPage === null ? [] : [...sweepSeen],
          completion: sweptSource ? "complete" : "partial",
          pagesFetched: pagesThisKind,
          syncedAt: nowIso,
        });
        const reconciled = sweptSource && startPage === 1;
        if (stateRow) {
          if (sweptSource) {
            db.prepare(
              `UPDATE sync_states SET cursor = ?, cursor_version = cursor_version + 1, last_attempt_at = ?,
                 last_success_at = ?,
                 last_full_reconcile_at = CASE WHEN ? = 1 THEN ? ELSE last_full_reconcile_at END,
                 last_error_code = NULL, last_error_message = NULL
               WHERE id = ?`,
            ).run(
              cursorJson,
              nowIso,
              nowIso,
              reconciled ? 1 : 0,
              nowIso,
              stateRow.id,
            );
          } else {
            db.prepare(
              `UPDATE sync_states SET cursor = ?, cursor_version = cursor_version + 1,
                 last_attempt_at = ?, last_error_code = ?, last_error_message = ?
               WHERE id = ?`,
            ).run(
              cursorJson,
              nowIso,
              failure?.code ?? "SYNC_PARTIAL",
              failure?.message ?? "Sync stopped before exhausting the source",
              stateRow.id,
            );
          }
        } else {
          db.prepare(
            `INSERT INTO sync_states
               (id, user_id, provider_account_id, resource_kind, cursor, cursor_version,
                last_attempt_at, last_success_at, last_full_reconcile_at, last_error_code, last_error_message)
             VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
          ).run(
            randomUUID(),
            userId,
            accountId,
            kind,
            cursorJson,
            nowIso,
            sweptSource ? nowIso : null,
            reconciled ? nowIso : null,
            sweptSource ? null : (failure?.code ?? "SYNC_PARTIAL"),
            sweptSource
              ? null
              : (failure?.message ??
                  "Sync stopped before exhausting the source"),
          );
        }
      });
    }

    return {
      ok: true,
      provider: providerType,
      startedAt,
      completedAt: new Date().toISOString(),
      counts,
      code: failure?.code,
      message: failure?.message,
      resetAt: failure?.resetAt,
      completion,
      pagesFetched,
      resume,
      repos: outRepos,
      memberships: outMemberships,
    };
  } catch (error) {
    // Nothing was committed (see the guard above) -> report a structured failure.
    const classified = classifyFailure(error);
    return {
      ...empty,
      code: classified.code,
      message: classified.message,
      resetAt: classified.resetAt,
    };
  }
}
