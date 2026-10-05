// src/sync/pullSync.ts
// Incremental pull sync: pulls changes from server change feed and applies
// them atomically to the local replica (ADR-0004 D2, D5, D7).

import type { LocalStore } from "../data/LocalStore";
import type {
  StoreName,
  TransactionContext,
  SyncCursor,
  CachedRepository,
  CachedSavedRepository,
  CachedTag,
  CachedRepositoryTag,
  CachedList,
  CachedListItem,
  CachedPreferences,
} from "../data/types";
import type { ChangeFeedResponse, ChangeEntry } from "../utils/gitstarsApi";

// --- Public types ---

export type PullStatus = "idle" | "pulling" | "reconciling" | "error";

export interface PullResult {
  applied: number;
  hasMore: boolean;
  cursor: number;
}

export interface PullSyncConfig {
  localStore: LocalStore;
  apiClient: {
    getChanges(since: number, limit?: number): Promise<ChangeFeedResponse>;
  };
  onStatusChange?: (status: PullStatus) => void;
}

export interface PullSync {
  bootstrap(): Promise<PullResult>;
  pullIncremental(): Promise<PullResult>;
  sync(): Promise<PullResult>;
}

// --- Error for 426 STALE_CLIENT ---

export class StaleClientError extends Error {
  constructor() {
    super("Server protocol version changed. Client upgrade required.");
    this.name = "StaleClientError";
  }
}

// --- Constants ---

const PROTOCOL_VERSION = 1;
const BATCH_SIZE = 200;

// All stores touched by change application (for transaction scope).
const TX_STORES: StoreName[] = [
  "repositories",
  "savedRepositories",
  "tags",
  "repositoryTags",
  "lists",
  "listItems",
  "preferences",
  "syncCursor",
];

// --- Factory ---

export function createPullSync(config: PullSyncConfig): PullSync {
  const { localStore, apiClient, onStatusChange } = config;

  const setStatus = (s: PullStatus) => onStatusChange?.(s);

  async function fetchAndApply(since: number): Promise<PullResult> {
    let cursor = since;
    let totalApplied = 0;
    let hasMore = true;
    // A 410 CURSOR_INVALID means our cursor points past the server feed tail (e.g.
    // server-side DB reset). Recovery is a full re-pull from 0; queued local mutations
    // are never touched. Guard flag prevents an endless reset loop.
    let didCursorReset = false;

    while (hasMore) {
      setStatus("pulling");

      let feed: ChangeFeedResponse;
      try {
        feed = await apiClient.getChanges(cursor, BATCH_SIZE);
      } catch (err) {
        setStatus("error");
        // 426 STALE_CLIENT — surface, do not retry.
        if (
          err instanceof StaleClientError ||
          (err as { status?: number })?.status === 426
        ) {
          throw new StaleClientError();
        }
        // 410 CURSOR_INVALID — restart the pull from an empty cursor once.
        if (
          !didCursorReset &&
          (err as { status?: number; code?: string })?.status === 410
        ) {
          didCursorReset = true;
          cursor = 0;
          continue;
        }
        // Network / other error — preserve cursor, stop.
        throw err;
      }

      if (feed.changes.length === 0) {
        hasMore = false;
        break;
      }

      setStatus("reconciling");

      // Apply batch + advance cursor in a single atomic transaction.
      await localStore.transaction(TX_STORES, "readwrite", async (tx) => {
        for (const change of feed.changes) {
          applyChange(tx, change);
        }
        const lastSeq = feed.changes[feed.changes.length - 1].seq;
        tx.put<SyncCursor>("syncCursor", {
          id: "default",
          lastSeq,
          protocolVersion: feed.protocolVersion ?? PROTOCOL_VERSION,
          lastSyncedAt: new Date().toISOString(),
        });
      });

      totalApplied += feed.changes.length;
      cursor = feed.nextCursor;
      hasMore = feed.hasMore;
    }

    return { applied: totalApplied, hasMore, cursor };
  }

  async function bootstrap(): Promise<PullResult> {
    setStatus("pulling");
    return fetchAndApply(0);
  }

  async function pullIncremental(): Promise<PullResult> {
    const cursor = await localStore.getSyncCursor();
    const since = cursor?.lastSeq ?? 0;
    return fetchAndApply(since);
  }

  async function sync(): Promise<PullResult> {
    const cursor = await localStore.getSyncCursor();
    return fetchAndApply(cursor?.lastSeq ?? 0);
  }

  return { bootstrap, pullIncremental, sync };
}

// --- Change application ---

