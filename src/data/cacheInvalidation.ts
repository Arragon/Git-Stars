// src/data/cacheInvalidation.ts
// Repository cache invalidation helpers.

import type { LocalStoreDriver, CachedRepository } from "./types";

const DEFAULT_MAX_AGE_MS = 1000 * 60 * 60; // 1 hour

/**
 * Invalidate a single repository from the cache.
 */
export async function invalidateRepository(
  driver: LocalStoreDriver,
  id: string,
): Promise<void> {
  await driver.delete("repositories", id);
}

/**
 * Invalidate all repositories from the cache.
 */
export async function invalidateAllRepositories(
  driver: LocalStoreDriver,
): Promise<void> {
  await driver.clearRepositoryCache();
}

/**
 * Check whether a cached repository entry is stale.
 * Returns true if the entry does not exist or its cachedAt is older than maxAgeMs.
 */
export async function isStale(
  driver: LocalStoreDriver,
  id: string,
  maxAgeMs: number = DEFAULT_MAX_AGE_MS,
): Promise<boolean> {
  const repo = await driver.get<CachedRepository>("repositories", id);
  if (!repo) return true;

  const cachedAt = new Date(repo.cachedAt).getTime();
  if (Number.isNaN(cachedAt)) return true;

  return Date.now() - cachedAt > maxAgeMs;
}
