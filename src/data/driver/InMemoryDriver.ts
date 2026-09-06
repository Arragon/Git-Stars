// src/data/driver/InMemoryDriver.ts
// In-memory implementation of LocalStoreDriver for tests.

import type { LocalStoreDriver, StoreName, TransactionContext } from "../types";
import { LATEST_SCHEMA_VERSION } from "../migrations";

type Key = string | number;

function toKeyString(key: IDBValidKey): string {
  return String(key);
}

export class InMemoryDriver implements LocalStoreDriver {
  private stores: Map<StoreName, Map<string, unknown>> = new Map();
  private schemaVersion = 0;
  private isOpen = false;

  async open(): Promise<void> {
    if (this.isOpen) return;
    this.isOpen = true;
    // Initialize all stores on open.
    const allStores: StoreName[] = [
      "repositories",
      "savedRepositories",
      "tags",
      "repositoryTags",
      "lists",
      "listItems",
      "preferences",
      "syncCursor",
      "mutationQueue",
      "conflictLog",
      "schemaMeta",
    ];
    for (const s of allStores) {
      if (!this.stores.has(s)) {
        this.stores.set(s, new Map());
      }
    }
  }

  async close(): Promise<void> {
    this.isOpen = false;
  }

  async reset(): Promise<void> {
    for (const store of this.stores.values()) {
      store.clear();
    }
    this.schemaVersion = 0;
  }

  async getVersion(): Promise<number> {
    return this.schemaVersion;
  }

  async migrate(): Promise<{ applied: number[] }> {
    const applied: number[] = [];
    // In-memory driver: just bump version to latest.
    if (this.schemaVersion < LATEST_SCHEMA_VERSION) {
      for (let v = this.schemaVersion + 1; v <= LATEST_SCHEMA_VERSION; v++) {
        applied.push(v);
      }
      this.schemaVersion = LATEST_SCHEMA_VERSION;
    }
    return { applied };
  }

  async get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
    const s = this.stores.get(store);
    if (!s) return undefined;
    return s.get(toKeyString(key)) as T | undefined;
  }

  async getAll<T>(store: StoreName, _query?: IDBKeyRange | null): Promise<T[]> {
    const s = this.stores.get(store);
    if (!s) return [];
    return Array.from(s.values()) as T[];
  }

  async put<T>(store: StoreName, value: T): Promise<void> {
    let s = this.stores.get(store);
    if (!s) {
      s = new Map();
      this.stores.set(store, s);
    }
    const key = this.extractKey(store, value);
    s.set(toKeyString(key), value);
  }

  async delete(store: StoreName, key: IDBValidKey): Promise<void> {
    const s = this.stores.get(store);
    if (!s) return;
    s.delete(toKeyString(key));
  }

  async transaction<T>(
    storeNames: StoreName[],
    _mode: "readonly" | "readwrite",
    fn: (tx: TransactionContext) => Promise<T>,
  ): Promise<T> {
    // Snapshot current state for rollback on error.
    const snapshot = new Map<StoreName, Map<string, unknown>>();
    for (const name of storeNames) {
      const s = this.stores.get(name);
      snapshot.set(name, s ? new Map(s) : new Map());
    }

    const ctx: TransactionContext = {
      get: <U>(store: StoreName, key: IDBValidKey) => this.get<U>(store, key),
      getAll: <U>(store: StoreName, query?: IDBKeyRange | null) =>
        this.getAll<U>(store, query),
      put: <U>(store: StoreName, value: U) => {
        void this.put(store, value);
      },
      delete: (store: StoreName, key: IDBValidKey) => {
        void this.delete(store, key);
      },
    };

    try {
      return await fn(ctx);
    } catch (err) {
      // Rollback: restore snapshot.
      for (const [name, data] of snapshot) {
        this.stores.set(name, data);
      }
      throw err;
    }
  }

  async clearRepositoryCache(): Promise<void> {
    const s = this.stores.get("repositories");
    if (s) s.clear();
  }

  async clearUserState(): Promise<void> {
    const stores: StoreName[] = [
      "savedRepositories",
      "tags",
      "repositoryTags",
      "lists",
      "listItems",
      "preferences",
      "syncCursor",
      "mutationQueue",
    ];
    for (const name of stores) {
      const s = this.stores.get(name);
      if (s) s.clear();
    }
  }

  // Extract keyPath value from stored object.
  private extractKey(store: StoreName, value: unknown): Key {
    const obj = value as Record<string, unknown>;
    switch (store) {
      case "repositories":
      case "savedRepositories":
      case "tags":
      case "lists":
      case "listItems":
      case "preferences":
      case "syncCursor":
      case "mutationQueue":
      case "conflictLog":
      case "schemaMeta":
        return obj.id as Key;
      case "repositoryTags":
        // Compound key: [savedRepositoryId, tagId]
        return `${obj.savedRepositoryId}:${obj.tagId}`;
      default:
        return obj.id as Key;
    }
  }
}
