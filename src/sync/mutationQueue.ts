// src/sync/mutationQueue.ts
// Durable offline mutation queue (INH-414).
// Persists mutations through app crash/restart via the client data driver.

import type { LocalStoreDriver, QueuedMutation } from "../data/types";

export interface MutationQueue {
  enqueue(
    mutation: Omit<
      QueuedMutation,
      "id" | "createdAt" | "retryCount" | "status"
    >,
  ): Promise<string>;
  getPending(): Promise<QueuedMutation[]>;
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

export function createMutationQueue(driver: LocalStoreDriver): MutationQueue {
  async function enqueue(
    partial: Omit<QueuedMutation, "id" | "createdAt" | "retryCount" | "status">,
  ): Promise<string> {
    const id = globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : String(Math.random());

    const mutation: QueuedMutation = {
      ...partial,
      id,
      createdAt: new Date().toISOString(),
      retryCount: 0,
      status: "pending",
    };

    await driver.put("mutationQueue", mutation);
    return id;
  }

  async function getPending(): Promise<QueuedMutation[]> {
    const all = await driver.getAll<QueuedMutation>("mutationQueue");
    return all
      .filter((m) => m.status !== "quarantined")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
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
    complete,
    markFailed,
    quarantine,
    updateMutation,
    clear,
  };
}

export { MAX_RETRY_COUNT };
