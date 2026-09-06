// src/data/__tests__/harness.test.ts
// Verify createTestClient / createClientPair produce independent replicas.

import { describe, it, expect, beforeEach } from "vitest";
import {
  createTestClient,
  createClientPair,
  type TestClient,
} from "../driver/TestHarness";
import type { CachedRepository } from "../types";

function makeRepo(id: string): CachedRepository {
  return {
    id,
    providerType: "github",
    host: "github.com",
    remoteId: `remote-${id}`,
    canonicalKey: `github.com/${id}`,
    name: id,
    webUrl: `https://github.com/test/${id}`,
    starsCount: 0,
    forksCount: 0,
    status: "active",
    cachedAt: "2024-01-01T00:00:00.000Z",
  };
}

describe("TestHarness", () => {
  let client: TestClient;

  beforeEach(async () => {
    client = createTestClient("test");
    await client.localStore.open();
    await client.localStore.migrate();
  });

  describe("createTestClient", () => {
    it("provides a working LocalStore", async () => {
      await client.localStore.putRepository(makeRepo("r1"));
      const repo = await client.localStore.getRepository("r1");
      expect(repo).toBeDefined();
      expect(repo!.id).toBe("r1");
    });

    it("provides a deterministic clock starting at 2024-01-01", () => {
      expect(client.clock.now()).toBe("2024-01-01T00:00:00.000Z");
      client.clock.advance(1000);
      expect(client.clock.now()).toBe("2024-01-01T00:00:01.000Z");
    });

    it("provides a deterministic ID generator", () => {
      const id1 = client.idGenerator.uuid();
      const id2 = client.idGenerator.uuid();
      expect(id1).not.toBe(id2);
      // Same seed → same first ID
      const other = createTestClient("test");
      expect(other.idGenerator.uuid()).toBe(id1);
    });

    it("provides a network fault injector", async () => {
      client.network.configure({ offline: true });
      const wrapped = client.network.wrapFetch(
        async () => new Response("ok"),
      );
      await expect(wrapped("/test")).rejects.toThrow();
    });
  });

  describe("createClientPair", () => {
    it("produces two fully independent clients", async () => {
      const { clientA, clientB } = createClientPair("isolation");
      await clientA.localStore.open();
      await clientA.localStore.migrate();
      await clientB.localStore.open();
      await clientB.localStore.migrate();

      // Write to A only
      await clientA.localStore.putRepository(makeRepo("only-in-a"));

      const inA = await clientA.localStore.getRepository("only-in-a");
      const inB = await clientB.localStore.getRepository("only-in-a");

      expect(inA).toBeDefined();
      expect(inB).toBeUndefined();
    });

    it("clients have independent clocks", () => {
      const { clientA, clientB } = createClientPair("clocks");

      clientA.clock.advance(5000);

      expect(clientA.clock.now()).toBe("2024-01-01T00:00:05.000Z");
      expect(clientB.clock.now()).toBe("2024-01-01T00:00:00.000Z");
    });

    it("clients have independent ID generators", () => {
      const { clientA, clientB } = createClientPair("ids");

      const idA = clientA.idGenerator.uuid();
      const idB = clientB.idGenerator.uuid();

      // Different seeds → different IDs
      expect(idA).not.toBe(idB);
    });

    it("clients have independent network injectors", async () => {
      const { clientA, clientB } = createClientPair("network");

      clientA.network.configure({ offline: true });

      const wrappedA = clientA.network.wrapFetch(
        async () => new Response("ok"),
      );
      const wrappedB = clientB.network.wrapFetch(
        async () => new Response("ok"),
      );

      await expect(wrappedA("/test")).rejects.toThrow();
      const res = await wrappedB("/test");
      expect(res.status).toBe(200);
    });

    it("same seed → reproducible clients", () => {
      const pair1 = createClientPair("repro");
      const pair2 = createClientPair("repro");

      // Same seed → same ID sequences
      expect(pair1.clientA.idGenerator.uuid()).toBe(
        pair2.clientA.idGenerator.uuid(),
      );
      expect(pair1.clientB.idGenerator.uuid()).toBe(
        pair2.clientB.idGenerator.uuid(),
      );

      // Same clock start
      expect(pair1.clientA.clock.now()).toBe(pair2.clientA.clock.now());
      expect(pair1.clientB.clock.now()).toBe(pair2.clientB.clock.now());
    });
  });
});
