// src/sync/__tests__/pullSync.test.ts
// Tests for the incremental pull sync engine (INH-410).

import { describe, it, expect, beforeEach, vi } from "vitest";
import { LocalStore } from "../../data/LocalStore";
import { InMemoryDriver } from "../../data/driver/InMemoryDriver";
import { createPullSync, StaleClientError, type PullStatus } from "../pullSync";
import type { ChangeFeedResponse, ChangeEntry } from "../../utils/gitstarsApi";

// --- Helpers ---

function makeChange(
  seq: number,
  entityType: string,
  entityId: string,
  op: string,
  data: Record<string, unknown> = {},
  version = 1,
): ChangeEntry {
  return {
    seq,
    entityType,
    entityId,
    op,
    version,
    createdAt: "2026-09-06T00:00:00Z",
    data,
  };
}

function feed(
  changes: ChangeEntry[],
  opts: { hasMore?: boolean; protocolVersion?: number } = {},
): ChangeFeedResponse {
  return {
    changes,
    nextCursor: changes.length ? changes[changes.length - 1].seq : 0,
    hasMore: opts.hasMore ?? false,
    protocolVersion: opts.protocolVersion ?? 1,
  };
}

function mockApiClient(
  responses: ChangeFeedResponse[],
  opts: { failAtIndex?: number; error?: Error } = {},
) {
  let callCount = 0;
  return {
    getChanges: vi.fn(async (_since: number, _limit?: number) => {
      if (opts.failAtIndex !== undefined && callCount >= opts.failAtIndex) {
        throw opts.error ?? new Error("Network error");
      }
      const idx = Math.min(callCount, responses.length - 1);
      callCount++;
      return responses[idx];
    }),
  };
}

// --- Suite ---

