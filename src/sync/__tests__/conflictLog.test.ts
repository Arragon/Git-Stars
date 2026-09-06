// src/sync/__tests__/conflictLog.test.ts
// Tests for the conflict log store (INH-419).

import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryDriver } from "../../data/driver/InMemoryDriver";
import { createConflictLog } from "../conflictLog";
import type { ConflictLog } from "../conflictLog";

describe("ConflictLog", () => {
  let conflictLog: ConflictLog;

  beforeEach(async () => {
    const driver = new InMemoryDriver();
    await driver.open();
    await driver.migrate();
    conflictLog = createConflictLog(driver);
  });

  const baseConflict = {
    entityType: "saved_repository",
    entityId: "sr-1",
    operation: "update",
    baseVersion: 1,
    serverVersion: 2,
    localPayload: { note: "local edit" },
    serverSnapshot: { note: "server edit", version: 2 },
  };

  it("record → getUnresolved returns it", async () => {
    const id = await conflictLog.record(baseConflict);
    expect(id).toBeTruthy();

    const unresolved = await conflictLog.getUnresolved();
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].id).toBe(id);
    expect(unresolved[0].resolution).toBe("pending");
    expect(unresolved[0].entityType).toBe("saved_repository");
    expect(unresolved[0].localPayload).toEqual({ note: "local edit" });
  });

  it("markResolved → no longer in unresolved", async () => {
    const id = await conflictLog.record(baseConflict);

    await conflictLog.markResolved(id, { note: "merged" });

    const unresolved = await conflictLog.getUnresolved();
    expect(unresolved).toHaveLength(0);

    const all = await conflictLog.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].resolution).toBe("auto_resolved");
    expect(all[0].resolvedPayload).toEqual({ note: "merged" });
    expect(all[0].resolvedAt).toBeTruthy();
  });

  it("discard → marked as discarded", async () => {
    const id = await conflictLog.record(baseConflict);

    await conflictLog.discard(id);

    const unresolved = await conflictLog.getUnresolved();
    expect(unresolved).toHaveLength(0);

    const all = await conflictLog.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].resolution).toBe("discarded");
    expect(all[0].resolvedAt).toBeTruthy();
  });

  it("multiple conflicts: only pending ones are unresolved", async () => {
    const id1 = await conflictLog.record(baseConflict);
    const id2 = await conflictLog.record({
      ...baseConflict,
      entityId: "sr-2",
    });
    const id3 = await conflictLog.record({
      ...baseConflict,
      entityId: "sr-3",
    });

    await conflictLog.markResolved(id1);
    await conflictLog.discard(id3);

    const unresolved = await conflictLog.getUnresolved();
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].id).toBe(id2);
  });
});
