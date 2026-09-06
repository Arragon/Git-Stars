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
//  - partial failure never advances the cursor (writes are transactional; fetch is not);
//  - remote removal deactivates the membership but NEVER deletes the SavedRepository.
//
// ponytail: bounded full reconcile (MAX_PAGES per kind). Add true incremental cursors per
// provider when libraries outgrow the cap.

const MAX_PAGES = 20;

export interface SyncCounts {
  repositories: number;
  membershipsActive: number;
  savedCreated: number;
  deactivated: number;
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
  // Normalized data, returned so callers can mirror to the legacy schema during migration.
  repos: RepositorySnapshot[];
  memberships: Array<{
    repositoryId: string;
    remoteId: string;
    kind: MembershipKind;
    remoteCreatedAt: string | null;
  }>;
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

  try {
    for (const kind of provider.capabilities.memberships) {
      // 1. Fetch all pages OUTSIDE the transaction (network is not transactional).
      const fetched: Array<{
        snapshot: RepositorySnapshot;
        kind: MembershipKind;
        remoteCreatedAt: string | null;
      }> = [];
      let cursor: string | null = null;
      let truncated = false;
      for (let page = 0; page < MAX_PAGES; page++) {
        const result = await provider.listMemberships(ctx, kind, cursor);
        for (const item of result.items) {
          if (item.snapshot)
            fetched.push({
              snapshot: item.snapshot as RepositorySnapshot,
              kind,
              remoteCreatedAt: item.remoteCreatedAt,
            });
        }
        cursor = result.nextCursor ?? null;
        if (!cursor) break;
        if (page === MAX_PAGES - 1) truncated = true; // stopped at the cap with more pages remaining
      }

      // 2. Write inside one transaction; the cursor/state advances only if this commits.
      inTransaction(() => {
        const seenRepoIds = new Set<string>();
        for (const item of fetched) {
          const repositoryId = upsertRepositoryFromSnapshot(item.snapshot);
          seenRepoIds.add(repositoryId);
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

        // 3. Full reconcile: deactivate active memberships of this kind not seen this run.
        // Skip when the fetch was truncated at MAX_PAGES: we did not observe the complete remote
        // set, so absence is NOT evidence of removal (prevents mass false-deactivation of large libraries).
        if (!truncated) {
          const active = db
            .prepare(
              `SELECT id, repository_id FROM remote_memberships
               WHERE user_id = ? AND kind = ? AND active = 1 AND COALESCE(provider_account_id,'') = COALESCE(?,'')`,
            )
            .all(userId, kind, accountId) as unknown as Array<{
            id: string;
            repository_id: string;
          }>;
          for (const membership of active) {
            if (!seenRepoIds.has(membership.repository_id)) {
              db.prepare(
                "UPDATE remote_memberships SET active = 0 WHERE id = ?",
              ).run(membership.id);
              counts.deactivated += 1;
            }
          }
        }

        // 4. Advance the per-resource cursor only after a successful write.
        const nowIso = new Date().toISOString();
        const stateRow = db
          .prepare(
            `SELECT id FROM sync_states
             WHERE user_id = ? AND COALESCE(provider_account_id,'') = COALESCE(?,'') AND resource_kind = ?`,
          )
          .get(userId, accountId, kind) as unknown as
          { id: string } | undefined;
        const cursorJson = JSON.stringify({ kind, syncedAt: nowIso });
        if (stateRow) {
          db.prepare(
            `UPDATE sync_states SET cursor = ?, cursor_version = cursor_version + 1, last_attempt_at = ?,
               last_success_at = ?, last_full_reconcile_at = ?, last_error_code = NULL, last_error_message = NULL
             WHERE id = ?`,
          ).run(cursorJson, nowIso, nowIso, nowIso, stateRow.id);
        } else {
          db.prepare(
            `INSERT INTO sync_states
               (id, user_id, provider_account_id, resource_kind, cursor, cursor_version, last_attempt_at, last_success_at, last_full_reconcile_at)
             VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
          ).run(
            randomUUID(),
            userId,
            accountId,
            kind,
            cursorJson,
            nowIso,
            nowIso,
            nowIso,
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
      repos: outRepos,
      memberships: outMemberships,
    };
  } catch (error) {
    // Transaction rolled back -> cursor not advanced (invariant). Report a structured failure.
    if (error instanceof ProviderError) {
      return {
        ...empty,
        code: error.code,
        message: error.message,
        resetAt: error.resetAt,
      };
    }
    return { ...empty, code: "SYNC_FAILED", message: "Unexpected sync error" };
  }
}
