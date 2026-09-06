// src/data/__tests__/isolation.test.ts
// Tests for cache/user-state isolation (ADR-0003 D4).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type {
  LocalStoreDriver,
  CachedRepository,
  CachedSavedRepository,
  CachedList,
} from "../types";
import { InMemoryDriver } from "../driver/InMemoryDriver";
import { IndexedDBDriver } from "../driver/IndexedDBDriver";

function makeRepo(id: string): CachedRepository {
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
  };
}

function makeSavedRepo(id: string, repoId: string): CachedSavedRepository {
  return {
    id,
    repositoryId: repoId,
    status: "saved",
    aiTags: ["test"],
    version: 1,
    etag: `etag-${id}`,
    addedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makeList(id: string): CachedList {
  return {
    id,
    name: `List ${id}`,
    description: "",
    version: 1,
    etag: `etag-${id}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function runIsolationSuite(
  driverName: string,
  createDriver: () => LocalStoreDriver,
) {
  describe(`isolation: ${driverName}`, () => {
    let driver: LocalStoreDriver;

    beforeEach(async () => {
      driver = createDriver();
      await driver.open();
      await driver.migrate();
    });

    afterEach(async () => {
      await driver.close();
    });

    it("clearRepositoryCache with saved repos → user-state unchanged", async () => {
      // Populate both cache and user-state.
      await driver.put("repositories", makeRepo("r1"));
      await driver.put("savedRepositories", makeSavedRepo("s1", "r1"));
      await driver.put("lists", makeList("l1"));

      // Clear only repository cache.
      await driver.clearRepositoryCache();

      // Repository cache is empty.
      const repos = await driver.getAll("repositories");
      expect(repos).toHaveLength(0);

      // User-state is preserved.
      const saved = await driver.getAll("savedRepositories");
      expect(saved).toHaveLength(1);
      expect((saved[0] as CachedSavedRepository).id).toBe("s1");

      const lists = await driver.getAll("lists");
      expect(lists).toHaveLength(1);
      expect((lists[0] as CachedList).id).toBe("l1");
    });

    it("clearUserState → repositories untouched", async () => {
      // Populate both cache and user-state.
      await driver.put("repositories", makeRepo("r1"));
      await driver.put("repositories", makeRepo("r2"));
      await driver.put("savedRepositories", makeSavedRepo("s1", "r1"));
      await driver.put("lists", makeList("l1"));

      // Clear only user-state.
      await driver.clearUserState();

      // Repository cache is untouched.
      const repos = await driver.getAll("repositories");
      expect(repos).toHaveLength(2);

      // User-state is cleared.
      const saved = await driver.getAll("savedRepositories");
      expect(saved).toHaveLength(0);

      const lists = await driver.getAll("lists");
      expect(lists).toHaveLength(0);
    });

    it("preferences and syncCursor are cleared by clearUserState", async () => {
      await driver.put("preferences", {
        id: "singleton",
        data: { theme: "dark" },
        version: 1,
        etag: "pref-etag",
        updatedAt: new Date().toISOString(),
      });
      await driver.put("syncCursor", {
        id: "default",
        lastSeq: 42,
        protocolVersion: 1,
        lastSyncedAt: new Date().toISOString(),
      });

      await driver.clearUserState();

      const prefs = await driver.get("preferences", "singleton");
      expect(prefs).toBeUndefined();

      const cursor = await driver.get("syncCursor", "default");
      expect(cursor).toBeUndefined();
    });
  });
}

runIsolationSuite("InMemoryDriver", () => new InMemoryDriver());

runIsolationSuite("IndexedDBDriver", () => {
  const uniqueName = `test-isolation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new IndexedDBDriver(uniqueName);
});
