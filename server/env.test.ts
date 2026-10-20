// server/env.test.ts
// Regression for M7-01 (INH-1697): the suite must run in a clean environment with no
// developer .env (CI has none), while startup must keep rejecting a missing
// SESSION_SECRET. The test-only value comes from vite.config.ts `test.env`.
import { afterEach, describe, expect, it, vi } from "vitest";

describe("environment contract (M7-01)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("loads with the test-provided SESSION_SECRET", async () => {
    vi.resetModules();
    const { env } = await import("./env.js");
    expect(env.sessionSecret).toBe("test-secret-key-for-testing");
    expect(env.databasePath).toBe(":memory:");
  });

  it("still refuses to start without SESSION_SECRET", async () => {
    // An empty value must fail exactly like a missing one (required() trims).
    vi.stubEnv("SESSION_SECRET", "");
    vi.resetModules();
    await expect(import("./env.js")).rejects.toThrow(
      /Missing required environment variable: SESSION_SECRET/,
    );
  });
});
