// src/sync/__tests__/mutationQueue.test.ts
// Tests for the durable offline mutation queue (INH-414).

import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryDriver } from "../../data/driver/InMemoryDriver";
import { createMutationQueue, MAX_RETRY_COUNT } from "../mutationQueue";
import type { MutationQueue } from "../mutationQueue";
import type { QueuedMutation } from "../../data/types";

describe("MutationQueue", () => {
  let driver: InMemoryDriver;
  let queue: MutationQueue;

  beforeEach(async () => {
    driver = new InMemoryDriver();
    await driver.open();
    await driver.migrate();
    queue = createMutationQueue(driver);
  });

  const baseMutation = {
    entity: "saved_repository" as const,
    operation: "update" as const,
    entityId: "sr-1",
    baseVersion: 1,
    payload: { note: "test note" },
  };

  describe("enqueue → getPending", () => {
    it("returns mutations in creation order", async () => {
      const id1 = await queue.enqueue({ ...baseMutation, entityId: "sr-1" });
      // Small delay to ensure different timestamps.
      await new Promise((r) => setTimeout(r, 2));
      const id2 = await queue.enqueue({ ...baseMutation, entityId: "sr-2" });

      const pending = await queue.getPending();
      expect(pending).toHaveLength(2);
      expect(pending[0].id).toBe(id1);
      expect(pending[1].id).toBe(id2);
      expect(pending[0].status).toBe("pending");
      expect(pending[0].retryCount).toBe(0);
    });

    it("excludes quarantined mutations from getPending", async () => {
      const id1 = await queue.enqueue(baseMutation);
      const id2 = await queue.enqueue({ ...baseMutation, entityId: "sr-2" });

      await queue.quarantine(id1, "test quarantine");

      const pending = await queue.getPending();
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe(id2);
    });
  });

  describe("complete", () => {
    it("removes mutation from queue", async () => {
      const id = await queue.enqueue(baseMutation);
      expect(await queue.getPending()).toHaveLength(1);

      await queue.complete(id);
      expect(await queue.getPending()).toHaveLength(0);
    });
  });

  describe("markFailed", () => {
    it("increments retry count and sets status to retrying", async () => {
      const id = await queue.enqueue(baseMutation);

      await queue.markFailed(id, "conflict");

      const all = await driver.getAll<QueuedMutation>("mutationQueue");
      const m = all.find((x) => x.id === id);
      expect(m?.retryCount).toBe(1);
      expect(m?.status).toBe("retrying");
      expect(m?.lastError).toBe("conflict");
    });

    it("quarantines after MAX_RETRY_COUNT failures", async () => {
      const id = await queue.enqueue(baseMutation);

      for (let i = 0; i < MAX_RETRY_COUNT; i++) {
        await queue.markFailed(id, `fail-${i}`);
      }

      const all = await driver.getAll<QueuedMutation>("mutationQueue");
      const m = all.find((x) => x.id === id);
      expect(m?.status).toBe("quarantined");
      expect(m?.retryCount).toBe(MAX_RETRY_COUNT);
    });
  });

  describe("quarantine", () => {
    it("prevents further retry", async () => {
      const id = await queue.enqueue(baseMutation);
      await queue.quarantine(id, "permanent failure");

      const pending = await queue.getPending();
      expect(pending).toHaveLength(0);

      const all = await driver.getAll<QueuedMutation>("mutationQueue");
      const m = all.find((x) => x.id === id);
      expect(m?.status).toBe("quarantined");
      expect(m?.lastError).toBe("permanent failure");
    });
  });

  describe("clear", () => {
    it("empties the queue", async () => {
      await queue.enqueue(baseMutation);
      await queue.enqueue({ ...baseMutation, entityId: "sr-2" });
      expect(await queue.getPending()).toHaveLength(2);

      await queue.clear();
      expect(await queue.getPending()).toHaveLength(0);
    });
  });

  describe("crash recovery", () => {
    it("mutations survive driver close/reopen", async () => {
      const id = await queue.enqueue(baseMutation);

      // Simulate crash: close driver.
      await driver.close();

      // Reopen (InMemoryDriver keeps data in memory across close/open).
      await driver.open();
      const recoveredQueue = createMutationQueue(driver);

      const pending = await recoveredQueue.getPending();
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe(id);
      expect(pending[0].payload).toEqual(baseMutation.payload);
    });

    it("completed mutations are not recovered", async () => {
      const id1 = await queue.enqueue(baseMutation);
      const id2 = await queue.enqueue({ ...baseMutation, entityId: "sr-2" });

      await queue.complete(id1);

      await driver.close();
      await driver.open();
      const recoveredQueue = createMutationQueue(driver);

      const pending = await recoveredQueue.getPending();
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe(id2);
    });
  });
});
