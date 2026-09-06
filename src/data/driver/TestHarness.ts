// src/data/driver/TestHarness.ts
// Helper to create independent client replicas for multi-client testing.

import { LocalStore } from "../LocalStore";
import { InMemoryDriver } from "./InMemoryDriver";
import { createFakeClock, type Clock } from "./FakeClock";
import {
  createDeterministicIdGenerator,
  type IdGenerator,
} from "./FakeIdGenerator";
import { createFaultInjector, type FaultInjector } from "./NetworkFaultDriver";

export interface TestClient {
  /** Independent LocalStore backed by InMemoryDriver. */
  localStore: LocalStore;
  /** Deterministic fake clock. */
  clock: Clock;
  /** Deterministic ID generator. */
  idGenerator: IdGenerator;
  /** Network fault injector. */
  network: FaultInjector;
}

/**
 * Create a single test client with isolated stores and deterministic primitives.
 * @param name - Label for this client (used in seed derivation).
 * @param seed - Base seed; defaults to name.
 */
export function createTestClient(name: string, seed?: string): TestClient {
  const s = seed ?? name;
  return {
    localStore: new LocalStore(new InMemoryDriver()),
    clock: createFakeClock("2024-01-01T00:00:00.000Z"),
    idGenerator: createDeterministicIdGenerator(`${s}:id`),
    network: createFaultInjector(),
  };
}

/**
 * Create a pair of independent test clients (A and B) from the same base seed.
 * Each client has fully isolated storage, clocks, IDs, and network injectors.
 */
export function createClientPair(seed?: string): {
  clientA: TestClient;
  clientB: TestClient;
} {
  const base = seed ?? "pair";
  return {
    clientA: createTestClient("A", `${base}:A`),
    clientB: createTestClient("B", `${base}:B`),
  };
}
