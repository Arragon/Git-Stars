// src/sync/mutationQueue.ts
// Durable offline mutation queue (INH-414).
// Persists mutations through app crash/restart via the client data driver.

import type { LocalStoreDriver, QueuedMutation } from "../data/types";
import { getAccountScope, isVisibleToScope } from "./accountScope";

export interface MutationQueue {
  enqueue(
    mutation: Omit<
      QueuedMutation,
      "id" | "createdAt" | "retryCount" | "status"
    >,
  ): Promise<string>;
  getPending(): Promise<QueuedMutation[]>;
  /** Every queued mutation, including quarantined ones (sign-out guard, M7-03). */
  getAll(): Promise<QueuedMutation[]>;
  countAll(): Promise<{ pending: number; quarantined: number; total: number }>;
  complete(id: string): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
  quarantine(id: string, reason: string): Promise<void>;
  updateMutation(
    id: string,
    updates: Partial<Pick<QueuedMutation, "payload" | "baseVersion">>,
  ): Promise<void>;
  clear(): Promise<void>;
}

const MAX_RETRY_COUNT = 3;

export function createMutationQueue(
  driver: LocalStoreDriver,
  getOwnerId: () => string | null = getAccountScope,
): MutationQueue {
  // Legacy entries (pre-M8-X) have no owner: the first signed-in scope claims them so an
  // upgrade never strands pending work, and later accounts cannot see them.
  async function claimUnowned(ownerId: string): Promise<void> {
    const all = await driver.getAll<QueuedMutation>("mutationQueue");
    for (const mutation of all) {
      if (!mutation.ownerId) {
        await driver.put<QueuedMutation>("mutationQueue", {
          ...mutation,
          ownerId,
        });
      }
    }
  }

  async function scopedAll(): Promise<QueuedMutation[]> {
    const owner = getOwnerId();
    if (owner) await claimUnowned(owner);
    const all = await driver.getAll<QueuedMutation>("mutationQueue");
    return all.filter((m) => isVisibleToScope(m.ownerId, owner));
  }

  async function enqueue(
    partial: Omit<QueuedMutation, "id" | "createdAt" | "retryCount" | "status">,
  ): Promise<string> {
    const id = globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : String(Math.random());

    const ownerId = getOwnerId() ?? undefined;
    const mutation: QueuedMutation = {
      ...partial,
      id,
      createdAt: new Date().toISOString(),
      retryCount: 0,
      status: "pending",
      ...(ownerId ? { ownerId } : {}),
    };

    await driver.put("mutationQueue", mutation);
    return id;
  }

  async function getPending(): Promise<QueuedMutation[]> {
    const all = await scopedAll();
    return all
      .filter((m) => m.status !== "quarantined")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async function getAll(): Promise<QueuedMutation[]> {
    const all = await scopedAll();
    return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async function countAll(): Promise<{
    pending: number;
    quarantined: number;
    total: number;
  }> {
    const all = await scopedAll();
    const quarantined = all.filter((m) => m.status === "quarantined").length;
    return {
      pending: all.length - quarantined,
      quarantined,
      total: all.length,
    };
  }

  async function complete(id: string): Promise<void> {
    await driver.delete("mutationQueue", id);
  }

  async function markFailed(id: string, error: string): Promise<void> {
    const existing = await driver.get<QueuedMutation>("mutationQueue", id);
    if (!existing) return;

    const retryCount = existing.retryCount + 1;
    const status: QueuedMutation["status"] =
      retryCount >= MAX_RETRY_COUNT ? "quarantined" : "retrying";

    await driver.put<QueuedMutation>("mutationQueue", {
      ...existing,
      retryCount,
      lastError: error,
      status,
    });
  }

  async function quarantine(id: string, reason: string): Promise<void> {
    const existing = await driver.get<QueuedMutation>("mutationQueue", id);
    if (!existing) return;

    await driver.put<QueuedMutation>("mutationQueue", {
      ...existing,
      status: "quarantined",
      lastError: reason,
    });
  }

  async function updateMutation(
    id: string,
    updates: Partial<Pick<QueuedMutation, "payload" | "baseVersion">>,
  ): Promise<void> {
    const existing = await driver.get<QueuedMutation>("mutationQueue", id);
    if (!existing) return;

    await driver.put<QueuedMutation>("mutationQueue", {
      ...existing,
      ...updates,
      status: "pending",
      retryCount: 0,
      lastError: undefined,
    });
  }

  async function clear(): Promise<void> {
    // Get all and delete individually (driver doesn't expose store.clear directly).
    const all = await driver.getAll<QueuedMutation>("mutationQueue");
    for (const m of all) {
      await driver.delete("mutationQueue", m.id);
    }
  }

  return {
    enqueue,
    getPending,
    getAll,
    countAll,
    complete,
    markFailed,
    quarantine,
    updateMutation,
    clear,
  };
}

export { MAX_RETRY_COUNT };
