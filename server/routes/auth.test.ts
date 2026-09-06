import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { resetDbForTests } from "../db.js";

// Mock env before importing routes
vi.mock("../env.js", () => ({
  env: {
    nodeEnv: "test",
    port: 3001,
    databasePath: ":memory:",
    sessionSecret: "test-secret-key-for-testing",
    publicUrl: "http://localhost:3001",
    cookieSecure: false,
    githubClientId: "",
    githubClientSecret: "",
    localDevUser: "",
  },
  isProduction: false,
  githubOAuthConfigured: false,
  devLoginEnabled: false,
}));

const TEST_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  github_id TEXT UNIQUE NOT NULL,
  username TEXT NOT NULL,
  email TEXT,
  avatar_url TEXT,
  full_name TEXT,
  access_token TEXT,
  last_synced_at TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

describe("Auth routes", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(TEST_SCHEMA);
    resetDbForTests(db);
  });

  afterEach(() => {
    resetDbForTests(null);
    vi.resetModules();
  });

  it("GET /api/auth/session returns null user when not authenticated", async () => {
    const { authRoutes } = await import("./auth.js");
    const res = await authRoutes.request("/session");
    const body = (await res.json()) as {
      user: unknown;
      devLoginEnabled: boolean;
    };

    expect(res.status).toBe(200);
    expect(body.user).toBeNull();
    expect(body.devLoginEnabled).toBe(false);
  });

  it("POST /api/auth/dev-login returns 403 when LOCAL_DEV_USER is not set", async () => {
    const { authRoutes } = await import("./auth.js");
    const res = await authRoutes.request("/dev-login", { method: "POST" });
    const body = (await res.json()) as { code: string };

    expect(res.status).toBe(403);
    expect(body.code).toBe("DEV_LOGIN_DISABLED");
  });

  it("GET /api/auth/github/login returns 503 when OAuth is not configured", async () => {
    const { authRoutes } = await import("./auth.js");
    const res = await authRoutes.request("/github/login");
    const body = (await res.json()) as { code: string };

    expect(res.status).toBe(503);
    expect(body.code).toBe("OAUTH_NOT_CONFIGURED");
  });
});
