// src/data/drafts.test.ts
// M8-06: drafts are per account/entity, removable, and never leak across accounts.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearDraft, readDraft, saveDraft } from "./drafts";

describe("note drafts", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("round-trips a draft and clears it", () => {
    saveDraft("u1", "saved_repository", "sr-1", "half typed note");
    expect(readDraft("u1", "saved_repository", "sr-1")).toBe("half typed note");
    clearDraft("u1", "saved_repository", "sr-1");
    expect(readDraft("u1", "saved_repository", "sr-1")).toBeNull();
  });

  it("isolates drafts per account and per entity kind", () => {
    saveDraft("u1", "saved_repository", "sr-1", "owner A draft");
    expect(readDraft("u2", "saved_repository", "sr-1")).toBeNull();
    expect(readDraft("u1", "list_item", "sr-1")).toBeNull();
  });

  it("treats an empty value as removal", () => {
    saveDraft("u1", "list_item", "l1:sr-1", "x");
    saveDraft("u1", "list_item", "l1:sr-1", "");
    expect(readDraft("u1", "list_item", "l1:sr-1")).toBeNull();
  });
});
