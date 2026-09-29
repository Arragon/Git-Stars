import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";

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
    credentialKey: "",
    allowDevLogin: false,
    adminToken: "",
  },
  isProduction: false,
  githubOAuthConfigured: false,
  devLoginEnabled: false,
}));

import {
  bootstrapDb,
  cookieFor,
  seedUser,
  seedRepository,
  teardownDb,
} from "../testing/bootstrap.js";
import { publicationRoutes } from "./publications.js";

const OWNER = "user-owner";
// Keep in sync with PUBLISH_LIMIT in routes/publications.ts.
const PUBLISH_LIMIT = 10;

describe("publish rate limiting (10/hour/user)", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = bootstrapDb();
    seedUser(db, OWNER, "111", "alice");
    seedRepository(db, "repo-1", { remoteId: "1" });
    db.prepare(
      `INSERT INTO saved_repositories (id, user_id, repository_id, status, note, version, added_at, updated_at)
       VALUES ('sr-1', ?, 'repo-1', 'saved', NULL, 1, '2026-01-01', '2026-01-01')`,
    ).run(OWNER);
    db.prepare(
      `INSERT INTO lists (id, user_id, name, description, version, created_at, updated_at)
       VALUES ('list-1', ?, 'Shared', '', 1, '2026-01-01', '2026-01-01')`,
    ).run(OWNER);
    db.prepare(
      `INSERT INTO list_items (id, list_id, saved_repository_id, position, position_key, version, created_at, updated_at)
       VALUES ('item-1', 'list-1', 'sr-1', 0, 'a', 1, '2026-01-01', '2026-01-01')`,
    ).run();
  });

  afterEach(() => teardownDb());

  it("allows the first 10 publishes and answers 429 RATE_LIMITED with retryAfterSec afterwards", async () => {
    const headers = { cookie: cookieFor(OWNER) };
    for (let i = 0; i < PUBLISH_LIMIT; i++) {
      const res = await publicationRoutes.request("/lists/list-1/publication", {
        method: "POST",
        headers,
      });
      expect([200, 201]).toContain(res.status);
    }
    const blocked = await publicationRoutes.request(
      "/lists/list-1/publication",
      {
        method: "POST",
        headers,
      },
    );
    expect(blocked.status).toBe(429);
    const body = (await blocked.json()) as {
      code: string;
      details?: { retryAfterSec?: number };
    };
    expect(body.code).toBe("RATE_LIMITED");
    expect(typeof body.details?.retryAfterSec).toBe("number");
    expect(body.details!.retryAfterSec).toBeGreaterThan(0);
    expect(body.details!.retryAfterSec).toBeLessThanOrEqual(3600);

    // The limit is per user: another account is unaffected.
    db.prepare(
      "INSERT INTO users (id, github_id, username) VALUES ('user-two', '222', 'bob')",
    ).run();
    db.prepare(
      `INSERT INTO saved_repositories (id, user_id, repository_id, status, note, version, added_at, updated_at)
       VALUES ('sr-2', 'user-two', 'repo-1', 'saved', NULL, 1, '2026-01-01', '2026-01-01')`,
    ).run();
    db.prepare(
      `INSERT INTO lists (id, user_id, name, description, version, created_at, updated_at)
       VALUES ('list-2', 'user-two', 'Bob List', '', 1, '2026-01-01', '2026-01-01')`,
    ).run();
    db.prepare(
      `INSERT INTO list_items (id, list_id, saved_repository_id, position, position_key, version, created_at, updated_at)
       VALUES ('item-2', 'list-2', 'sr-2', 0, 'a', 1, '2026-01-01', '2026-01-01')`,
    ).run();
    const other = await publicationRoutes.request("/lists/list-2/publication", {
      method: "POST",
      headers: { cookie: cookieFor("user-two") },
    });
    expect([200, 201]).toContain(other.status);
  });
});
