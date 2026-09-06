// src/data/migrations.ts
// Client-side schema migrations (mirrors ADR-0003 ERD).
// Each migration is applied inside an IDB versionchange transaction.

import type { StoreName } from "./types";

export interface ClientMigration {
  version: number;
  description: string;
  up(db: IDBDatabase): void;
}

export const CLIENT_MIGRATIONS: ClientMigration[] = [
  {
    version: 1,
    description: "Initial schema — all 9 object stores with indexes",
    up(db: IDBDatabase) {
      // repositories: provider metadata cache (rebuildable)
      const repos = db.createObjectStore("repositories" as StoreName, {
        keyPath: "id",
      });
      repos.createIndex("canonicalKey", "canonicalKey", { unique: true });
      repos.createIndex(
        "identity",
        ["providerType", "host", "remoteId"] as unknown as string,
        { unique: true },
      );

      // savedRepositories: user-state replica (non-regenerable, ADR-0003 D4)
      const saved = db.createObjectStore("savedRepositories" as StoreName, {
        keyPath: "id",
      });
      saved.createIndex("repositoryId", "repositoryId", { unique: false });
      saved.createIndex("status", "status", { unique: false });

      // tags
      const tags = db.createObjectStore("tags" as StoreName, { keyPath: "id" });
      tags.createIndex("name", "name", { unique: true });

      // repositoryTags (join table)
      const repoTags = db.createObjectStore("repositoryTags" as StoreName, {
        keyPath: ["savedRepositoryId", "tagId"],
      });
      repoTags.createIndex("savedRepositoryId", "savedRepositoryId", {
        unique: false,
      });
      repoTags.createIndex("tagId", "tagId", { unique: false });

      // lists
      const lists = db.createObjectStore("lists" as StoreName, {
        keyPath: "id",
      });
      lists.createIndex("name", "name", { unique: false });

      // listItems
      const items = db.createObjectStore("listItems" as StoreName, {
        keyPath: "id",
      });
      items.createIndex("listPosition", ["listId", "position"] as unknown as string, {
        unique: false,
      });
      items.createIndex("savedRepositoryId", "savedRepositoryId", {
        unique: false,
      });

      // preferences (singleton)
      db.createObjectStore("preferences" as StoreName, { keyPath: "id" });

      // syncCursor (singleton)
      db.createObjectStore("syncCursor" as StoreName, { keyPath: "id" });

      // schemaMeta (tracks applied migration versions)
      db.createObjectStore("schemaMeta" as StoreName, { keyPath: "id" });
    },
  },
  {
    version: 2,
    description: "Add mutationQueue store for offline mutation queue (INH-414)",
    up(db: IDBDatabase) {
      const mq = db.createObjectStore("mutationQueue" as StoreName, {
        keyPath: "id",
      });
      mq.createIndex("createdAt", "createdAt", { unique: false });
      mq.createIndex("status", "status", { unique: false });
    },
  },
  {
    version: 3,
    description: "Add conflictLog store for sync conflict tracking (INH-419)",
    up(db: IDBDatabase) {
      const cl = db.createObjectStore("conflictLog" as StoreName, {
        keyPath: "id",
      });
      cl.createIndex("resolution", "resolution", { unique: false });
      cl.createIndex("entityType", "entityType", { unique: false });
    },
  },
];

/** Latest schema version after all migrations are applied. */
export const LATEST_SCHEMA_VERSION = CLIENT_MIGRATIONS.reduce(
  (max, m) => Math.max(max, m.version),
  0,
);
