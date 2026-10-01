// src/data/offlineMutations.ts
// Offline-first mutation plumbing for the UI (INH-406 closure).
//
// Pattern (ADR-0004 D3 atomicity): every user write runs through
// `enqueueAndAttempt`, which in ONE localStore.transaction applies the
// optimistic cache write AND persists the durable queue entry (the queue id
// doubles as the Idempotency-Key). When online, the live API call fires
// immediately with the SAME idempotency key:
//   - success            -> queue entry completed, server response upserted
//                           into the cache
//   - ApiError 400/404   -> permanent failure: queue entry dropped, error
//                           surfaced to the caller
//   - network error / 5xx / 401 / 403 / 409 / 429 -> queue entry stays
//                           pending; pushReplay replays it on reconnect
//                           (wired in App.tsx).
//
// It also owns the stale-while-revalidate cache views (cache -> API DTO
// shapes) so pages can hydrate from localStore before the network answers.
//
// Payload shapes mirror src/sync/syncClient.ts sendMutation exactly so a
// queued entry replays identically to the live call. Notable decision:
// `list_item` reorder is NOT enqueued — sendMutation replays an update as
// `reorder: [singleId]` (server moves that item to the front), which cannot
// express a full desired-order array; reordering therefore stays online-only.

import { localStore } from "./index";
import type {
  CachedList,
  CachedListItem,
  CachedRepository,
  CachedRepositoryTag,
  CachedSavedRepository,
  CachedTag,
  MutationEntity,
  MutationOperation,
  QueuedMutation,
  StoreName,
  TransactionContext,
} from "./types";
import { mutationQueue, buildIfMatch } from "../sync/syncClient";
import { ApiError, apiDelete, apiPut, apiPost } from "../utils/api";
import type {
  ListDetail,
  ListSummary,
  RepositoryDetailView,
  RepositoryProjection,
  SavedRepository,
  Tag,
} from "../utils/gitstarsApi";
import { useSyncStatusStore } from "../store/useSyncStatusStore";

// --- helpers -------------------------------------------------------------

const PENDING_PREFIX = "pending:";

const nowIso = (): string => new Date().toISOString();

const uuid = (): string =>
  globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : String(Math.random());

const isOnline = (): boolean =>
  typeof navigator === "undefined" || navigator.onLine;

function refreshCounts(): void {
  void useSyncStatusStore.getState().updatePendingCount();
}

// --- core: optimistic apply + enqueue + online attempt ---------------------

export interface MutationOutcome<T> {
  /** Optimistic cache write + queue entry are durable. */
  applied: boolean;
  /** The live call succeeded and the queue entry was completed. */
  confirmed: boolean;
  /** Server response when confirmed. */
  response: T | null;
  /** entityId used for the queue entry / optimistic cache row. */
  entityId: string;
  /** Failure of the live attempt (queue entry pending or dropped). */
  error?: unknown;
}

interface AttemptSpec<T> {
  entity: MutationEntity;
  operation: MutationOperation;
  entityId: string;
  baseVersion: number;
  payload: unknown;
  /** Stores touched by the optimistic write; "mutationQueue" is added. */
  stores: StoreName[];
  optimistic: (tx: TransactionContext) => Promise<void> | void;
  /** Live request; MUST reuse the queue id as its Idempotency-Key. */
  attempt: (queueId: string) => Promise<T>;
  /** Cache repair after a confirmed server response. */
  onSuccess?: (response: T) => Promise<void> | void;
}

