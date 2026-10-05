import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { getDb } from "../db.js";
import { recordChange } from "../services/mutations.js";
import { changesRoutes } from "./changes.js";
import {
  bootstrapDb,
  cookieFor,
  seedUser,
  seedRepository,
  teardownDb,
} from "../testing/bootstrap.js";

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

const USER = "user-1";

function seedWorld(db: DatabaseSync): void {
  seedUser(db, USER, "1", "alice");
  seedRepository(db, "repo-1");
  db.prepare(
    `INSERT INTO saved_repositories (id, user_id, repository_id, status, note, ai_tags, version, added_at, updated_at)
     VALUES ('sr-1', ?, 'repo-1', 'saved', 'my note', '["web"]', 2, '2026-01-01', '2026-01-02')`,
  ).run(USER);
  db.prepare(
    `INSERT INTO lists (id, user_id, name, description, version, created_at, updated_at)
     VALUES ('list-1', ?, 'Reading list', '', 1, '2026-01-01', '2026-01-01')`,
  ).run(USER);
  db.prepare(
    `INSERT INTO list_items (id, list_id, saved_repository_id, position, position_key, version, created_at, updated_at)
     VALUES ('item-1', 'list-1', 'sr-1', 0, 'a', 1, '2026-01-01', '2026-01-01')`,
  ).run();
  db.prepare(
    `INSERT INTO tags (id, user_id, name, created_at)
     VALUES ('tag-1', ?, 'frontend', '2026-01-01')`,
  ).run(USER);
  db.prepare(
    `INSERT INTO repository_tags (tag_id, saved_repository_id, created_at)
     VALUES ('tag-1', 'sr-1', '2026-01-01')`,
  ).run();
  db.prepare(
    `INSERT INTO preferences (user_id, data, version, updated_at)
     VALUES (?, '{"theme":"dark"}', 3, '2026-01-01')`,
  ).run(USER);
}

describe("GET /api/changes", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = bootstrapDb();
    seedWorld(db);
  });

  afterEach(() => {
    teardownDb();
  });

  it("returns 401 without a session", async () => {
    const res = await changesRoutes.request("/");
    expect(res.status).toBe(401);
  });

  it("attaches sanitized payloads for every user-state entity type", async () => {
    recordChange(USER, "saved_repository", "sr-1", "updated", 2);
    recordChange(USER, "list", "list-1", "created", 1);
    recordChange(USER, "list_item", "item-1", "created", 1);
    recordChange(USER, "tag", "tag-1", "created", 1);
    recordChange(USER, "repository_tag", "sr-1:tag-1", "created", 1);
    recordChange(USER, "preference", USER, "updated", 3);

    const res = await changesRoutes.request("/", {
      headers: { cookie: cookieFor(USER) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      changes: Array<{
        seq: number;
        entityType: string;
        entityId: string;
        op: string;
        data: Record<string, unknown> | null;
      }>;
      nextCursor: number;
      hasMore: boolean;
      protocolVersion: number;
    };

    expect(body.changes).toHaveLength(6);
    expect(body.hasMore).toBe(false);
    expect(body.protocolVersion).toBe(1);

    const byEntity = new Map(body.changes.map((ch) => [ch.entityType, ch]));

    const sr = byEntity.get("saved_repository")!;
    expect(sr.data).toMatchObject({
      repositoryId: "repo-1",
      status: "saved",
      note: "my note",
      aiTags: ["web"],
      version: 2,
      etag: '"sr-1:2"',
    });

    const list = byEntity.get("list")!;
    expect(list.data).toMatchObject({
      name: "Reading list",
      version: 1,
      etag: '"list-1:1"',
    });

    const item = byEntity.get("list_item")!;
    expect(item.data).toMatchObject({
      listId: "list-1",
      savedRepositoryId: "sr-1",
      position: "a",
    });

    const tag = byEntity.get("tag")!;
    expect(tag.data).toMatchObject({ name: "frontend" });

    const repoTag = byEntity.get("repository_tag")!;
    expect(repoTag.data).toMatchObject({
      savedRepositoryId: "sr-1",
      tagId: "tag-1",
    });

    const pref = byEntity.get("preference")!;
    expect(pref.data).toMatchObject({
      data: { theme: "dark" },
      version: 3,
      etag: `"${USER}:3"`,
    });
  });

  it("hard-deleted rows get data:null and tombstones carry deletedAt", async () => {
    const d = getDb();
    // Tombstone a saved_repository (row remains).
    d.prepare(
      "UPDATE saved_repositories SET deleted_at = '2026-01-03', version = 3 WHERE id = 'sr-1'",
    ).run();
    recordChange(USER, "saved_repository", "sr-1", "deleted", 3);
    // Hard-delete a list_item (row removed by DELETE FROM).
    d.prepare("DELETE FROM list_items WHERE id = 'item-1'").run();
    recordChange(USER, "list_item", "item-1", "deleted", 0);
    // Hard-delete a repository_tag join.
    d.prepare(
      "DELETE FROM repository_tags WHERE tag_id = 'tag-1' AND saved_repository_id = 'sr-1'",
    ).run();
    recordChange(USER, "repository_tag", "sr-1:tag-1", "deleted", 0);

    const res = await changesRoutes.request("/", {
      headers: { cookie: cookieFor(USER) },
    });
    const body = (await res.json()) as {
      changes: Array<{
        entityType: string;
        data: Record<string, unknown> | null;
      }>;
    };
    const byEntity = new Map(body.changes.map((ch) => [ch.entityType, ch]));

    expect(byEntity.get("saved_repository")!.data).toMatchObject({
      deletedAt: "2026-01-03",
      version: 3,
    });
    expect(byEntity.get("list_item")!.data).toBeNull();
    // Deleted join reconstructs the client composite key from the entityId.
    expect(byEntity.get("repository_tag")!.data).toEqual({
      savedRepositoryId: "sr-1",
      tagId: "tag-1",
    });
  });

  it("rejects a cursor ahead of the feed tail with 410 CURSOR_INVALID", async () => {
    recordChange(USER, "tag", "tag-1", "created", 1);
    const res = await changesRoutes.request("/?since=99999", {
      headers: { cookie: cookieFor(USER) },
    });
    expect(res.status).toBe(410);
    const body = (await res.json()) as {
      code: string;
      details: { current: number };
    };
    expect(body.code).toBe("CURSOR_INVALID");
    expect(body.details.current).toBe(1);
  });

  it("respects the since cursor and limit pagination", async () => {
    for (let i = 0; i < 5; i++) {
      recordChange(USER, "tag", `tag-${i}`, "created", 1);
    }
    const res = await changesRoutes.request("/?since=2&limit=2", {
      headers: { cookie: cookieFor(USER) },
    });
    const body = (await res.json()) as {
      changes: Array<{ seq: number }>;
      hasMore: boolean;
      nextCursor: number;
    };
    expect(body.changes.map((c) => c.seq)).toEqual([3, 4]);
    expect(body.hasMore).toBe(true);
    expect(body.nextCursor).toBe(4);
  });
});
