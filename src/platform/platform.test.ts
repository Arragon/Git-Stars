import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  setPlatformAdapter,
  getPlatformAdapter,
  type PlatformAdapter,
  type SaveResult,
} from "./index";
import { webPlatformAdapter } from "./web";

describe("platform adapter contract (ADR-0008 D2)", () => {
  it("resolves to the web adapter by default (v1 committed platform)", () => {
    expect(getPlatformAdapter()).toBe(webPlatformAdapter);
  });

  it("allows a test double with the same contract", () => {
    const fake: PlatformAdapter = {
      ...webPlatformAdapter,
      saveFile: vi.fn(async (): Promise<SaveResult> => ({
        ok: true,
        location: "download",
      })),
    };
    setPlatformAdapter(fake);
    expect(getPlatformAdapter()).toBe(fake);
    setPlatformAdapter(webPlatformAdapter);
    expect(getPlatformAdapter()).toBe(webPlatformAdapter);
  });

  it("web adapter declares the frozen v1 capability set", () => {
    expect(webPlatformAdapter.deepLink().supported).toBe(true);
    expect(webPlatformAdapter.secureStorage()).toBeNull(); // HttpOnly cookie session
    expect(webPlatformAdapter.backgroundSync().supported).toBe(false);
    expect(webPlatformAdapter.shareSheet().supported).toBe(false);
    expect(webPlatformAdapter.localCache().supported).toBe(true);
  });

  describe("saveFile", () => {
    beforeEach(() => {
      // Minimal DOM surface: the suite runs in the node environment.
      vi.stubGlobal("URL", {
        ...URL,
        createObjectURL: vi.fn(() => "blob:fake"),
        revokeObjectURL: vi.fn(),
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    it("creates an anchor download and reports ok", async () => {
      const click = vi.fn();
      const remove = vi.fn();
      const anchor = { click, href: "", download: "", remove };
      const created: unknown[] = [];
      const fakeDocument = {
        createElement: (tag: string) => {
          created.push(tag);
          return anchor;
        },
        body: { appendChild: vi.fn((el) => el) },
      };
      vi.stubGlobal("document", fakeDocument);

      const result = await webPlatformAdapter.saveFile(
        "a.zip",
        new Uint8Array([1]),
        "application/zip",
      );
      expect(result).toEqual({ ok: true, location: "download" });
      expect(created).toEqual(["a"]);
      expect(click).toHaveBeenCalled();
      expect(remove).toHaveBeenCalled();
    });

    it("reports unavailable when there is no DOM", async () => {
      const result = await webPlatformAdapter.saveFile(
        "a.zip",
        new Uint8Array([1]),
        "application/zip",
      );
      expect(result).toEqual({ ok: false, reason: "unavailable" });
    });
  });

  describe("openExternal", () => {
    it("opens with noopener isolation", async () => {
      const open = vi.fn(() => null);
      vi.stubGlobal("window", { open });
      try {
        await webPlatformAdapter.openExternal("https://github.com/x/y");
        expect(open).toHaveBeenCalledWith(
          "https://github.com/x/y",
          "_blank",
          "noopener,noreferrer",
        );
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("is a no-op without a window", async () => {
      await expect(
        webPlatformAdapter.openExternal("https://github.com/x/y"),
      ).resolves.toBeUndefined();
    });
  });
});
