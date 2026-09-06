// src/sync/conflictLog.ts
// Durable conflict log for tracking sync conflicts and their resolutions (INH-419).
// Stored in IndexedDB as part of the client data layer.

import type { LocalStoreDriver } from "../data/types";

export interface ConflictRecord {
  id: string;
  entityType: string;
  entityId: string;
  operation: string;
  baseVersion: number;
  serverVersion: number;
  localPayload: unknown;
  serverSnapshot: unknown;
  resolution: "pending" | "auto_resolved" | "user_resolved" | "discarded";
  resolvedPayload?: unknown;
  createdAt: string;
  resolvedAt?: string;
}

export interface ConflictLog {
  record(
    conflict: Omit<ConflictRecord, "id" | "createdAt" | "resolution">,
  ): Promise<string>;
  getUnresolved(): Promise<ConflictRecord[]>;
  markResolved(id: string, resolvedPayload?: unknown): Promise<void>;
  discard(id: string): Promise<void>;
  getAll(): Promise<ConflictRecord[]>;
}

export function createConflictLog(driver: LocalStoreDriver): ConflictLog {
  async function record(
    conflict: Omit<ConflictRecord, "id" | "createdAt" | "resolution">,
  ): Promise<string> {
    const id = globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : String(Math.random());

    const record: ConflictRecord = {
      ...conflict,
      id,
      createdAt: new Date().toISOString(),
      resolution: "pending",
    };

    await driver.put("conflictLog", record);
    return id;
  }

  async function getUnresolved(): Promise<ConflictRecord[]> {
    const all = await driver.getAll<ConflictRecord>("conflictLog");
    return all.filter((r) => r.resolution === "pending");
  }

  async function markResolved(
    id: string,
    resolvedPayload?: unknown,
  ): Promise<void> {
    const existing = await driver.get<ConflictRecord>("conflictLog", id);
    if (!existing) return;

    await driver.put<ConflictRecord>("conflictLog", {
      ...existing,
      resolution: "auto_resolved",
      resolvedPayload,
      resolvedAt: new Date().toISOString(),
    });
  }

  async function discard(id: string): Promise<void> {
    const existing = await driver.get<ConflictRecord>("conflictLog", id);
    if (!existing) return;

    await driver.put<ConflictRecord>("conflictLog", {
      ...existing,
      resolution: "discarded",
      resolvedAt: new Date().toISOString(),
    });
  }

  async function getAll(): Promise<ConflictRecord[]> {
    return driver.getAll<ConflictRecord>("conflictLog");
  }

  return {
    record,
    getUnresolved,
    markResolved,
    discard,
    getAll,
  };
}
