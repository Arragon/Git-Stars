// src/sync/__tests__/accountScope.test.ts
// M8-X: offline queue and temp-id map never cross account boundaries.

import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryDriver } from "../../data/driver/InMemoryDriver";
import { createMutationQueue } from "../mutationQueue";
import { createIdResolver } from "../idMap";
import type { IdMapEntry, QueuedMutation } from "../../data/types";

const base = {
  entity: "saved_repository" as const,
  operation: "update" as const,
  entityId: "sr-1",
  baseVersion: 1,
  payload: { note: "x" },
};

describe("account-scoped mutation queue", () => {
  let driver: InMemoryDriver;
  let scope: string | null;
  let queue: ReturnType<typeof createMutationQueue>;

  beforeEach(async () => {
    driver = new InMemoryDriver();
    await driver.open();
    await driver.migrate();
    scope = "user-a";
    queue = createMutationQueue(driver, () => scope);
  });

  it("stamps the owner and hides other accounts' pending work", async () => {
    await queue.enqueue(base);
    scope = "user-b";
    await queue.enqueue({ ...base, entityId: "sr-2" });

    expect((await queue.getPending()).map((m) => m.entityId)).toEqual(["sr-2"]);
    scope = "user-a";
    expect((await queue.getPending()).map((m) => m.entityId)).toEqual(["sr-1"]);
    expect(await queue.countAll()).toMatchObject({ pending: 1, total: 1 });
  });

  it("claims legacy entries (no owner) exactly once, for the first scope", async () => {
    await driver.put<QueuedMutation>("mutationQueue", {
      ...base,
      id: "legacy-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      retryCount: 0,
      status: "pending",
    });

    expect((await queue.getPending()).map((m) => m.id)).toEqual(["legacy-1"]);
    const claimed = await driver.get<QueuedMutation>(
      "mutationQueue",
      "legacy-1",
    );
    expect(claimed?.ownerId).toBe("user-a");

    scope = "user-b";
    expect(await queue.getPending()).toEqual([]);
    // Still stored for A, not deleted.
    scope = "user-a";
    expect((await queue.getPending()).map((m) => m.id)).toEqual(["legacy-1"]);
  });

  it("does not filter before a scope is known", async () => {
    scope = null;
    await queue.enqueue(base);
    expect(await queue.getPending()).toHaveLength(1);
  });
});

describe("account-scoped id map", () => {
  it("resolves only entries owned by the active scope and claims legacy ones", async () => {
    const driver = new InMemoryDriver();
    await driver.open();
    await driver.migrate();
    const store = {
      getIdMapEntry: (tempId: string) =>
        driver.get<IdMapEntry>("idMap", tempId),
      putIdMapEntry: async (entry: IdMapEntry) => {
        await driver.put("idMap", entry);
      },
    };
    let scope = "user-a";
    const resolver = createIdResolver(store, () => scope);

    await resolver.record({
      tempId: "pending:list-1",
      entity: "list",
      serverId: "server-list-1",
      version: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect((await resolver.resolveRefs(["pending:list-1"])).size).toBe(1);

    scope = "user-b";
    expect((await resolver.resolveRefs(["pending:list-1"])).size).toBe(0);

    // Legacy entry without owner is claimed by the current scope.
    await driver.put("idMap", {
      tempId: "pending:legacy",
      entity: "list",
      serverId: "server-legacy",
      version: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
    } satisfies IdMapEntry);
    expect(
      (await resolver.resolveRefs(["pending:legacy"])).get("pending:legacy"),
    ).toBe("server-legacy");
    const claimed = await driver.get<IdMapEntry>("idMap", "pending:legacy");
    expect(claimed?.ownerId).toBe("user-b");
  });
});
