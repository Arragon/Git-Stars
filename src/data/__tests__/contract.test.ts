// src/data/__tests__/contract.test.ts
// Driver-agnostic contract tests — run against both IndexedDB and InMemory drivers.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type {
  LocalStoreDriver,
  CachedRepository,
  CachedSavedRepository,
} from "../types";
import { InMemoryDriver } from "../driver/InMemoryDriver";
import { IndexedDBDriver } from "../driver/IndexedDBDriver";

function makeRepo(
  id: string,
  overrides?: Partial<CachedRepository>,
): CachedRepository {
  return {
    id,
    providerType: "github",
    host: "github.com",
    remoteId: `remote-${id}`,
    canonicalKey: `github.com/${id}`,
    name: id,
    webUrl: `https://github.com/test/${id}`,
    starsCount: 0,
    forksCount: 0,
    status: "active",
    cachedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeSavedRepo(id: string, repoId: string): CachedSavedRepository {
  return {
    id,
    repositoryId: repoId,
    status: "saved",
    aiTags: [],
    version: 1,
    etag: `etag-${id}`,
    addedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function runContractSuite(
  driverName: string,
  createDriver: () => LocalStoreDriver,
) {
  describe(`contract: ${driverName}`, () => {
    let driver: LocalStoreDriver;

    beforeEach(async () => {
      driver = createDriver();
      await driver.open();
      await driver.migrate();
    });

    afterEach(async () => {
      await driver.close();
    });

    it("put → get → delete → get returns undefined", async () => {
      const repo = makeRepo("r1");
      await driver.put("repositories", repo);

      const fetched = await driver.get<CachedRepository>("repositories", "r1");
      expect(fetched).toEqual(repo);

      await driver.delete("repositories", "r1");
      const afterDelete = await driver.get<CachedRepository>(
        "repositories",
        "r1",
      );
      expect(afterDelete).toBeUndefined();
    });

    it("getAll returns all rows", async () => {
      await driver.put("repositories", makeRepo("r1"));
      await driver.put("repositories", makeRepo("r2"));
      await driver.put("repositories", makeRepo("r3"));

      const all = await driver.getAll<CachedRepository>("repositories");
      expect(all).toHaveLength(3);
      expect(all.map((r) => r.id).sort()).toEqual(["r1", "r2", "r3"]);
    });

    it("transaction: atomic commit", async () => {
      await driver.transaction(
        ["repositories", "savedRepositories"],
        "readwrite",
        async (tx) => {
          tx.put("repositories", makeRepo("r1"));
          tx.put("savedRepositories", makeSavedRepo("s1", "r1"));
        },
      );

      const repo = await driver.get<CachedRepository>("repositories", "r1");
      expect(repo).toBeDefined();
      expect(repo!.id).toBe("r1");

      const saved = await driver.get<CachedSavedRepository>(
        "savedRepositories",
        "s1",
      );
      expect(saved).toBeDefined();
      expect(saved!.id).toBe("s1");
    });

    it("transaction: rollback on error", async () => {
      // Put initial data.
      await driver.put("repositories", makeRepo("r1"));

      // Attempt a transaction that fails.
      await expect(
        driver.transaction(
          ["repositories", "savedRepositories"],
          "readwrite",
          async (tx) => {
            tx.put("repositories", makeRepo("r2"));
            throw new Error("rollback!");
          },
        ),
      ).rejects.toThrow("rollback!");

      // r1 should still exist.
      const r1 = await driver.get<CachedRepository>("repositories", "r1");
      expect(r1).toBeDefined();

      // r2 should NOT exist (rolled back).
      const r2 = await driver.get<CachedRepository>("repositories", "r2");
      expect(r2).toBeUndefined();
    });

    it("clearRepositoryCache does not affect user-state stores", async () => {
      await driver.put("repositories", makeRepo("r1"));
      await driver.put("savedRepositories", makeSavedRepo("s1", "r1"));

      await driver.clearRepositoryCache();

      const repo = await driver.get<CachedRepository>("repositories", "r1");
      expect(repo).toBeUndefined();

      const saved = await driver.get<CachedSavedRepository>(
        "savedRepositories",
        "s1",
      );
      expect(saved).toBeDefined();
      expect(saved!.id).toBe("s1");
    });

    it("clearUserState does not affect repository cache", async () => {
      await driver.put("repositories", makeRepo("r1"));
      await driver.put("savedRepositories", makeSavedRepo("s1", "r1"));

      await driver.clearUserState();

      const repo = await driver.get<CachedRepository>("repositories", "r1");
      expect(repo).toBeDefined();
      expect(repo!.id).toBe("r1");

      const saved = await driver.get<CachedSavedRepository>(
        "savedRepositories",
        "s1",
      );
      expect(saved).toBeUndefined();
    });

    it("getVersion returns current schema version", async () => {
      const version = await driver.getVersion();
      expect(version).toBeGreaterThanOrEqual(1);
    });

    it("reset wipes everything", async () => {
      await driver.put("repositories", makeRepo("r1"));
      await driver.put("savedRepositories", makeSavedRepo("s1", "r1"));

      await driver.reset();

      // After reset, re-open and migrate to verify clean state.
      await driver.open();
      await driver.migrate();

      const all = await driver.getAll("repositories");
      expect(all).toHaveLength(0);

      const saved = await driver.getAll("savedRepositories");
      expect(saved).toHaveLength(0);
    });
  });
}

// Run with InMemoryDriver.
runContractSuite("InMemoryDriver", () => new InMemoryDriver());

// Run with IndexedDBDriver (uses fake-indexeddb in test environment).
runContractSuite("IndexedDBDriver", () => {
  // Each test gets a unique DB name to avoid collisions.
  const uniqueName = `test-contract-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new IndexedDBDriver(uniqueName);
});
