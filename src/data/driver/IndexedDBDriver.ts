// src/data/driver/IndexedDBDriver.ts
// Production IndexedDB implementation of LocalStoreDriver.

import type {
  LocalStoreDriver,
  StoreName,
  TransactionContext,
} from "../types";
import {
  CorruptSchemaError,
  UnsupportedVersionError,
} from "../types";
import { CLIENT_MIGRATIONS, LATEST_SCHEMA_VERSION } from "../migrations";

interface SchemaMetaRow {
  id: string;
  version: number;
  appliedAt: string;
}

export class IndexedDBDriver implements LocalStoreDriver {
  private db: IDBDatabase | null = null;
  private dbName: string;

  constructor(dbName: string) {
    this.dbName = dbName;
  }

  async open(): Promise<void> {
    if (this.db) return;

    // Compute the IDB version number = latest migration version.
    // IDB uses a monotonically increasing version integer.
    const idbVersion = LATEST_SCHEMA_VERSION;

    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(this.dbName, idbVersion);

      request.onupgradeneeded = (event) => {
        // This fires when DB is new or version changed.
        const db = request.result;
        const oldVersion = event.oldVersion;

        // Run migrations that are newer than the existing schema.
        for (const migration of CLIENT_MIGRATIONS) {
          if (migration.version > oldVersion) {
            migration.up(db);
          }
        }
      };

      request.onsuccess = () => {
        this.db = request.result;

        // Handle another tab triggering a versionchange — close gracefully.
        this.db.onversionchange = () => {
          this.db?.close();
          this.db = null;
        };

        resolve();
      };

      request.onerror = () => {
        reject(new Error(`Failed to open IndexedDB: ${request.error?.message}`));
      };

      request.onblocked = () => {
        reject(
          new Error(
            `IndexedDB "${this.dbName}" is blocked by another open connection.`,
          ),
        );
      };
    });
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = null;
  }

  async reset(): Promise<void> {
    if (!this.db) throw new Error("Database not open. Call open() first.");

    return new Promise<void>((resolve, reject) => {
      this.db!.close();
      this.db = null;

      const request = indexedDB.deleteDatabase(this.dbName);
      request.onsuccess = () => {
        // Re-open with the same version to recreate schema.
        void this.open().then(() => resolve(), reject);
      };
      request.onerror = () =>
        reject(new Error(`Failed to reset database: ${request.error?.message}`));
      request.onblocked = () =>
        reject(new Error("Reset blocked by another connection."));
    });
  }

  async getVersion(): Promise<number> {
    if (!this.db) throw new Error("Database not open.");

    const meta = await this.get<SchemaMetaRow>("schemaMeta", "current");
    if (!meta) return 0;
    return meta.version;
  }

  async migrate(): Promise<{ applied: number[] }> {
    if (!this.db) throw new Error("Database not open.");

    const currentVersion = await this.getVersion();

    if (currentVersion > LATEST_SCHEMA_VERSION) {
      throw new UnsupportedVersionError(currentVersion, LATEST_SCHEMA_VERSION);
    }

    if (currentVersion < 0) {
      throw new CorruptSchemaError(
        `Invalid schema version: ${currentVersion}`,
      );
    }

    const pending = CLIENT_MIGRATIONS.filter((m) => m.version > currentVersion);
    const applied: number[] = [];

    if (pending.length === 0) return { applied };

    // All pending migrations are already applied via onupgradeneeded during open().
    // We just need to update schemaMeta to reflect the current state.
    for (const migration of pending) {
      await this.put<SchemaMetaRow>("schemaMeta", {
        id: "current",
        version: migration.version,
        appliedAt: new Date().toISOString(),
      });
      applied.push(migration.version);
    }

    return { applied };
  }

  async get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
    if (!this.db) throw new Error("Database not open.");

    return new Promise<T | undefined>((resolve, reject) => {
      const tx = this.db!.transaction(store, "readonly");
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  }

  async getAll<T>(
    store: StoreName,
    query?: IDBKeyRange | null,
  ): Promise<T[]> {
    if (!this.db) throw new Error("Database not open.");

    return new Promise<T[]>((resolve, reject) => {
      const tx = this.db!.transaction(store, "readonly");
      const req = tx.objectStore(store).getAll(query ?? null);
      req.onsuccess = () => resolve(req.result as T[]);
      req.onerror = () => reject(req.error);
    });
  }

  async put<T>(store: StoreName, value: T): Promise<void> {
    if (!this.db) throw new Error("Database not open.");

    return new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction(store, "readwrite");
      tx.objectStore(store).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async delete(store: StoreName, key: IDBValidKey): Promise<void> {
    if (!this.db) throw new Error("Database not open.");

    return new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction(store, "readwrite");
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async transaction<T>(
    storeNames: StoreName[],
    mode: "readonly" | "readwrite",
    fn: (tx: TransactionContext) => Promise<T>,
  ): Promise<T> {
    if (!this.db) throw new Error("Database not open.");

    return new Promise<T>((resolve, reject) => {
      const idbTx = this.db!.transaction(storeNames, mode);
      let result: T;
      let fnError: unknown;

      const ctx: TransactionContext = {
        get<U>(store: StoreName, key: IDBValidKey): Promise<U | undefined> {
          return new Promise<U | undefined>((res, rej) => {
            const req = idbTx.objectStore(store).get(key);
            req.onsuccess = () => res(req.result as U | undefined);
            req.onerror = () => rej(req.error);
          });
        },
        getAll<U>(
          store: StoreName,
          query?: IDBKeyRange | null,
        ): Promise<U[]> {
          return new Promise<U[]>((res, rej) => {
            const req = idbTx.objectStore(store).getAll(query ?? null);
            req.onsuccess = () => res(req.result as U[]);
            req.onerror = () => rej(req.error);
          });
        },
        put<U>(store: StoreName, value: U): void {
          idbTx.objectStore(store).put(value);
        },
        delete(store: StoreName, key: IDBValidKey): void {
          idbTx.objectStore(store).delete(key);
        },
      };

      fn(ctx)
        .then((r) => {
          result = r;
        })
        .catch((err) => {
          fnError = err;
          idbTx.abort();
        });

      idbTx.oncomplete = () => {
        if (fnError !== undefined) reject(fnError);
        else resolve(result);
      };
      idbTx.onerror = () => reject(idbTx.error);
      idbTx.onabort = () => reject(idbTx.error ?? new Error("Transaction aborted"));
    });
  }

  async clearRepositoryCache(): Promise<void> {
    if (!this.db) throw new Error("Database not open.");

    return new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction("repositories", "readwrite");
      tx.objectStore("repositories").clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async clearUserState(): Promise<void> {
    if (!this.db) throw new Error("Database not open.");

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

    return new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction(stores, "readwrite");
      for (const store of stores) {
        tx.objectStore(store).clear();
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}
