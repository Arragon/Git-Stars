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
import { publicRoutes } from "./public.js";
import { hubRoutes } from "./hub.js";
import { listRoutes } from "./lists.js";
import { publish, revoke } from "../services/publication.js";

const OWNER = "user-owner";
const OTHER = "user-bob";

function seedWorld(db: DatabaseSync): void {
  seedUser(db, OWNER, "111", "alice");
  seedUser(db, OTHER, "222", "bob");
  seedRepository(db, "repo-1", {
    remoteId: "1",
    name: "hono",
    fullName: "honojs/hono",
  });
  seedRepository(db, "repo-2", {
    remoteId: "2",
    name: "vitest",
    fullName: "vitest-dev/vitest",
  });
  db.prepare(
    `INSERT INTO saved_repositories (id, user_id, repository_id, status, note, version, added_at, updated_at)
     VALUES ('sr-1', ?, 'repo-1', 'saved', 'private note alpha', 1, '2026-01-01', '2026-01-01')`,
  ).run(OWNER);
  db.prepare(
    `INSERT INTO saved_repositories (id, user_id, repository_id, status, note, version, added_at, updated_at)
     VALUES ('sr-2', ?, 'repo-2', 'saved', NULL, 1, '2026-01-01', '2026-01-01')`,
  ).run(OWNER);
  db.prepare(
    `INSERT INTO lists (id, user_id, name, description, version, created_at, updated_at)
     VALUES ('list-1', ?, 'Shared Picks', 'public picks', 1, '2026-01-01', '2026-01-01')`,
  ).run(OWNER);
  db.prepare(
    `INSERT INTO list_items (id, list_id, saved_repository_id, position, position_key, version, created_at, updated_at)
     VALUES ('item-1', 'list-1', 'sr-1', 0, 'a', 1, '2026-01-01', '2026-01-01')`,
  ).run();
  db.prepare(
    `INSERT INTO list_items (id, list_id, saved_repository_id, position, position_key, version, created_at, updated_at)
     VALUES ('item-2', 'list-1', 'sr-2', 1, 'b', 1, '2026-01-01', '2026-01-01')`,
  ).run();
}

const UNKNOWN_SHARE_ID = "AAAAAAAAAAAAAAAAAAAAAAAAAA";

// Captured 404 bodies for the enumeration-resistance comparison.
const bodies: string[] = [];