function applyChange(tx: TransactionContext, change: ChangeEntry): void {
  const d = change.data ?? {};

  // Non-delete changes without a payload cannot be materialized safely (the row was
  // already hard-purged server-side, or the server predates payloads). Skip rather
  // than write a half-empty replica row; a later full refresh repairs the gap.
  if (!change.data && change.op !== "deleted") return;

  switch (change.entityType) {
    case "repository":
      if (!change.data) return;
      tx.put<CachedRepository>("repositories", {
        id: change.entityId,
        providerType: str(d.providerType) ?? "",
        host: str(d.host) ?? "",
        remoteId: str(d.remoteId) ?? "",
        canonicalKey: str(d.canonicalKey) ?? "",
        namespacePath: str(d.namespacePath),
        name: str(d.name) ?? "",
        webUrl: str(d.webUrl) ?? "",
        description: str(d.description),
        visibility: str(d.visibility),
        primaryLanguage: str(d.primaryLanguage),
        starsCount: num(d.starsCount) ?? 0,
        forksCount: num(d.forksCount) ?? 0,
        status: str(d.status) ?? "active",
        providerCreatedAt: str(d.providerCreatedAt),
        providerUpdatedAt: str(d.providerUpdatedAt),
        metadataFetchedAt: str(d.metadataFetchedAt),
        cachedAt: str(d.cachedAt) ?? new Date().toISOString(),
      });
      break;

    case "saved_repository": {
      if (change.op === "deleted" && !change.data) {
        // No tombstone payload available (row purged server-side): drop the local row.
        tx.delete("savedRepositories", change.entityId);
        break;
      }
      if (change.op === "deleted" || d.deletedAt) {
        // Tombstone: upsert with deletedAt marker.
        tx.put<CachedSavedRepository>("savedRepositories", {
          id: change.entityId,
          repositoryId: str(d.repositoryId) ?? "",
          status: str(d.status) ?? "deleted",
          aiTags: [],
          version: num(d.version) ?? change.version,
          etag: str(d.etag) ?? "",
          addedAt: str(d.addedAt) ?? "",
          updatedAt: str(d.updatedAt) ?? change.createdAt,
          deletedAt: str(d.deletedAt) ?? change.createdAt,
        });
      } else {
        tx.put<CachedSavedRepository>("savedRepositories", {
          id: change.entityId,
          repositoryId: str(d.repositoryId) ?? "",
          status: str(d.status) ?? "saved",
          note: str(d.note),
          aiTags: arr(d.aiTags),
          version: num(d.version) ?? change.version,
          etag: str(d.etag) ?? "",
          addedAt: str(d.addedAt) ?? "",
          updatedAt: str(d.updatedAt) ?? change.createdAt,
        });
      }
      break;
    }

    case "tag":
      if (change.op === "deleted") {
        tx.delete("tags", change.entityId);
      } else {
        tx.put<CachedTag>("tags", {
          id: change.entityId,
          name: str(d.name) ?? "",
          createdAt: str(d.createdAt) ?? change.createdAt,
        });
      }
      break;

    case "repository_tag":
      if (change.op === "deleted") {
        // Client keyPath is the composite [savedRepositoryId, tagId]; fall back to
        // parsing the server entityId `${savedRepositoryId}:${tagId}` when the row is
        // already gone and no payload was attached.
        const savedId =
          str(d.savedRepositoryId) ?? change.entityId.split(":")[0];
        const tagId = str(d.tagId) ?? change.entityId.split(":")[1];
        if (savedId && tagId) {
          tx.delete("repositoryTags", [savedId, tagId]);
        }
      } else {
        tx.put<CachedRepositoryTag>("repositoryTags", {
          tagId: str(d.tagId) ?? change.entityId,
          savedRepositoryId: str(d.savedRepositoryId) ?? "",
          createdAt: str(d.createdAt) ?? change.createdAt,
        });
      }
      break;

    case "list":
      if (change.op === "deleted" && !change.data) {
        tx.delete("lists", change.entityId);
        break;
      }
      if (change.op === "deleted" || d.deletedAt) {
        tx.put<CachedList>("lists", {
          id: change.entityId,
          name: str(d.name) ?? "",
          description: str(d.description) ?? "",
          version: num(d.version) ?? change.version,
          etag: str(d.etag) ?? "",
          createdAt: str(d.createdAt) ?? "",
          updatedAt: str(d.updatedAt) ?? change.createdAt,
          deletedAt: str(d.deletedAt) ?? change.createdAt,
        });
      } else {
        tx.put<CachedList>("lists", {
          id: change.entityId,
          name: str(d.name) ?? "",
          description: str(d.description) ?? "",
          version: num(d.version) ?? change.version,
          etag: str(d.etag) ?? "",
          createdAt: str(d.createdAt) ?? "",
          updatedAt: str(d.updatedAt) ?? change.createdAt,
        });
      }
      break;

    case "list_item":
      if (change.op === "deleted") {
        tx.delete("listItems", change.entityId);
      } else {
        tx.put<CachedListItem>("listItems", {
          id: change.entityId,
          listId: str(d.listId) ?? "",
          savedRepositoryId: str(d.savedRepositoryId) ?? "",
          position: str(d.position) ?? "m",
          note: str(d.note),
          version: num(d.version) ?? change.version,
          createdAt: str(d.createdAt) ?? change.createdAt,
          updatedAt: str(d.updatedAt) ?? change.createdAt,
        });
      }
      break;

    case "preference":
      if (!change.data) return;
      tx.put<CachedPreferences>("preferences", {
        id: "singleton",
        data: (d.data as Record<string, unknown>) ?? {},
        version: num(d.version) ?? change.version,
        etag: str(d.etag) ?? "",
        updatedAt: str(d.updatedAt) ?? change.createdAt,
      });
      break;

    default:
      // Unknown entity type — skip silently for forward compatibility.
      break;
  }
}

// --- Type coercion helpers ---

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}
function arr(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : [];
}
