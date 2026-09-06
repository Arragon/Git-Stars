// src/data/index.ts
// Singleton export for the client data layer.

import { LocalStore } from "./LocalStore";
import { IndexedDBDriver } from "./driver/IndexedDBDriver";

export { LocalStore } from "./LocalStore";
export { IndexedDBDriver } from "./driver/IndexedDBDriver";
export { InMemoryDriver } from "./driver/InMemoryDriver";
export { createFaultInjector } from "./driver/NetworkFaultDriver";
export type {
  FaultInjector,
  NetworkFaultConfig,
} from "./driver/NetworkFaultDriver";
export { createFakeClock } from "./driver/FakeClock";
export type { Clock } from "./driver/FakeClock";
export { createDeterministicIdGenerator } from "./driver/FakeIdGenerator";
export type { IdGenerator } from "./driver/FakeIdGenerator";
export { createTestClient, createClientPair } from "./driver/TestHarness";
export type { TestClient } from "./driver/TestHarness";
export * from "./types";
export * from "./migrations";
export * from "./cacheInvalidation";

/**
 * Production singleton. In tests, create a new LocalStore with InMemoryDriver instead.
 */
export const localStore = new LocalStore(
  new IndexedDBDriver("gitstars-client-cache"),
);
