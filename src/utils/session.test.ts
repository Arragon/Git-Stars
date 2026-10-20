// src/utils/session.test.ts
// M7-03 / INH-1699: sign-out preserves unsynced work by default and reports exactly
// what is at stake; account deletion is the only path that wipes the queue.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const countAll = vi.fn();
const getUnresolved = vi.fn();
const clearUserState = vi.fn();
const postLogout = vi.fn();
const reset = vi.fn();
const clearSecret = vi.fn();

vi.mock("../sync/syncClient", () => ({
  mutationQueue: { countAll: (...args: unknown[]) => countAll(...args) },
  conflictLog: {
    getUnresolved: (...args: unknown[]) => getUnresolved(...args),
  },
}));
vi.mock("../data", () => ({
  localStore: {
    clearUserState: (...args: unknown[]) => clearUserState(...args),
  },
}));
vi.mock("./gitstarsApi", () => ({
  postLogout: (...args: unknown[]) => postLogout(...args),
}));
vi.mock("../store/useSyncStatusStore", () => ({
  useSyncStatusStore: { getState: () => ({ reset }) },
}));
vi.mock("../store/useAiConfigStore", () => ({
  useAiConfigStore: { getState: () => ({ clearSecret }) },
}));

import {
  confirmUnsyncedBeforeSignOut,
  readUnsyncedSummary,
  signOutAndResetLocal,
} from "./session";

describe("readUnsyncedSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    postLogout.mockResolvedValue({ ok: true });
    clearUserState.mockResolvedValue(undefined);
  });

  it("aggregates pending, quarantined and unresolved conflicts", async () => {
    countAll.mockResolvedValue({ pending: 2, quarantined: 1, total: 3 });
    getUnresolved.mockResolvedValue([{ id: "c1" }]);

    await expect(readUnsyncedSummary()).resolves.toEqual({
      pending: 2,
      quarantined: 1,
      conflicts: 1,
      total: 4,
    });
  });

  it("still reports queue counts when the conflict log is unavailable", async () => {
    countAll.mockResolvedValue({ pending: 1, quarantined: 0, total: 1 });
    getUnresolved.mockRejectedValue(new Error("db closed"));

    await expect(readUnsyncedSummary()).resolves.toMatchObject({
      pending: 1,
      conflicts: 0,
      total: 1,
    });
  });
});

describe("confirmUnsyncedBeforeSignOut", () => {
  const confirmMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // The suite runs in the Node environment; provide the browser global used by the
    // confirmation flow.
    vi.stubGlobal("window", { confirm: confirmMock });
    confirmMock.mockReturnValue(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("names pending/quarantined/conflict counts in the prompt", async () => {
    countAll.mockResolvedValue({ pending: 2, quarantined: 1, total: 3 });
    getUnresolved.mockResolvedValue([{ id: "c1" }]);

    await expect(confirmUnsyncedBeforeSignOut()).resolves.toBe(true);
    const prompt = confirmMock.mock.calls[0][0] as string;
    expect(prompt).toContain("2 条待同步修改");
    expect(prompt).toContain("1 条失败草稿");
    expect(prompt).toContain("1 条未解决冲突");
    expect(prompt).toContain("保留在设备上");
  });

  it("returns false when the user cancels", async () => {
    countAll.mockResolvedValue({ pending: 1, quarantined: 0, total: 1 });
    getUnresolved.mockResolvedValue([]);
    confirmMock.mockReturnValue(false);

    await expect(confirmUnsyncedBeforeSignOut()).resolves.toBe(false);
  });
});

describe("signOutAndResetLocal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    postLogout.mockResolvedValue({ ok: true });
    clearUserState.mockResolvedValue(undefined);
  });

  it("preserves the queue by default", async () => {
    await signOutAndResetLocal();
    expect(clearUserState).toHaveBeenCalledWith({ includeQueue: false });
    expect(clearSecret).toHaveBeenCalled();
    expect(reset).toHaveBeenCalled();
  });

  it("wipes the queue when explicitly requested (account deletion)", async () => {
    await signOutAndResetLocal({ preserveQueue: false });
    expect(clearUserState).toHaveBeenCalledWith({ includeQueue: true });
  });

  it("still clears local state when the logout request fails", async () => {
    postLogout.mockRejectedValue(new Error("network"));
    await signOutAndResetLocal();
    expect(clearUserState).toHaveBeenCalled();
  });
});