describe("pullSync", () => {
  let store: LocalStore;
  let driver: InMemoryDriver;

  beforeEach(async () => {
    driver = new InMemoryDriver();
    store = new LocalStore(driver);
    await store.open();
    await store.migrate();
  });

  // 1. Bootstrap from empty
  it("bootstrap from empty → applies all changes, cursor at latest seq", async () => {
    const changes = [
      makeChange(1, "repository", "r1", "created", {
        name: "react",
        webUrl: "https://github.com/facebook/react",
        providerType: "github",
        host: "github.com",
        remoteId: "rid1",
        canonicalKey: "facebook/react",
        starsCount: 100,
        forksCount: 20,
        cachedAt: "2026-01-01T00:00:00Z",
      }),
      makeChange(
        2,
        "saved_repository",
        "sr1",
        "created",
        {
          repositoryId: "r1",
          status: "saved",
          aiTags: [],
          version: 1,
          etag: "e1",
          addedAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
        1,
      ),
      makeChange(3, "tag", "t1", "created", { name: "frontend" }),
      makeChange(
        4,
        "preference",
        "singleton",
        "updated",
        { data: { theme: "dark" }, version: 1, etag: "pe1" },
        1,
      ),
    ];

    const api = mockApiClient([feed(changes)]);
    const statuses: PullStatus[] = [];
    const ps = createPullSync({
      localStore: store,
      apiClient: api,
      onStatusChange: (s) => statuses.push(s),
    });

    const result = await ps.bootstrap();

    expect(result.applied).toBe(4);
    expect(result.cursor).toBe(4);
    expect(result.hasMore).toBe(false);

    // Verify data applied.
    const repo = await store.getRepository("r1");
    expect(repo).toBeDefined();
    expect(repo!.name).toBe("react");

    const sr = await store.getSavedRepository("sr1");
    expect(sr).toBeDefined();
    expect(sr!.repositoryId).toBe("r1");

    const tags = await store.getTags();
    expect(tags).toHaveLength(1);
    expect(tags[0].name).toBe("frontend");

    const prefs = await store.getPreferences();
    expect(prefs).toBeDefined();
    expect(prefs!.data).toEqual({ theme: "dark" });

    // Cursor persisted.
    const cursor = await store.getSyncCursor();
    expect(cursor).toBeDefined();
    expect(cursor!.lastSeq).toBe(4);

    // Status transitions.
    expect(statuses).toContain("pulling");
    expect(statuses).toContain("reconciling");
  });

  // 2. Incremental pull
  it("incremental pull → applies only new changes since cursor", async () => {
    // First bootstrap.
    const batch1 = [
      makeChange(1, "tag", "t1", "created", { name: "alpha" }),
      makeChange(2, "tag", "t2", "created", { name: "beta" }),
    ];
    const api1 = mockApiClient([feed(batch1)]);
    const ps1 = createPullSync({ localStore: store, apiClient: api1 });
    await ps1.bootstrap();

    // Incremental pull with new changes.
    const batch2 = [makeChange(3, "tag", "t3", "created", { name: "gamma" })];
    const api2 = mockApiClient([feed(batch2)]);
    const ps2 = createPullSync({ localStore: store, apiClient: api2 });
    const result = await ps2.pullIncremental();

    expect(result.applied).toBe(1);
    expect(result.cursor).toBe(3);

    // All 3 tags present.
    const tags = await store.getTags();
    expect(tags).toHaveLength(3);
    expect(tags.map((t) => t.name).sort()).toEqual(["alpha", "beta", "gamma"]);

    // getChanges was called with since=2 (the last cursor).
    expect(api2.getChanges).toHaveBeenCalledWith(2, expect.any(Number));
  });

  // 3. Crash mid-batch → cursor not advanced, re-pull is idempotent
  it("crash mid-batch → cursor not advanced, re-pull applies idempotently", async () => {
    const changes = [
      makeChange(1, "tag", "t1", "created", { name: "first" }),
      makeChange(2, "tag", "t2", "created", { name: "second" }),
    ];

    // Use a driver wrapper that throws on the first transaction.
    let txCallCount = 0;
    const origDriver = (store as unknown as { driver: InMemoryDriver }).driver;
    const origTx = origDriver.transaction.bind(origDriver);
    origDriver.transaction = (async (
      names: unknown,
      mode: unknown,
      fn: (tx: unknown) => Promise<unknown>,
    ) => {
      txCallCount++;
      if (txCallCount === 1) {
        return origTx(
          names as string[],
          mode as "readonly" | "readwrite",
          async (tx: unknown) => {
            await fn(tx);
            throw new Error("CRASH mid-batch");
          },
        );
      }
      return origTx(
        names as string[],
        mode as "readonly" | "readwrite",
        fn as (
          tx: import("../../data/types").TransactionContext,
        ) => Promise<unknown>,
      );
    }) as typeof origDriver.transaction;

    const api = mockApiClient([feed(changes)]);
    const ps = createPullSync({ localStore: store, apiClient: api });

    await expect(ps.bootstrap()).rejects.toThrow("CRASH mid-batch");

    // Cursor should NOT have been advanced.
    const cursor = await store.getSyncCursor();
    expect(cursor).toBeUndefined();

    // Tags should NOT have been applied (rolled back).
    const tags = await store.getTags();
    expect(tags).toHaveLength(0);

    // Restore original transaction.
    origDriver.transaction = origTx;

    // Re-pull: same changes, should apply cleanly.
    const api2 = mockApiClient([feed(changes)]);
    const ps2 = createPullSync({ localStore: store, apiClient: api2 });
    const result = await ps2.bootstrap();

    expect(result.applied).toBe(2);
    expect(result.cursor).toBe(2);

    const tagsAfter = await store.getTags();
    expect(tagsAfter).toHaveLength(2);
  });

  // 4. Tombstone handling
  it("tombstone → savedRepository with deletedAt marks local row as deleted", async () => {
    // First, create a saved repository.
    const createChanges = [
      makeChange(
        1,
        "saved_repository",
        "sr1",
        "created",
        {
          repositoryId: "r1",
          status: "saved",
          aiTags: [],
          version: 1,
          etag: "e1",
          addedAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
        1,
      ),
    ];
    const api1 = mockApiClient([feed(createChanges)]);
    const ps1 = createPullSync({ localStore: store, apiClient: api1 });
    await ps1.bootstrap();

    let sr = await store.getSavedRepository("sr1");
    expect(sr).toBeDefined();
    expect(sr!.deletedAt).toBeUndefined();

    // Now apply a tombstone (deleted op).
    const deleteChanges = [
      makeChange(
        2,
        "saved_repository",
        "sr1",
        "deleted",
        {
          repositoryId: "r1",
          status: "deleted",
          version: 2,
          etag: "e2",
          deletedAt: "2026-09-06T00:00:00Z",
          addedAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-09-06T00:00:00Z",
        },
        2,
      ),
    ];
    const api2 = mockApiClient([feed(deleteChanges)]);
    const ps2 = createPullSync({ localStore: store, apiClient: api2 });
    await ps2.pullIncremental();

    sr = await store.getSavedRepository("sr1");
    expect(sr).toBeDefined(); // Tombstone = row still exists with deletedAt.
    expect(sr!.deletedAt).toBe("2026-09-06T00:00:00Z");
    expect(sr!.status).toBe("deleted");
    expect(sr!.version).toBe(2);
  });

  // 5. 426 STALE_CLIENT
  it("426 STALE_CLIENT → stops sync, throws StaleClientError", async () => {
    const staleError = Object.assign(new Error("Stale client"), {
      status: 426,
    });
    const api = mockApiClient([], { failAtIndex: 0, error: staleError });
    const ps = createPullSync({ localStore: store, apiClient: api });

    await expect(ps.sync()).rejects.toThrow(StaleClientError);

    // Cursor should not have been set.
    const cursor = await store.getSyncCursor();
    expect(cursor).toBeUndefined();
  });

  // 6. Network error mid-pull
  it("network error mid-pull → preserves cursor, next pull resumes", async () => {
    // First batch succeeds (paginated).
    const batch1 = [
      makeChange(1, "tag", "t1", "created", { name: "first" }),
      makeChange(2, "tag", "t2", "created", { name: "second" }),
    ];

    let callCount = 0;
    const api = {
      getChanges: vi.fn(async (_since: number) => {
        callCount++;
        if (callCount === 1) {
          return { ...feed(batch1), hasMore: true };
        }
        throw new Error("Network timeout");
      }),
    };

    const ps = createPullSync({ localStore: store, apiClient: api });
    await expect(ps.sync()).rejects.toThrow("Network timeout");

    // First batch was applied, cursor at 2.
    const cursor = await store.getSyncCursor();
    expect(cursor).toBeDefined();
    expect(cursor!.lastSeq).toBe(2);

    const tags = await store.getTags();
    expect(tags).toHaveLength(2);

    // Next pull resumes from cursor=2.
    const batch3 = [makeChange(3, "tag", "t3", "created", { name: "third" })];
    const api2 = mockApiClient([feed(batch3)]);
    const ps2 = createPullSync({ localStore: store, apiClient: api2 });
    const result = await ps2.pullIncremental();

    expect(result.applied).toBe(1);
    expect(result.cursor).toBe(3);

    // All 3 tags present.
    const allTags = await store.getTags();
    expect(allTags).toHaveLength(3);
  });

  // 7. Idempotent re-pull
  it("idempotent re-pull → same changes applied twice produce same state", async () => {
    const changes = [
      makeChange(1, "repository", "r1", "created", {
        name: "vue",
        webUrl: "https://github.com/vuejs/vue",
        providerType: "github",
        host: "github.com",
        remoteId: "rid-vue",
        canonicalKey: "vuejs/vue",
        starsCount: 200,
        forksCount: 30,
        cachedAt: "2026-01-01T00:00:00Z",
      }),
      makeChange(
        2,
        "saved_repository",
        "sr1",
        "created",
        {
          repositoryId: "r1",
          status: "saved",
          aiTags: ["ui"],
          version: 1,
          etag: "e1",
          addedAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
        1,
      ),
      makeChange(3, "list", "l1", "created", {
        name: "My List",
        description: "test",
        version: 1,
        etag: "le1",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      }),
      makeChange(4, "list_item", "li1", "created", {
        listId: "l1",
        savedRepositoryId: "sr1",
        position: 0,
        version: 1,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      }),
    ];

    // Apply once.
    const api1 = mockApiClient([feed(changes)]);
    const ps1 = createPullSync({ localStore: store, apiClient: api1 });
    await ps1.bootstrap();

    // Snapshot state.
    const repos1 = await store.getRepositories();
    const srs1 = await store.getSavedRepositories();
    const lists1 = await store.getLists();
    const items1 = await store.getListItems();
    const cursor1 = await store.getSyncCursor();

    // Reset and re-apply from scratch.
    await store.reset();
    await store.open();
    await store.migrate();

    const api2 = mockApiClient([feed(changes)]);
    const ps2 = createPullSync({ localStore: store, apiClient: api2 });
    await ps2.bootstrap();

    const repos2 = await store.getRepositories();
    const srs2 = await store.getSavedRepositories();
    const lists2 = await store.getLists();
    const items2 = await store.getListItems();
    const cursor2 = await store.getSyncCursor();

    expect(repos1).toEqual(repos2);
    expect(srs1).toEqual(srs2);
    expect(lists1).toEqual(lists2);
    expect(items1).toEqual(items2);
    expect(cursor1).toEqual(cursor2);
  });

  // 8. sync() smart: bootstrap if no cursor, incremental if cursor exists
  it("sync() bootstraps when no cursor, incremental when cursor exists", async () => {
    // First call: no cursor → bootstrap.
    const batch1 = [
      makeChange(1, "tag", "t1", "created", { name: "first" }),
      makeChange(2, "tag", "t2", "created", { name: "second" }),
    ];
    const api1 = mockApiClient([feed(batch1)]);
    const ps1 = createPullSync({ localStore: store, apiClient: api1 });
    const r1 = await ps1.sync();
    expect(r1.applied).toBe(2);
    expect(api1.getChanges).toHaveBeenCalledWith(0, expect.any(Number));

    // Second call: cursor exists → incremental.
    const batch2 = [makeChange(3, "tag", "t3", "created", { name: "third" })];
    const api2 = mockApiClient([feed(batch2)]);
    const ps2 = createPullSync({ localStore: store, apiClient: api2 });
    const r2 = await ps2.sync();
    expect(r2.applied).toBe(1);
    expect(api2.getChanges).toHaveBeenCalledWith(2, expect.any(Number));
  });

  // 9. Multi-page bootstrap (hasMore pagination)
  it("multi-page bootstrap → paginates through all pages", async () => {
    const page1 = [
      makeChange(1, "tag", "t1", "created", { name: "p1a" }),
      makeChange(2, "tag", "t2", "created", { name: "p1b" }),
    ];
    const page2 = [makeChange(3, "tag", "t3", "created", { name: "p2a" })];

    let callCount = 0;
    const api = {
      getChanges: vi.fn(async (_since: number) => {
        callCount++;
        if (callCount === 1) return feed(page1, { hasMore: true });
        return feed(page2);
      }),
    };

    const ps = createPullSync({ localStore: store, apiClient: api });
    const result = await ps.bootstrap();

    expect(result.applied).toBe(3);
    expect(result.cursor).toBe(3);
    expect(api.getChanges).toHaveBeenCalledTimes(2);

    const tags = await store.getTags();
    expect(tags).toHaveLength(3);
  });

  // 10. repository_tag and list_item delete
  it("repository_tag delete and list_item delete remove local rows", async () => {
    // Create entities.
    const createChanges = [
      makeChange(1, "repository_tag", "rt1", "created", {
        tagId: "t1",
        savedRepositoryId: "sr1",
        createdAt: "2026-01-01T00:00:00Z",
      }),
      makeChange(2, "list_item", "li1", "created", {
        listId: "l1",
        savedRepositoryId: "sr1",
        position: 0,
        version: 1,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      }),
    ];
    const api1 = mockApiClient([feed(createChanges)]);
    const ps1 = createPullSync({ localStore: store, apiClient: api1 });
    await ps1.bootstrap();

    let repoTags = await store.getRepositoryTags();
    expect(repoTags).toHaveLength(1);
    let items = await store.getListItems();
    expect(items).toHaveLength(1);

    // Delete them.
    const deleteChanges = [
      makeChange(3, "repository_tag", "rt1", "deleted", {
        tagId: "t1",
        savedRepositoryId: "sr1",
      }),
      makeChange(4, "list_item", "li1", "deleted", {}),
    ];
    const api2 = mockApiClient([feed(deleteChanges)]);
    const ps2 = createPullSync({ localStore: store, apiClient: api2 });
    await ps2.pullIncremental();

    repoTags = await store.getRepositoryTags();
    expect(repoTags).toHaveLength(0);
    items = await store.getListItems();
    expect(items).toHaveLength(0);
  });
});
