// src/data/types.ts
// Client-side cached entity interfaces mirroring server DTOs (ADR-0003).
// All timestamps are ISO-8601 strings. IDs are UUIDs.

// --- Cached entities ---

export interface CachedRepository {
  id: string;
  providerType: string;
  host: string;
  remoteId: string;
  canonicalKey: string;
  namespacePath?: string;
  name: string;
  webUrl: string;
  description?: string;
  visibility?: string;
  primaryLanguage?: string;
  starsCount: number;
  forksCount: number;
  status: string;
  providerCreatedAt?: string;
  providerUpdatedAt?: string;
  metadataFetchedAt?: string;
  cachedAt: string;
}

export interface CachedSavedRepository {
  id: string;
  repositoryId: string;
  status: string;
  note?: string;
  aiTags: string[];
  version: number;
  etag: string;
  addedAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface CachedTag {
  id: string;
  name: string;
  createdAt: string;
}

export interface CachedRepositoryTag {
  tagId: string;
  savedRepositoryId: string;
  createdAt: string;
}

export interface CachedList {
  id: string;
  name: string;
  description: string;
  version: number;
  etag: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface CachedListItem {
  id: string;
  listId: string;
  savedRepositoryId: string;
  position: string;
  note?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CachedPreferences {
  id: "singleton";
  data: Record<string, unknown>;
  version: number;
  etag: string;
  updatedAt: string;
}

export interface SyncCursor {
  id: "default";
  lastSeq: number;
  protocolVersion: number;
  lastSyncedAt?: string;
}

// --- Mutation queue (INH-414) ---

export type MutationEntity =
  | "saved_repository"
  | "list"
  | "list_item"
  | "tag"
  | "repository_tag"
  | "preference";

export type MutationOperation = "create" | "update" | "delete";

export type MutationStatus = "pending" | "retrying" | "quarantined";

export interface QueuedMutation {
  id: string; // UUID, also used as Idempotency-Key
  entity: MutationEntity;
  operation: MutationOperation;
  entityId: string;
  baseVersion: number; // etag version at time of mutation
  payload: unknown;
  createdAt: string; // ISO-8601, ordering key
  retryCount: number;
  lastError?: string;
  status: MutationStatus;
}

// --- Store names ---

export type StoreName =
  | "repositories"
  | "savedRepositories"
  | "tags"
  | "repositoryTags"
  | "lists"
  | "listItems"
  | "preferences"
  | "syncCursor"
  | "mutationQueue"
  | "conflictLog"
  | "schemaMeta";

// --- Driver contract ---

export interface TransactionContext {
  get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined>;
  getAll<T>(store: StoreName, query?: IDBKeyRange | null): Promise<T[]>;
  put<T>(store: StoreName, value: T): void;
  delete(store: StoreName, key: IDBValidKey): void;
}

export interface LocalStoreDriver {
  open(): Promise<void>;
  close(): Promise<void>;
  reset(): Promise<void>;
  getVersion(): Promise<number>;
  migrate(): Promise<{ applied: number[] }>;
  get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined>;
  getAll<T>(store: StoreName, query?: IDBKeyRange | null): Promise<T[]>;
  put<T>(store: StoreName, value: T): Promise<void>;
  delete(store: StoreName, key: IDBValidKey): Promise<void>;
  transaction<T>(
    storeNames: StoreName[],
    mode: "readonly" | "readwrite",
    fn: (tx: TransactionContext) => Promise<T>,
  ): Promise<T>;
  clearRepositoryCache(): Promise<void>;
  clearUserState(): Promise<void>;
}

// --- Error classes ---

export class UnsupportedVersionError extends Error {
  constructor(public foundVersion: number, public latestVersion: number) {
    super(
      `Found schema version ${foundVersion} is newer than supported ${latestVersion}. ` +
        `Please upgrade the app or reset the local cache.`,
    );
    this.name = "UnsupportedVersionError";
  }
}

export class CorruptSchemaError extends Error {
  constructor(message: string) {
    super(`Local cache schema is corrupt: ${message}`);
    this.name = "CorruptSchemaError";
  }
}
