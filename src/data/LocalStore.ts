// src/data/LocalStore.ts
// Thin facade over LocalStoreDriver with typed convenience methods.

import type {
  LocalStoreDriver,
  StoreName,
  TransactionContext,
  CachedRepository,
  CachedSavedRepository,
  CachedTag,
  CachedRepositoryTag,
  CachedList,
  CachedListItem,
  CachedPreferences,
  SyncCursor,
} from "./types";

export class LocalStore {
  constructor(private driver: LocalStoreDriver) {}

  // Lifecycle
  open() {
    return this.driver.open();
  }
  close() {
    return this.driver.close();
  }
  reset() {
    return this.driver.reset();
  }
  getVersion() {
    return this.driver.getVersion();
  }
  migrate() {
    return this.driver.migrate();
  }

  // Raw driver access (primary API)
  get<T>(store: StoreName, key: IDBValidKey) {
    return this.driver.get<T>(store, key);
  }
  getAll<T>(store: StoreName, query?: IDBKeyRange | null) {
    return this.driver.getAll<T>(store, query);
  }
  put<T>(store: StoreName, value: T) {
    return this.driver.put(store, value);
  }
  delete(store: StoreName, key: IDBValidKey) {
    return this.driver.delete(store, key);
  }
  transaction<T>(
    storeNames: StoreName[],
    mode: "readonly" | "readwrite",
    fn: (tx: TransactionContext) => Promise<T>,
  ) {
    return this.driver.transaction(storeNames, mode, fn);
  }

  // Typed convenience methods
  getRepositories() {
    return this.driver.getAll<CachedRepository>("repositories");
  }
  putRepository(r: CachedRepository) {
    return this.driver.put("repositories", r);
  }
  getRepository(id: string) {
    return this.driver.get<CachedRepository>("repositories", id);
  }
  deleteRepository(id: string) {
    return this.driver.delete("repositories", id);
  }

  getSavedRepositories() {
    return this.driver.getAll<CachedSavedRepository>("savedRepositories");
  }
  putSavedRepository(sr: CachedSavedRepository) {
    return this.driver.put("savedRepositories", sr);
  }
  getSavedRepository(id: string) {
    return this.driver.get<CachedSavedRepository>("savedRepositories", id);
  }

  getTags() {
    return this.driver.getAll<CachedTag>("tags");
  }
  putTag(t: CachedTag) {
    return this.driver.put("tags", t);
  }

  getRepositoryTags() {
    return this.driver.getAll<CachedRepositoryTag>("repositoryTags");
  }
  putRepositoryTag(rt: CachedRepositoryTag) {
    return this.driver.put("repositoryTags", rt);
  }

  getLists() {
    return this.driver.getAll<CachedList>("lists");
  }
  putList(l: CachedList) {
    return this.driver.put("lists", l);
  }
  getList(id: string) {
    return this.driver.get<CachedList>("lists", id);
  }

  getListItems() {
    return this.driver.getAll<CachedListItem>("listItems");
  }
  putListItem(li: CachedListItem) {
    return this.driver.put("listItems", li);
  }

  getPreferences() {
    return this.driver.get<CachedPreferences>("preferences", "singleton");
  }
  putPreferences(p: CachedPreferences) {
    return this.driver.put("preferences", p);
  }

  getSyncCursor() {
    return this.driver.get<SyncCursor>("syncCursor", "default");
  }
  putSyncCursor(c: SyncCursor) {
    return this.driver.put("syncCursor", c);
  }

  // Cache management
  clearRepositoryCache() {
    return this.driver.clearRepositoryCache();
  }
  clearUserState() {
    return this.driver.clearUserState();
  }
}
