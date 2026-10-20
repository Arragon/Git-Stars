// src/sync/__tests__/offlineCreateChain.test.ts
// M7-04 / INH-1702: a create ACK must map the temp id for dependent mutations, and a
// lost ACK must not create a duplicate or dead-end the queue.

import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryDriver } from "../../data/driver/InMemoryDriver";
import { createMutationQueue, type MutationQueue } from "../mutationQueue";
import {
  createPushReplay,
  type ApiClient,
  type MutationResponse,
} from "../pushReplay";
import { createIdResolver } from "../idMap";
import { ApiError } from "../../utils/api";
import type { IdMapEntry, QueuedMutation } from "../../data/types";

const TEMP_LIST = "pending:list-1";

describe("offline create chain (M7-04)", () => {
  let driver: InMemoryDriver;
  let queue: MutationQueue;

  beforeEach(async () => {
    driver = new InMemoryDriver();
    await driver.open();
    await driver.migrate();
    queue = createMutationQueue(driver);
  });

  async function enqueueCreate(tempId: string): Promise<string> {
    return queue.enqueue({
      entity: "list",
      operation: "create",
      entityId: tempId,
      baseVersion: 0,
      payload: { name: "List X" },
      createsTempId: tempId,
    });
  }

  async function enqueueItem(tempListId: string): Promise<string> {
    return queue.enqueue({
      entity: "list_item",
      operation: "create",
      entityId: `${tempListId}:sr-1`,
      baseVersion: 0,
      payload: { list_id: tempListId, saved_repository_id: "sr-1" },
      refs: [tempListId],
    });
  }

  function buildReplay(apiClient: ApiClient) {
    const resolver = createIdResolver({
      async getIdMapEntry(tempId) {
        return driver.get<IdMapEntry>("idMap", tempId);
      },
      async putIdMapEntry(entry) {
        await driver.put("idMap", entry);
      },
    });
    const replay = createPushReplay({
      mutationQueue: queue,
      apiClient,
      idResolver: resolver,
    });
    return { replay, resolver };
  }

  it("rewrites a dependent mutation to the server id after the create ACK", async () => {
    await enqueueCreate(TEMP_LIST);
    await enqueueItem(TEMP_LIST);

    const seen: QueuedMutation[] = [];
    const apiClient: ApiClient = {
      async sendMutation(m): Promise<MutationResponse> {
        seen.push(m);
        if (m.entity === "list") {
          return { id: "server-list-1", version: 1, etag: '"l1:1"' };
        }
        return { version: 1, etag: "" };
      },
    };

    const { replay, resolver } = buildReplay(apiClient);
    const result = await replay.replayAll();

    expect(result.completed).toBe(2);
    expect(result.remaining).toBe(0);
    const itemCall = seen.find((m) => m.entity === "list_item");
    expect((itemCall?.payload as { list_id: string }).list_id).toBe(
      "server-list-1",
    );
    expect((await resolver.resolveRefs([TEMP_LIST])).get(TEMP_LIST)).toBe(
      "server-list-1",
    );
  });

  it("survives a lost create ACK: replay gets the same id and keeps dependents working", async () => {
    await enqueueCreate(TEMP_LIST);
    await enqueueItem(TEMP_LIST);

    let createAttempts = 0;
    const apiClient: ApiClient = {
      async sendMutation(m): Promise<MutationResponse> {
        if (m.entity === "list") {
          createAttempts += 1;
          // The server committed the create but the ACK was lost (network error).
          if (createAttempts === 1) throw new Error("network down");
          // Idempotent replay returns the original id.
          return { id: "server-list-1", version: 1, etag: '"l1:1"' };
        }
        return { version: 1, etag: "" };
      },
    };

    const { replay } = buildReplay(apiClient);
    const first = await replay.replayAll();
    expect(first.completed).toBe(0);
    expect(first.remaining).toBe(2); // nothing lost, create stays pending

    const second = await replay.replayAll();
    expect(second.completed).toBe(2);
    expect(second.remaining).toBe(0);
  });

  it("does not block unrelated items behind an unresolved dependency", async () => {
    // Orphan dependency: no create mutation exists for this temp id.
    await enqueueItem("pending:never-created");
    await queue.enqueue({
      entity: "saved_repository",
      operation: "update",
      entityId: "sr-9",
      baseVersion: 1,
      payload: { note: "unrelated" },
    });

    const apiClient: ApiClient = {
      async sendMutation(): Promise<MutationResponse> {
        return { version: 2, etag: '"sr-9:2"' };
      },
    };

    const { replay } = buildReplay(apiClient);
    const result = await replay.replayAll();

    expect(result.completed).toBe(1); // unrelated update went through
    expect(result.remaining).toBe(1); // blocked item stays pending, not lost
  });

  it("quarantines a 404 instead of stopping the whole queue", async () => {
    await queue.enqueue({
      entity: "list_item",
      operation: "create",
      entityId: "list-x:sr-1",
      baseVersion: 0,
      payload: { list_id: "list-x", saved_repository_id: "sr-1" },
    });
    await queue.enqueue({
      entity: "saved_repository",
      operation: "update",
      entityId: "sr-9",
      baseVersion: 1,
      payload: { note: "after" },
    });

    const apiClient: ApiClient = {
      async sendMutation(m): Promise<MutationResponse> {
        if (m.entity === "list_item") {
          throw new ApiError("List not found", "NOT_FOUND", 404);
        }
        return { version: 2, etag: '"sr-9:2"' };
      },
    };

    const { replay } = buildReplay(apiClient);
    const result = await replay.replayAll();

    expect(result.quarantined).toBe(1);
    expect(result.completed).toBe(1); // the later unrelated item still ran
    expect(result.remaining).toBe(0);
  });

  it("persists the mapping in the driver (survives a restart)", async () => {
    await enqueueCreate(TEMP_LIST);
    const apiClient: ApiClient = {
      async sendMutation(): Promise<MutationResponse> {
        return { id: "server-list-9", version: 1, etag: "" };
      },
    };
    await buildReplay(apiClient).replay.replayAll();

    const entry = await driver.get<IdMapEntry>("idMap", TEMP_LIST);
    expect(entry?.serverId).toBe("server-list-9");
  });
});