describe("public share routes (anonymous surface)", () => {
  let db: DatabaseSync;
  let shareId: string;

  beforeEach(() => {
    db = bootstrapDb();
    seedWorld(db);
    const result = publish(OWNER, "list-1");
    if (!result.ok) throw new Error("seed publish failed");
    shareId = result.publication.shareId;
  });

  afterEach(() => teardownDb());

  it("serves the sanitized snapshot to anonymous visitors", async () => {
    const res = await publicRoutes.request(`/public/lists/${shareId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      shareId: string;
      title: string;
      repositoryCount: number;
      availableCount: number;
      items: Array<{ name: string; repositoryId?: string }>;
    };
    expect(body.shareId).toBe(shareId);
    expect(body.title).toBe("Shared Picks");
    expect(body.repositoryCount).toBe(2);
    expect(body.availableCount).toBe(2);
    expect(body.items[0]).toMatchObject({
      name: "hono",
      repositoryId: "repo-1",
    });
    const json = JSON.stringify(body);
    expect(json).not.toContain("private note alpha");
    expect(json).not.toContain("list-1");
  });

  it("answers identical 404 bodies for unknown, revoked and takedown shareIds", async () => {
    revoke(OWNER, { listId: "list-1" });
    for (const id of [UNKNOWN_SHARE_ID, shareId]) {
      const res = await publicRoutes.request(`/public/lists/${id}`);
      expect(res.status).toBe(404);
      const body = (await res.json()) as { code: string; message: string };
      expect(body.code).toBe("NOT_FOUND");
      bodies.push(JSON.stringify(body));
    }
    // Both bodies are byte-identical: shareIds cannot be enumerated.
    expect(bodies[0]).toEqual(bodies[1]);

    const hubRes = await hubRoutes.request(`/hub/lists/${UNKNOWN_SHARE_ID}`);
    expect(hubRes.status).toBe(404);
  });

  it("requires a session to import a shared list", async () => {
    const res = await publicRoutes.request(`/public/lists/${shareId}/import`, {
      method: "POST",
    });
    expect(res.status).toBe(401);
  });

  it("import creates an independent private list, decoupled from the publication", async () => {
    const res = await publicRoutes.request(`/public/lists/${shareId}/import`, {
      method: "POST",
      headers: { cookie: cookieFor(OTHER) },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      listId: string;
      name: string;
      itemCount: number;
    };
    expect(body.name).toBe("Shared Picks (imported)");
    expect(body.itemCount).toBe(2);

    // The imported list belongs to the importing user and mirrors the snapshot.
    const listRes = await listRoutes.request(`/${body.listId}`, {
      headers: { cookie: cookieFor(OTHER) },
    });
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as {
      name: string;
      itemCount: number;
      items: Array<{ repository: { name: string } }>;
    };
    expect(list.itemCount).toBe(2);
    expect(list.items.map((i) => i.repository.name).sort()).toEqual([
      "hono",
      "vitest",
    ]);

    // Mutate the ORIGINAL list afterwards; the imported copy is unaffected.
    db.prepare(
      "UPDATE lists SET name = 'Renamed Original' WHERE id = 'list-1'",
    ).run();
    seedRepository(db, "repo-3", {
      remoteId: "3",
      name: "biome",
      fullName: "biomejs/biome",
    });
    db.prepare(
      `INSERT INTO saved_repositories (id, user_id, repository_id, status, note, version, added_at, updated_at)
       VALUES ('sr-3', ?, 'repo-3', 'saved', NULL, 1, '2026-01-02', '2026-01-02')`,
    ).run(OWNER);
    db.prepare(
      `INSERT INTO list_items (id, list_id, saved_repository_id, position, position_key, version, created_at, updated_at)
       VALUES ('item-3', 'list-1', 'sr-3', 2, 'c', 1, '2026-01-02', '2026-01-02')`,
    ).run();

    const again = await listRoutes.request(`/${body.listId}`, {
      headers: { cookie: cookieFor(OTHER) },
    });
    const copy = (await again.json()) as {
      name: string;
      itemCount: number;
    };
    expect(copy.name).toBe("Shared Picks (imported)");
    expect(copy.itemCount).toBe(2);

    // The owner's session cannot even see the imported copy (ownership).
    const ownerView = await listRoutes.request(`/${body.listId}`, {
      headers: { cookie: cookieFor(OWNER) },
    });
    expect(ownerView.status).toBe(404);
  });

  it("import of an unknown shareId answers the enumeration-safe 404", async () => {
    const res = await publicRoutes.request(
      `/public/lists/${UNKNOWN_SHARE_ID}/import`,
      { method: "POST", headers: { cookie: cookieFor(OTHER) } },
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { message: string };
    const anonRes = await publicRoutes.request(
      `/public/lists/${UNKNOWN_SHARE_ID}`,
    );
    const anonBody = (await anonRes.json()) as { message: string };
    expect(body.message).toEqual(anonBody.message);
  });

  it("accepts reports anonymously (202), validates reason (400), ignores unknown shareIds", async () => {
    const ok = await publicRoutes.request(`/public/lists/${shareId}/report`, {
      method: "POST",
      headers: {
        "X-Forwarded-For": "9.9.9.1",
        "content-type": "application/json",
      },
      body: JSON.stringify({ reason: "spam", detail: "looks automated" }),
    });
    expect(ok.status).toBe(202);

    const bad = await publicRoutes.request(`/public/lists/${shareId}/report`, {
      method: "POST",
      headers: {
        "X-Forwarded-For": "9.9.9.2",
        "content-type": "application/json",
      },
      body: JSON.stringify({ reason: "violence" }),
    });
    expect(bad.status).toBe(400);
    const badBody = (await bad.json()) as { code: string };
    expect(badBody.code).toBe("VALIDATION");

    const unknown = await publicRoutes.request(
      `/public/lists/${UNKNOWN_SHARE_ID}/report`,
      {
        method: "POST",
        headers: {
          "X-Forwarded-For": "9.9.9.3",
          "content-type": "application/json",
        },
        body: JSON.stringify({ reason: "other" }),
      },
    );
    expect(unknown.status).toBe(202);
  });

  it("exposes the same snapshot via the hub detail route", async () => {
    const res = await hubRoutes.request(`/hub/lists/${shareId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { shareId: string; title: string };
    expect(body.shareId).toBe(shareId);
    expect(body.title).toBe("Shared Picks");
  });
});
