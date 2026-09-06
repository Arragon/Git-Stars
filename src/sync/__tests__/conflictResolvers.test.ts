// src/sync/__tests__/conflictResolvers.test.ts
// Tests for entity-specific conflict resolvers (INH-419).
// 10 two-client concurrent scenarios.

import { describe, it, expect } from "vitest";
import {
  resolveConflict,
  resolveSavedRepository,
  resolveList,
  resolveListItemMembership,
  resolveListItemOrder,
  resolveTag,
  resolvePreference,
} from "../conflictResolvers";
import type { QueuedMutation } from "../../data/types";

function makeMutation(overrides: Partial<QueuedMutation>): QueuedMutation {
  return {
    id: "mut-1",
    entity: "saved_repository",
    operation: "update",
    entityId: "sr-1",
    baseVersion: 1,
    payload: {},
    createdAt: new Date().toISOString(),
    retryCount: 0,
    status: "pending",
    ...overrides,
  };
}

describe("Conflict Resolvers — 10 two-client scenarios", () => {
  // Scenario 1: SavedRepository — A edits note, B edits note → one 200, one 409 → resolver re-applies
  it("1. SavedRepository: A edits note, B edits note → resolver re-applies B's note onto server current", () => {
    // Server current after A's edit succeeded.
    const serverCurrent = { id: "sr-1", note: "A's note", status: "saved", version: 2 };
    // B's pending mutation (based on version 1).
    const bMutation = makeMutation({
      entity: "saved_repository",
      entityId: "sr-1",
      baseVersion: 1,
      payload: { note: "B's note" },
    });

    const result = resolveSavedRepository(bMutation, serverCurrent);
    expect(result.action).toBe("retry");
    if (result.action === "retry") {
      expect((result.payload as Record<string, unknown>).note).toBe("B's note");
      expect(result.newBaseVersion).toBe(2);
    }
  });

  // Scenario 2: SavedRepository — A edits status, B edits note → both converge
  it("2. SavedRepository: A edits status, B edits note → both converge via field-level merge", () => {
    // Server after A changed status.
    const serverCurrent = { id: "sr-1", note: "original", status: "archived", version: 2 };
    // B changed note (based on version 1).
    const bMutation = makeMutation({
      entity: "saved_repository",
      entityId: "sr-1",
      baseVersion: 1,
      payload: { note: "B's new note" },
    });

    const result = resolveSavedRepository(bMutation, serverCurrent);
    expect(result.action).toBe("retry");
    if (result.action === "retry") {
      const p = result.payload as Record<string, unknown>;
      expect(p.note).toBe("B's new note");
      expect(p.status).toBe("archived"); // A's change preserved
      expect(result.newBaseVersion).toBe(2);
    }
  });

  // Scenario 3: List — A renames, B renames → one 200, one 409
  it("3. List: A renames, B renames → resolver re-applies B's name", () => {
    const serverCurrent = { id: "l-1", name: "A's name", description: "", version: 2 };
    const bMutation = makeMutation({
      entity: "list",
      entityId: "l-1",
      baseVersion: 1,
      payload: { name: "B's name" },
    });

    const result = resolveList(bMutation, serverCurrent);
    expect(result.action).toBe("retry");
    if (result.action === "retry") {
      expect((result.payload as Record<string, unknown>).name).toBe("B's name");
      expect(result.newBaseVersion).toBe(2);
    }
  });

  // Scenario 4: ListItem membership — A adds X, B removes X → remove wins
  it("4. ListItem membership: A adds X, B removes X → remove wins (X not in resolved add)", () => {
    // Server after A added X.
    const serverCurrent = {
      version: 2,
      items: [{ savedRepositoryId: "X" }, { savedRepositoryId: "Y" }],
    };
    // B tries to remove X (based on version 1, when X wasn't there yet).
    const bMutation = makeMutation({
      entity: "list_item",
      entityId: "list-1",
      baseVersion: 1,
      payload: { remove: ["X"] },
    });

    const result = resolveListItemMembership(bMutation, serverCurrent);
    expect(result.action).toBe("retry");
    if (result.action === "retry") {
      // X is on server, so remove is valid.
      expect((result.payload as Record<string, unknown>).remove).toEqual(["X"]);
    }
  });

  // Scenario 5: ListItem membership — A adds X, B adds Y → both present
  it("5. ListItem membership: A adds X, B adds Y → B's add resolves (Y not on server yet)", () => {
    // Server after A added X.
    const serverCurrent = {
      version: 2,
      items: [{ savedRepositoryId: "X" }],
    };
    // B tries to add Y.
    const bMutation = makeMutation({
      entity: "list_item",
      entityId: "list-1",
      baseVersion: 1,
      payload: { add: ["Y"] },
    });

    const result = resolveListItemMembership(bMutation, serverCurrent);
    expect(result.action).toBe("retry");
    if (result.action === "retry") {
      expect((result.payload as Record<string, unknown>).add).toEqual(["Y"]);
    }
  });

  // Scenario 6: ListItem order — A reorders [X,Y,Z], B reorders [Z,X,Y] → deterministic
  it("6. ListItem order: A reorders, B reorders → B's reorder re-applied against server state", () => {
    // Server after A's reorder.
    const serverCurrent = {
      version: 2,
      items: [
        { savedRepositoryId: "X", position: "a" },
        { savedRepositoryId: "Y", position: "d" },
        { savedRepositoryId: "Z", position: "g" },
      ],
    };
    // B wants order [Z, X, Y].
    const bMutation = makeMutation({
      entity: "list_item",
      entityId: "list-1",
      baseVersion: 1,
      payload: { reorder: ["Z", "X", "Y"] },
    });

    const result = resolveListItemOrder(bMutation, serverCurrent);
    expect(result.action).toBe("retry");
    if (result.action === "retry") {
      expect((result.payload as Record<string, unknown>).reorder).toEqual(["Z", "X", "Y"]);
      expect(result.newBaseVersion).toBe(2);
    }
  });

  // Scenario 7: Tag — A attaches T, B detaches T → detach wins
  it("7. Tag: A attaches T, B detaches T → detach is re-applied (idempotent)", () => {
    const serverCurrent = { version: 2 };
    const bMutation = makeMutation({
      entity: "repository_tag",
      entityId: "rt-1",
      baseVersion: 1,
      payload: { tagId: "T", savedRepositoryId: "sr-1", op: "detach" },
    });

    const result = resolveTag(bMutation, serverCurrent);
    expect(result.action).toBe("retry");
    if (result.action === "retry") {
      expect((result.payload as Record<string, unknown>).op).toBe("detach");
    }
  });

  // Scenario 8: Tag — A creates "foo", B creates "foo" → single tag (server handles uniqueness)
  it("8. Tag: A creates 'foo', B creates 'foo' → resolver retries (server UNIQUE constraint deduplicates)", () => {
    const serverCurrent = { version: 2, id: "tag-foo", name: "foo" };
    const bMutation = makeMutation({
      entity: "tag",
      entityId: "tag-foo-2",
      baseVersion: 1,
      payload: { name: "foo" },
    });

    const result = resolveTag(bMutation, serverCurrent);
    // Retry — server will reject duplicate via UNIQUE constraint (409 again → eventually manual).
    expect(result.action).toBe("retry");
  });

  // Scenario 9: Preference — A sets theme, B sets language → both applied
  it("9. Preference: A sets theme, B sets language → both applied via field-level merge", () => {
    // Server after A set theme.
    const serverCurrent = { version: 2, data: { theme: "dark" } };
    // B sets language (based on version 1).
    const bMutation = makeMutation({
      entity: "preference",
      entityId: "singleton",
      baseVersion: 1,
      payload: { language: "zh" },
    });

    const result = resolvePreference(bMutation, serverCurrent);
    expect(result.action).toBe("retry");
    if (result.action === "retry") {
      const p = result.payload as Record<string, unknown>;
      expect(p.theme).toBe("dark"); // A's value preserved
      expect(p.language).toBe("zh"); // B's value applied
    }
  });

  // Scenario 10: Preference — A sets theme=dark, B sets theme=light → LWW
  it("10. Preference: A sets theme=dark, B sets theme=light → LWW (B's value wins)", () => {
    const serverCurrent = { version: 2, data: { theme: "dark" } };
    const bMutation = makeMutation({
      entity: "preference",
      entityId: "singleton",
      baseVersion: 1,
      payload: { theme: "light" },
    });

    const result = resolvePreference(bMutation, serverCurrent);
    expect(result.action).toBe("retry");
    if (result.action === "retry") {
      expect((result.payload as Record<string, unknown>).theme).toBe("light");
    }
  });
});

