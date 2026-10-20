// src/sync/__tests__/idMap.test.ts
// M7-04 / INH-1702: payload rewriting and temp-id resolution.

import { describe, expect, it } from "vitest";
import { createIdResolver, rewritePayloadWithIds } from "../idMap";
import type { IdMapEntry } from "../../data/types";

describe("rewritePayloadWithIds", () => {
  it("rewrites nested temp ids and leaves other values untouched", () => {
    const map = new Map([
      ["pending:list-1", "server-list-1"],
      ["pending:sr-1", "server-sr-1"],
    ]);
    const payload = {
      list_id: "pending:list-1",
      saved_repository_id: "pending:sr-1",
      note: "pending:list-1",
      nested: { ids: ["pending:sr-1", "keep-me"] },
      count: 3,
      flag: true,
    };

    expect(rewritePayloadWithIds(payload, map)).toEqual({
      list_id: "server-list-1",
      saved_repository_id: "server-sr-1",
      note: "server-list-1", // any exact temp-id string is rewritten
      nested: { ids: ["server-sr-1", "keep-me"] },
      count: 3,
      flag: true,
    });
  });

  it("does not mutate the input payload", () => {
    const payload = { list_id: "pending:list-1" };
    rewritePayloadWithIds(payload, new Map([["pending:list-1", "srv"]]));
    expect(payload.list_id).toBe("pending:list-1");
  });
});

describe("createIdResolver", () => {
  it("resolves known temp ids and reports unknown ones as missing", async () => {
    const store = new Map<string, IdMapEntry>();
    const resolver = createIdResolver({
      async getIdMapEntry(tempId) {
        return store.get(tempId);
      },
      async putIdMapEntry(entry) {
        store.set(entry.tempId, entry);
      },
    });

    await resolver.record({
      tempId: "pending:a",
      entity: "list",
      serverId: "server-a",
      version: 1,
      createdAt: "2026-01-01T00:00:00Z",
    });

    const map = await resolver.resolveRefs(["pending:a", "pending:missing"]);
    expect(map.get("pending:a")).toBe("server-a");
    expect(map.has("pending:missing")).toBe(false);
  });
});