async function enqueueAndAttempt<T>(
  spec: AttemptSpec<T>,
): Promise<MutationOutcome<T>> {
  const queueId = uuid();

  // 1. Atomic: optimistic cache write + durable enqueue (ADR-0004 D3).
  await localStore.transaction(
    [...spec.stores, "mutationQueue"],
    "readwrite",
    async (tx) => {
      await spec.optimistic(tx);
      const entry: QueuedMutation = {
        id: queueId,
        entity: spec.entity,
        operation: spec.operation,
        entityId: spec.entityId,
        baseVersion: spec.baseVersion,
        payload: spec.payload,
        createdAt: nowIso(),
        retryCount: 0,
        status: "pending",
      };
      tx.put<QueuedMutation>("mutationQueue", entry);
    },
  );
  refreshCounts();

  const applied: MutationOutcome<T> = {
    applied: true,
    confirmed: false,
    response: null,
    entityId: spec.entityId,
  };

  // 2. Online attempt with the same idempotency key.
  if (!isOnline()) return applied;

  try {
    const response = await spec.attempt(queueId);
    await mutationQueue.complete(queueId);
    await spec.onSuccess?.(response);
    refreshCounts();
    return { ...applied, confirmed: true, response };
  } catch (err) {
    if (err instanceof ApiError && (err.status === 400 || err.status === 404)) {
      // Permanent failure (validation / missing entity): drop the entry.
      await mutationQueue.complete(queueId);
      refreshCounts();
    }
    // Everything else stays pending for replay on reconnect.
    return { ...applied, error: err };
  }
}

// --- cache views (stale-while-revalidate reads) -----------------------------

function toProjection(r: RepositoryProjection): RepositoryProjection {
  return {
    id: r.id,
    providerType: r.providerType,
    host: r.host,
    remoteId: r.remoteId,
    canonicalKey: r.canonicalKey,
    name: r.name,
    namespacePath: r.namespacePath,
    webUrl: r.webUrl,
    description: r.description,
    visibility: r.visibility,
    primaryLanguage: r.primaryLanguage,
    starsCount: r.starsCount,
    forksCount: r.forksCount,
    status: r.status,
  };
}

/** Library view hydrated from the cache: savedRepositories ⋈ repositories ⋈ tags. */
export async function readLibraryCache(): Promise<{
  items: SavedRepository[];
  tags: Tag[];
}> {
  const [saved, repos, repoTags, tags] = await Promise.all([
    localStore.getSavedRepositories(),
    localStore.getRepositories(),
    localStore.getRepositoryTags(),
    localStore.getTags(),
  ]);
  const repoById = new Map(repos.map((r) => [r.id, r]));
  const tagById = new Map(tags.map((t) => [t.id, t]));
  const tagIdsBySaved = new Map<string, string[]>();
  for (const rt of repoTags) {
    const list = tagIdsBySaved.get(rt.savedRepositoryId) ?? [];
    list.push(rt.tagId);
    tagIdsBySaved.set(rt.savedRepositoryId, list);
  }

  // Hide optimistic create rows once a server-created row for the same
  // repository exists (the replay/change feed supersedes them).
  const realRepoIds = new Set(
    saved
      .filter((s) => !s.deletedAt && !s.id.startsWith(PENDING_PREFIX))
      .map((s) => s.repositoryId),
  );

  const items: SavedRepository[] = [];
  for (const s of saved) {
    if (s.deletedAt) continue;
    if (s.id.startsWith(PENDING_PREFIX) && realRepoIds.has(s.repositoryId)) {
      continue;
    }
    const repo = repoById.get(s.repositoryId);
    if (!repo) continue;
    items.push({
      id: s.id,
      version: s.version,
      etag: s.etag,
      status: s.status,
      note: s.note,
      aiTags: s.aiTags,
      addedAt: s.addedAt,
      updatedAt: s.updatedAt,
      repository: toProjection(repo),
      tags: (tagIdsBySaved.get(s.id) ?? [])
        .map((id) => tagById.get(id))
        .filter((t): t is CachedTag => Boolean(t))
        .map((t) => ({ id: t.id, name: t.name })),
    });
  }
  items.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  return {
    items,
    tags: tags.map((t) => ({
      id: t.id,
      name: t.name,
      created_at: t.createdAt,
    })),
  };
}

