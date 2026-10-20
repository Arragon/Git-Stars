// server/routes/library.test.ts
// M7-14 / INH-1708: the 409 conflict payload must carry the current business state
// (object), not just an etag string — otherwise the client resolver spreads a string
// into a garbage payload and the note is silently lost after retries.
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
  },
  isProduction: false,
  githubOAuthConfigured: false,
  devLoginEnabled: false,
}));

import {
  bootstrapDb,
  cookieFor,
  seedRepository,
  seedUser,
  teardownDb,
} from "../testing/bootstrap.js";
import { libraryRoutes } from "./library.js";

describe("library note update contract (M7-14)", () => {
  let db: DatabaseSync;
  const user = "u-note";
  const savedId = "sr-note";

  beforeEach(() => {
    db = bootstrapDb();
    seedUser(db, user, "1", "alice");
    seedRepository(db, "repo-1");
    db.prepare(
      `INSERT INTO saved_repositories (id, user_id, repository_id, status, note, version, added_at, updated_at)
       VALUES (?, ?, 'repo-1', 'saved', 'server note', 3, '2026-01-01', '2026-01-01')`,
    ).run(savedId, user);
  });

  afterEach(() => teardownDb());

  it("returns the current state and etag on a stale If-Match", async () => {
    const res = await libraryRoutes.request(`/${savedId}`, {
      method: "PUT",
      headers: {
        cookie: cookieFor(user),
        "content-type": "application/json",
        "If-Match": `${savedId}:2`,
      },
      body: JSON.stringify({ note: "local draft" }),
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      code: string;
      details: {
        current: {
          id: string;
          note: string;
          status: string;
          version: number;
          aiTags: string[];
        };
        etag: string;
      };
    };
    expect(body.code).toBe("VERSION_CONFLICT");
    expect(body.details.current).toMatchObject({
      id: savedId,
      note: "server note",
      status: "saved",
      version: 3,
      aiTags: [],
    });
    expect(body.details.etag).toBe(`"${savedId}:3"`);
    // The rejected write must not have been applied.
    const row = db
      .prepare("SELECT note, version FROM saved_repositories WHERE id = ?")
      .get(savedId) as { note: string; version: number };
    expect(row.note).toBe("server note");
    expect(Number(row.version)).toBe(3);
  });

  it("accepts a matching If-Match and advances the version", async () => {
    const res = await libraryRoutes.request(`/${savedId}`, {
      method: "PUT",
      headers: {
        cookie: cookieFor(user),
        "content-type": "application/json",
        "If-Match": `${savedId}:3`,
      },
      body: JSON.stringify({ note: "new note" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { note: string; version: number };
    expect(body.note).toBe("new note");
    expect(body.version).toBe(4);
  });
});
