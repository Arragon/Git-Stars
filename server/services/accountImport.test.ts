// server/services/accountImport.test.ts
// M8-09: portable account restore is dry-run first, transactional on apply, preserves
// both note kinds + list order, and never imports inaccessible private repositories.

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import {
  bootstrapDb,
  seedRepository,
  seedUser,
  teardownDb,
} from "../testing/bootstrap.js";
import { buildAccountExport, type AccountExport } from "./accountExport.js";
import { applyAccountImport, planAccountImport } from "./accountImport.js";

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

const OWNER = "owner-user";
const TARGET = "target-user";

function seedWorld(): DatabaseSync {
  const db = bootstrapDb();
  seedUser(db, OWNER, "801", "alice");
  seedUser(db, TARGET, "802", "bob");
  seedRepository(db, "repo-1", {
    remoteId: "1",
    name: "hono",
    fullName: "honojs/hono",
  });
  seedRepository(db, "repo-2", {
    remoteId: "2",
    name: "react",
    fullName: "facebook/react",
  });

  db.prepare(
    `INSERT INTO saved_repositories (id, user_id, repository_id, status, note, ai_summary, ai_tags, version, added_at, updated_at)
     VALUES ('sr-1', ?, 'repo-1', 'saved', 'repo note', 'one line summary', '["web","api"]', 1, '2026-01-01', '2026-01-01')`,
  ).run(OWNER);
  db.prepare(
    `INSERT INTO saved_repositories (id, user_id, repository_id, status, note, ai_tags, version, added_at, updated_at)
     VALUES ('sr-2', ?, 'repo-2', 'saved', NULL, '[]', 1, '2026-01-02', '2026-01-02')`,
  ).run(OWNER);
  db.prepare(
    "INSERT INTO tags (id, user_id, name, created_at) VALUES ('tag-1', ?, 'frontend', '2026-01-01')",
  ).run(OWNER);
  db.prepare(
    "INSERT INTO repository_tags (tag_id, saved_repository_id, created_at) VALUES ('tag-1', 'sr-1', '2026-01-01')",
  ).run();
  db.prepare(
    `INSERT INTO lists (id, user_id, name, description, version, created_at, updated_at)
     VALUES ('list-1', ?, 'Reading list', 'to read', 1, '2026-01-01', '2026-01-01')`,
  ).run(OWNER);
  // Deliberately ordered b then a so position_key (not insertion) defines the order.
  db.prepare(
    `INSERT INTO list_items (id, list_id, saved_repository_id, position, position_key, note, version, created_at, updated_at)
     VALUES ('item-b', 'list-1', 'sr-2', 1, 'b', NULL, 1, '2026-01-01', '2026-01-01')`,
  ).run();
  db.prepare(
    `INSERT INTO list_items (id, list_id, saved_repository_id, position, position_key, note, version, created_at, updated_at)
     VALUES ('item-a', 'list-1', 'sr-1', 0, 'a', 'use for routing', 1, '2026-01-01', '2026-01-01')`,
  ).run();
  db.prepare(
    `INSERT INTO preferences (user_id, data, version, updated_at)
     VALUES (?, '{"theme":"dark"}', 1, '2026-01-01')`,
  ).run(OWNER);
  return db;
}