describe("resolveConflict dispatcher", () => {
  it("dispatches to correct resolver by entity type", () => {
    const server = { version: 2, data: { theme: "dark" } };
    const mutation = makeMutation({
      entity: "preference",
      payload: { language: "en" },
    });

    const result = resolveConflict("preference", mutation, server);
    expect(result.action).toBe("retry");
    if (result.action === "retry") {
      expect((result.payload as Record<string, unknown>).theme).toBe("dark");
      expect((result.payload as Record<string, unknown>).language).toBe("en");
    }
  });

  it("returns manual for unknown entity types", () => {
    const mutation = makeMutation({ entity: "unknown_thing" as "saved_repository" });
    const result = resolveConflict("unknown_thing", mutation, {});
    expect(result.action).toBe("manual");
  });

  it("dispatches list_item with reorder to order resolver", () => {
    const server = {
      version: 2,
      items: [{ savedRepositoryId: "X", position: "a" }],
    };
    const mutation = makeMutation({
      entity: "list_item",
      payload: { reorder: ["X"] },
    });

    const result = resolveConflict("list_item", mutation, server);
    expect(result.action).toBe("retry");
  });

  it("dispatches list_item without reorder to membership resolver", () => {
    const server = {
      version: 2,
      items: [{ savedRepositoryId: "X" }],
    };
    const mutation = makeMutation({
      entity: "list_item",
      payload: { add: ["Y"] },
    });

    const result = resolveConflict("list_item", mutation, server);
    expect(result.action).toBe("retry");
    if (result.action === "retry") {
      expect((result.payload as Record<string, unknown>).add).toEqual(["Y"]);
    }
  });
});
