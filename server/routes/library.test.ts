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

// M8-07: AI summary provenance travels with the summary and survives a re-read.
describe("AI summary provenance (M8-07)", () => {
  let db: DatabaseSync;
  const user = "u-ai";
  const savedId = "sr-ai";

  beforeEach(() => {
    db = bootstrapDb();
    seedUser(db, user, "2", "bob");
    seedRepository(db, "repo-ai");
    db.prepare(
      `INSERT INTO saved_repositories (id, user_id, repository_id, status, note, version, added_at, updated_at)
       VALUES (?, ?, 'repo-ai', 'saved', NULL, 1, '2026-01-01', '2026-01-01')`,
    ).run(savedId, user);
  });

  afterEach(() => teardownDb());

  it("stores sources and returns them on the next read", async () => {
    const provenance = [
      {
        model: "test-model",
        presetId: "minimax",
        generatedAt: "2026-10-21T00:00:00.000Z",
        sources: [
          {
            kind: "readme",
            label: "README.md",
            ref: "HEAD",
            sha256: "a".repeat(64),
            fetchedAt: "2026-10-21T00:00:00.000Z",
            included: true,
          },
        ],
        unknowns: ["信息不足：未说明许可证"],
        conflicts: [],
      },
    ];

    const put = await libraryRoutes.request(`/${savedId}`, {
      method: "PUT",
      headers: {
        cookie: cookieFor(user),
        "content-type": "application/json",
        "If-Match": `${savedId}:1`,
      },
      body: JSON.stringify({
        aiSummary: "一个用于测试的仓库。",
        aiTags: ["测试"],
        aiSummarySources: provenance,
      }),
    });
    expect(put.status).toBe(200);
    const saved = (await put.json()) as {
      aiSummary: string;
      aiSummarySources: typeof provenance;
      version: number;
    };
    expect(saved.aiSummarySources?.[0]?.sources[0].sha256).toBe("a".repeat(64));
    expect(saved.version).toBe(2);

    // Re-read through the list endpoint: provenance is part of the projection.
    const list = await libraryRoutes.request("/", {
      headers: { cookie: cookieFor(user) },
    });
    const items = (await list.json()) as Array<{
      id: string;
      aiSummarySources?: typeof provenance;
    }>;
    expect(
      items.find((i) => i.id === savedId)?.aiSummarySources?.[0]?.model,
    ).toBe("test-model");

    // The personal note is never touched by an AI write.
    const row = db
      .prepare("SELECT note, ai_summary FROM saved_repositories WHERE id = ?")
      .get(savedId) as { note: string | null; ai_summary: string | null };
    expect(row.note).toBeNull();
    expect(row.ai_summary).toContain("测试");
  });
});