describe("account import (M8-09)", () => {
  let db: DatabaseSync;
  let bundle: AccountExport;

  beforeEach(() => {
    db = seedWorld();
    bundle = buildAccountExport(OWNER);
  });
  afterEach(() => teardownDb());

  it("plans without writing", () => {
    const before = db
      .prepare("SELECT COUNT(*) AS n FROM saved_repositories WHERE user_id = ?")
      .get(TARGET) as { n: number };
    const plan = planAccountImport(TARGET, bundle);
    expect(plan.ok).toBe(true);
    expect(plan.dryRun).toBe(true);
    expect(plan.counts).toMatchObject({
      savedCreate: 2,
      listsCreate: 1,
      listItems: 2,
      tagsCreate: 1,
      preferences: "apply",
    });
    const after = db
      .prepare("SELECT COUNT(*) AS n FROM saved_repositories WHERE user_id = ?")
      .get(TARGET) as { n: number };
    expect(after.n).toBe(before.n);
  });

  it("restores notes, tags, list order and both note kinds", () => {
    const result = applyAccountImport(TARGET, bundle);
    expect(result.ok, result.errors.join("; ")).toBe(true);

    const saved = db
      .prepare(
        `SELECT r.remote_id AS remote_id, sr.note AS note, sr.ai_summary AS ai_summary
         FROM saved_repositories sr JOIN repositories r ON r.id = sr.repository_id
         WHERE sr.user_id = ? ORDER BY sr.added_at ASC`,
      )
      .all(TARGET) as Array<{
      remote_id: string;
      note: string | null;
      ai_summary: string | null;
    }>;
    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({
      remote_id: "1",
      note: "repo note",
      ai_summary: "one line summary",
    });

    const tag = db
      .prepare(
        `SELECT t.name FROM tags t
         JOIN repository_tags rt ON rt.tag_id = t.id
         JOIN saved_repositories sr ON sr.id = rt.saved_repository_id
         WHERE sr.user_id = ? AND t.user_id = ?`,
      )
      .all(TARGET, TARGET) as Array<{ name: string }>;
    expect(tag.map((t) => t.name)).toEqual(["frontend"]);

    const items = db
      .prepare(
        `SELECT r.remote_id AS remote_id, li.note AS note
         FROM list_items li
         JOIN saved_repositories sr ON sr.id = li.saved_repository_id
         JOIN repositories r ON r.id = sr.repository_id
         JOIN lists l ON l.id = li.list_id
         WHERE l.user_id = ?
         ORDER BY li.position_key ASC, li.position ASC`,
      )
      .all(TARGET) as Array<{ remote_id: string; note: string | null }>;
    expect(items).toEqual([
      { remote_id: "1", note: "use for routing" },
      { remote_id: "2", note: null },
    ]);

    const prefs = db
      .prepare("SELECT data FROM preferences WHERE user_id = ?")
      .get(TARGET) as { data: string } | undefined;
    expect(JSON.parse(prefs!.data)).toEqual({ theme: "dark" });
  });

  it("is idempotent: a second apply does not duplicate saved rows or lists", () => {
    const first = applyAccountImport(TARGET, bundle);
    expect(first.ok, first.errors.join("; ")).toBe(true);
    const second = applyAccountImport(TARGET, bundle);
    expect(second.ok, second.errors.join("; ")).toBe(true);
    const saved = db
      .prepare("SELECT COUNT(*) AS n FROM saved_repositories WHERE user_id = ?")
      .get(TARGET) as { n: number };
    const lists = db
      .prepare("SELECT COUNT(*) AS n FROM lists WHERE user_id = ?")
      .get(TARGET) as { n: number };
    expect(saved.n).toBe(2);
    // Same-name lists are reused, and existing items are not duplicated.
    expect(lists.n).toBe(1);
  });

  it("marks inaccessible private repositories unresolved instead of importing them", () => {
    const crafted = structuredClone(bundle) as AccountExport;
    crafted.library = [
      {
        ...crafted.library[0],
        id: "sr-private",
        repository: {
          ...crafted.library[0].repository,
          remoteId: "999",
          canonicalKey: "github:github.com/alice/secret",
          name: "secret",
          webUrl: "https://github.com/alice/secret",
          visibility: "private",
        },
      },
    ];
    crafted.lists = [];

    const plan = planAccountImport(TARGET, crafted);
    expect(plan.ok).toBe(true);
    expect(plan.counts?.unresolved).toBe(1);
    expect(plan.counts?.savedCreate).toBe(0);
  });

  it("rejects an unsupported schema version", () => {
    const bad = { ...bundle, schemaVersion: 99 };
    const result = planAccountImport(TARGET, bad);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("schemaVersion");
  });
});