/** Lists view hydrated from the cache, with item counts. */
export async function readListsCache(): Promise<ListSummary[]> {
  const [lists, items] = await Promise.all([
    localStore.getLists(),
    localStore.getListItems(),
  ]);
  const realNames = new Set(
    lists
      .filter((l) => !l.deletedAt && !l.id.startsWith(PENDING_PREFIX))
      .map((l) => l.name),
  );
  // Distinct saved repositories per list (synthetic optimistic rows and their
  // server-created counterparts refer to the same membership).
  const itemsByList = new Map<string, Set<string>>();
  for (const item of items) {
    const set = itemsByList.get(item.listId) ?? new Set<string>();
    set.add(item.savedRepositoryId);
    itemsByList.set(item.listId, set);
  }
  return lists
    .filter((l) => !l.deletedAt)
    .filter((l) => !l.id.startsWith(PENDING_PREFIX) || !realNames.has(l.name))
    .map((l) => ({
      id: l.id,
      name: l.name,
      description: l.description,
      version: l.version,
      etag: l.etag,
      createdAt: l.createdAt,
      updatedAt: l.updatedAt,
      itemCount: itemsByList.get(l.id)?.size ?? 0,
    }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Order list items by position. Server-synced rows carry numeric positions;
 * optimistic rows carry a fractional-style suffix and always sort last.
 */
function compareListItems(a: CachedListItem, b: CachedListItem): number {
  const na = Number(a.position);
  const nb = Number(b.position);
  const aNumeric = a.position !== "" && Number.isFinite(na);
  const bNumeric = b.position !== "" && Number.isFinite(nb);
  if (aNumeric && bNumeric) return na - nb;
  if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
  return a.position.localeCompare(b.position);
}

/** List detail hydrated from the cache, repository names via saved→repositories. */
export async function readListDetailCache(
  listId: string,
): Promise<ListDetail | null> {
  const [list, allItems, saved, repos] = await Promise.all([
    localStore.getList(listId),
    localStore.getListItems(),
    localStore.getSavedRepositories(),
    localStore.getRepositories(),
  ]);
  if (!list || list.deletedAt) return null;
  const repoById = new Map(repos.map((r) => [r.id, r]));
  const savedById = new Map(saved.map((s) => [s.id, s]));

  // Prefer server-created item rows (UUID ids) over synthetic optimistic ones
  // (`${listId}:${savedRepositoryId}` contains a colon; UUIDs do not).
  const bySavedId = new Map<string, CachedListItem>();
  for (const item of allItems) {
    if (item.listId !== listId) continue;
    const existing = bySavedId.get(item.savedRepositoryId);
    const synthetic = (id: string) => id.includes(":");
    if (!existing || (synthetic(existing.id) && !synthetic(item.id))) {
      bySavedId.set(item.savedRepositoryId, item);
    }
  }

  const items = [...bySavedId.values()]
    .sort(compareListItems)
    .flatMap((item, index) => {
      const sr = savedById.get(item.savedRepositoryId);
      const repo = sr ? repoById.get(sr.repositoryId) : undefined;
      if (!sr || !repo) return [];
      return [
        {
          id: item.id,
          savedRepositoryId: item.savedRepositoryId,
          position: Number.isFinite(Number(item.position))
            ? Number(item.position)
            : index,
          note: item.note,
          repository: {
            id: repo.id,
            providerType: repo.providerType,
            name: repo.name,
            webUrl: repo.webUrl,
          },
        },
      ];
    });

  return {
    id: list.id,
    name: list.name,
    description: list.description,
    version: list.version,
    etag: list.etag,
    createdAt: list.createdAt,
    updatedAt: list.updatedAt,
    itemCount: items.length,
    items,
  };
}

/** Saved-state for one repository, hydrated from the cache. */
export async function readRepositorySavedCache(repositoryId: string): Promise<{
  repo: CachedRepository | null;
  saved: {
    id: string;
    status: string;
    note?: string;
    version: number;
    addedAt: string;
    tags: Array<{ id: string; name: string }>;
  } | null;
  tags: Tag[];
}> {
  const [repo, saved, repoTags, tags] = await Promise.all([
    localStore.getRepository(repositoryId),
    localStore.getSavedRepositories(),
    localStore.getRepositoryTags(),
    localStore.getTags(),
  ]);
  const row = saved.find(
    (s) => !s.deletedAt && s.repositoryId === repositoryId,
  );
  const tagById = new Map(tags.map((t) => [t.id, t]));
  const savedTags = row
    ? repoTags
        .filter((rt) => rt.savedRepositoryId === row.id)
        .map((rt) => tagById.get(rt.tagId))
        .filter((t): t is CachedTag => Boolean(t))
        .map((t) => ({ id: t.id, name: t.name }))
    : [];
  return {
    repo: repo ?? null,
    saved: row
      ? {
          id: row.id,
          status: row.status,
          note: row.note,
          version: row.version,
          addedAt: row.addedAt,
          tags: savedTags,
        }
      : null,
    tags: tags.map((t) => ({
      id: t.id,
      name: t.name,
      created_at: t.createdAt,
    })),
  };
}

/** Match a provider search result against the cached repository catalog. */
export async function matchCachedRepository(
  providerType: string,
  remoteId: string,
): Promise<CachedRepository | null> {
  const repos = await localStore.getRepositories();
  return (
    repos.find(
      (r) => r.providerType === providerType && r.remoteId === remoteId,
    ) ?? null
  );
}

// --- cache upserts (revalidate pass keeps the cache coherent) ---------------

/** Upsert a fetched library page (simple upsert; the change feed also maintains it). */
export async function upsertLibraryPage(
  items: SavedRepository[],
): Promise<void> {
  if (items.length === 0) return;
  await localStore.transaction(
    ["repositories", "savedRepositories", "tags", "repositoryTags"],
    "readwrite",
    async (tx) => {
      for (const item of items) {
        const existing = await tx.get<CachedRepository>(
          "repositories",
          item.repository.id,
        );
        tx.put<CachedRepository>("repositories", {
          ...(existing ?? {}),
          ...item.repository,
          cachedAt: nowIso(),
        });
        tx.put<CachedSavedRepository>("savedRepositories", {
          id: item.id,
          repositoryId: item.repository.id,
          status: item.status,
          note: item.note,
          aiTags: item.aiTags,
          version: item.version,
          etag: item.etag,
          addedAt: item.addedAt,
          updatedAt: item.updatedAt,
        });
        for (const tag of item.tags) {
          const existingTag = await tx.get<CachedTag>("tags", tag.id);
          if (!existingTag) {
            tx.put<CachedTag>("tags", {
              id: tag.id,
              name: tag.name,
              createdAt: nowIso(),
            });
          }
          const rt: CachedRepositoryTag = {
            tagId: tag.id,
            savedRepositoryId: item.id,
            createdAt: nowIso(),
          };
          tx.put<CachedRepositoryTag>("repositoryTags", rt);
        }
      }
      // Clean optimistic create rows now covered by server rows.
      const allSaved =
        await tx.getAll<CachedSavedRepository>("savedRepositories");
      const fetchedRepoIds = new Set(items.map((i) => i.repository.id));
      for (const s of allSaved) {
        if (
          s.id.startsWith(PENDING_PREFIX) &&
          fetchedRepoIds.has(s.repositoryId)
        ) {
          tx.delete("savedRepositories", s.id);
        }
      }
    },
  );
}

export async function upsertTags(tags: Tag[]): Promise<void> {
  if (tags.length === 0) return;
  await localStore.transaction(["tags"], "readwrite", async (tx) => {
    for (const tag of tags) {
      tx.put<CachedTag>("tags", {
        id: tag.id,
        name: tag.name,
        createdAt: tag.created_at || nowIso(),
      });
    }
  });
}

export async function upsertListSummaries(lists: ListSummary[]): Promise<void> {
  await localStore.transaction(["lists"], "readwrite", async (tx) => {
    for (const list of lists) {
      tx.put<CachedList>("lists", {
        id: list.id,
        name: list.name,
        description: list.description,
        version: list.version,
        etag: list.etag,
        createdAt: list.createdAt,
        updatedAt: list.updatedAt,
      });
    }
    // Clean optimistic create rows now covered by server rows (name match).
    if (lists.length > 0) {
      const all = await tx.getAll<CachedList>("lists");
      const names = new Set(lists.map((l) => l.name));
      for (const l of all) {
        if (l.id.startsWith(PENDING_PREFIX) && names.has(l.name)) {
          tx.delete("lists", l.id);
        }
      }
    }
  });
}

/** Replace the cached items of one list from a fresh server detail. */
export async function upsertListDetail(detail: ListDetail): Promise<void> {
  await localStore.transaction(
    ["lists", "listItems"],
    "readwrite",
    async (tx) => {
      tx.put<CachedList>("lists", {
        id: detail.id,
        name: detail.name,
        description: detail.description,
        version: detail.version,
        etag: detail.etag,
        createdAt: detail.createdAt,
        updatedAt: detail.updatedAt,
      });
      const all = await tx.getAll<CachedListItem>("listItems");
      for (const item of all) {
        if (item.listId === detail.id) tx.delete("listItems", item.id);
      }
      detail.items.forEach((item, index) => {
        tx.put<CachedListItem>("listItems", {
          id: item.id,
          listId: detail.id,
          savedRepositoryId: item.savedRepositoryId,
          position: String(item.position ?? index),
          note: item.note,
          version: 1,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        });
      });
    },
  );
}

export async function upsertSavedResponse(
  saved: SavedRepository,
): Promise<void> {
  await upsertLibraryPage([saved]);
}

/** Upsert a repository detail view (header fields + saved state + tags). */
export async function upsertRepositoryDetail(
  view: RepositoryDetailView,
): Promise<void> {
  await localStore.transaction(
    ["repositories", "savedRepositories", "tags", "repositoryTags"],
    "readwrite",
    async (tx) => {
      const existing = await tx.get<CachedRepository>("repositories", view.id);
      tx.put<CachedRepository>("repositories", {
        ...(existing ?? {}),
        ...toProjection(view),
        cachedAt: nowIso(),
      });
      if (view.saved) {
        const saved = view.saved;
        const row = await tx.get<CachedSavedRepository>(
          "savedRepositories",
          saved.id,
        );
        tx.put<CachedSavedRepository>("savedRepositories", {
          id: saved.id,
          repositoryId: view.id,
          status: saved.status,
          note: saved.note,
          aiTags: row?.aiTags ?? [],
          version: saved.version,
          etag: row?.etag ?? buildIfMatch(saved.id, saved.version),
          addedAt: saved.addedAt,
          updatedAt: row?.updatedAt ?? nowIso(),
        });
        for (const tag of saved.tags) {
          const existingTag = await tx.get<CachedTag>("tags", tag.id);
          if (!existingTag) {
            tx.put<CachedTag>("tags", {
              id: tag.id,
              name: tag.name,
              createdAt: nowIso(),
            });
          }
          tx.put<CachedRepositoryTag>("repositoryTags", {
            tagId: tag.id,
            savedRepositoryId: saved.id,
            createdAt: nowIso(),
          });
        }
      }
    },
  );
}

// --- concrete mutations -----------------------------------------------------

function friendly(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : "操作失败";
}

/** Human-readable message for an outcome the caller wants to surface. */
export function outcomeErrorLabel(outcome: MutationOutcome<unknown>): string {
  if (outcome.error instanceof ApiError) {
    return `${outcome.error.code}: ${outcome.error.message}`;
  }
  return outcome.error ? friendly(outcome.error) : "操作失败";
}

/**
 * Save a repository to the library. `repositoryId` must be a repository the
 * server already knows (the user's synced catalog), so this mutation is only
 * offered when the repository exists in the local cache.
 */
export function saveRepositoryFromLibrary(repositoryId: string) {
  const entityId = `${PENDING_PREFIX}${repositoryId}`;
  return enqueueAndAttempt<SavedRepository>({
    entity: "saved_repository",
    operation: "create",
    entityId,
    baseVersion: 0,
    payload: { repositoryId },
    stores: ["savedRepositories"],
    optimistic: (tx) => {
      tx.put<CachedSavedRepository>("savedRepositories", {
        id: entityId,
        repositoryId,
        status: "saved",
        aiTags: [],
        version: 1,
        etag: "",
        addedAt: nowIso(),
        updatedAt: nowIso(),
      });
    },
    attempt: (key) =>
      apiPost<SavedRepository>(
        "/api/library",
        { repositoryId },
        { headers: { "Idempotency-Key": key } },
      ),
    onSuccess: async (res) => {
      await upsertSavedResponse(res);
      // Replace the optimistic row with the server-created one.
      if (res.id !== entityId) {
        await localStore.delete("savedRepositories", entityId);
      }
    },
  });
}

/** Unsave (remove from library). */
export function unsaveRepository(saved: { id: string; version: number }) {
  return enqueueAndAttempt<{ ok: boolean }>({
    entity: "saved_repository",
    operation: "delete",
    entityId: saved.id,
    baseVersion: saved.version,
    payload: {},
    stores: ["savedRepositories", "repositoryTags"],
    optimistic: async (tx) => {
      const links = await tx.getAll<CachedRepositoryTag>("repositoryTags");
      for (const link of links) {
        if (link.savedRepositoryId === saved.id) {
          tx.delete("repositoryTags", [link.savedRepositoryId, link.tagId]);
        }
      }
      tx.delete("savedRepositories", saved.id);
    },
    attempt: (key) =>
      apiDelete<{ ok: boolean }>(`/api/library/${saved.id}`, {
        headers: { "Idempotency-Key": key },
      }),
  });
}

/** Update note/status on a saved repository (version-guarded). */
export function updateSavedFields(
  saved: { id: string; version: number },
  patch: { note?: string; status?: string },
) {
  return enqueueAndAttempt<SavedRepository>({
    entity: "saved_repository",
    operation: "update",
    entityId: saved.id,
    baseVersion: saved.version,
    payload: patch,
    stores: ["savedRepositories"],
    optimistic: async (tx) => {
      const row = await tx.get<CachedSavedRepository>(
        "savedRepositories",
        saved.id,
      );
      if (!row) return;
      const nextVersion = saved.version + 1;
      tx.put<CachedSavedRepository>("savedRepositories", {
        ...row,
        note: patch.note !== undefined ? patch.note : row.note,
        status: patch.status !== undefined ? patch.status : row.status,
        version: nextVersion,
        etag: buildIfMatch(row.id, nextVersion),
        updatedAt: nowIso(),
      });
    },
    attempt: (key) =>
      apiPut<SavedRepository>(`/api/library/${saved.id}`, patch, {
        headers: {
          "Idempotency-Key": key,
          "If-Match": buildIfMatch(saved.id, saved.version),
        },
      }),
    onSuccess: (res) => upsertSavedResponse(res),
  });
}

/** Attach an existing tag to a saved repository. */
export function attachTagToSaved(savedId: string, tagId: string) {
  const entityId = `${savedId}:${tagId}`;
  return enqueueAndAttempt<{ ok: boolean }>({
    entity: "repository_tag",
    operation: "create",
    entityId,
    baseVersion: 0,
    payload: { saved_repository_id: savedId, tag_id: tagId },
    stores: ["repositoryTags"],
    optimistic: (tx) => {
      tx.put<CachedRepositoryTag>("repositoryTags", {
        tagId,
        savedRepositoryId: savedId,
        createdAt: nowIso(),
      });
    },
    attempt: (key) =>
      apiPut<{ ok: boolean }>(
        `/api/library/${savedId}/tags/${tagId}`,
        undefined,
        { headers: { "Idempotency-Key": key } },
      ),
  });
}

/** Detach a tag from a saved repository. */
export function detachTagFromSaved(savedId: string, tagId: string) {
  const entityId = `${savedId}:${tagId}`;
  return enqueueAndAttempt<{ ok: boolean }>({
    entity: "repository_tag",
    operation: "delete",
    entityId,
    baseVersion: 0,
    payload: { saved_repository_id: savedId, tag_id: tagId },
    stores: ["repositoryTags"],
    optimistic: (tx) => {
      tx.delete("repositoryTags", [savedId, tagId]);
    },
    attempt: (key) =>
      apiDelete<{ ok: boolean }>(`/api/library/${savedId}/tags/${tagId}`, {
        headers: { "Idempotency-Key": key },
      }),
  });
}

/** Create a list (optimistic row uses a `pending:` id until the server answers). */
export function createListOffline(name: string, description = "") {
  const entityId = `${PENDING_PREFIX}${uuid()}`;
  return enqueueAndAttempt<ListSummary>({
    entity: "list",
    operation: "create",
    entityId,
    baseVersion: 0,
    payload: { name, description },
    stores: ["lists"],
    optimistic: (tx) => {
      tx.put<CachedList>("lists", {
        id: entityId,
        name,
        description,
        version: 1,
        etag: "",
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });
    },
    attempt: (key) =>
      apiPost<ListSummary>(
        "/api/lists",
        { name, description },
        { headers: { "Idempotency-Key": key } },
      ),
    onSuccess: async (res) => {
      await upsertListSummaries([res]);
      if (res.id !== entityId) {
        await localStore.delete("lists", entityId);
      }
    },
  });
}

/** Rename a list (version-guarded). */
export function renameList(
  list: { id: string; version: number },
  name: string,
) {
  return enqueueAndAttempt<ListSummary>({
    entity: "list",
    operation: "update",
    entityId: list.id,
    baseVersion: list.version,
    payload: { name },
    stores: ["lists"],
    optimistic: async (tx) => {
      const row = await tx.get<CachedList>("lists", list.id);
      if (!row) return;
      tx.put<CachedList>("lists", {
        ...row,
        name,
        version: list.version + 1,
        etag: buildIfMatch(row.id, list.version + 1),
        updatedAt: nowIso(),
      });
    },
    attempt: (key) =>
      apiPut<ListSummary>(
        `/api/lists/${list.id}`,
        { name },
        {
          headers: {
            "Idempotency-Key": key,
            "If-Match": buildIfMatch(list.id, list.version),
          },
        },
      ),
    onSuccess: (res) => upsertListSummaries([res]),
  });
}

/** Delete a list and its items. */
export function deleteListOffline(list: { id: string; version: number }) {
  return enqueueAndAttempt<{ ok: boolean }>({
    entity: "list",
    operation: "delete",
    entityId: list.id,
    baseVersion: list.version,
    payload: {},
    stores: ["lists", "listItems"],
    optimistic: async (tx) => {
      const items = await tx.getAll<CachedListItem>("listItems");
      for (const item of items) {
        if (item.listId === list.id) tx.delete("listItems", item.id);
      }
      tx.delete("lists", list.id);
    },
    attempt: (key) =>
      apiDelete<{ ok: boolean }>(`/api/lists/${list.id}`, {
        headers: { "Idempotency-Key": key },
      }),
  });
}

/** Add a saved repository to a list (optimistic row uses `listId:savedId`). */
export function addListItemOffline(listId: string, savedRepositoryId: string) {
  const entityId = `${listId}:${savedRepositoryId}`;
  return enqueueAndAttempt<ListDetail>({
    entity: "list_item",
    operation: "create",
    entityId,
    baseVersion: 0,
    payload: { list_id: listId, saved_repository_id: savedRepositoryId },
    stores: ["listItems"],
    optimistic: async (tx) => {
      const items = await tx.getAll<CachedListItem>("listItems");
      const inList = items.filter((i) => i.listId === listId);
      if (inList.some((i) => i.savedRepositoryId === savedRepositoryId)) {
        return;
      }
      const maxPosition =
        inList
          .map((i) => i.position)
          .sort()
          .at(-1) ?? "";
      tx.put<CachedListItem>("listItems", {
        id: entityId,
        listId,
        savedRepositoryId,
        position: `${maxPosition}z`,
        version: 1,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });
    },
    attempt: (key) =>
      apiPut<ListDetail>(
        `/api/lists/${listId}/items`,
        { add: [savedRepositoryId] },
        { headers: { "Idempotency-Key": key } },
      ),
    onSuccess: (res) => upsertListDetail(res),
  });
}

/** Remove a saved repository from a list. */
export function removeListItemOffline(
  listId: string,
  savedRepositoryId: string,
) {
  const entityId = `${listId}:${savedRepositoryId}`;
  return enqueueAndAttempt<ListDetail>({
    entity: "list_item",
    operation: "delete",
    entityId,
    baseVersion: 0,
    payload: { list_id: listId, saved_repository_id: savedRepositoryId },
    stores: ["listItems"],
    optimistic: async (tx) => {
      const items = await tx.getAll<CachedListItem>("listItems");
      for (const item of items) {
        if (
          item.listId === listId &&
          item.savedRepositoryId === savedRepositoryId
        ) {
          tx.delete("listItems", item.id);
        }
      }
    },
    attempt: (key) =>
      apiPut<ListDetail>(
        `/api/lists/${listId}/items`,
        { remove: [savedRepositoryId] },
        { headers: { "Idempotency-Key": key } },
      ),
    onSuccess: (res) => upsertListDetail(res),
  });
}
