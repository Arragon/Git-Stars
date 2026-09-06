import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
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

import { bootstrapDb, seedUser, teardownDb } from "../testing/bootstrap.js";
import { exportList, importCommit, importPreview } from "./listsIo.js";
import {
  LIST_FORMAT,
  LIST_SCHEMA_VERSION,
  validateListExport,
} from "../../src/lib/list-format.js";

function insertRepo(
  db: DatabaseSync,
  id: string,
  provider: string,
  host: string,
  remoteId: string,
  path: string,
  visibility: string,
): void {
  db.prepare(
    `INSERT INTO repositories (id, provider_type, host, remote_id, canonical_key, namespace_path, name, web_url,
       visibility, stars_count, forks_count, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 10, 1, 'active', '2026-01-01', '2026-01-01')`,
  ).run(
    id,
    provider,
    host,
    remoteId,
    `${provider}:${host}/${path}`,
    path.split("/")[0] ?? null,
    path.split("/").pop() ?? path,
    `https://${host}/${path}`,
    visibility,
  );
}

function insertSaved(
  db: DatabaseSync,
  userId: string,
  repositoryId: string,
  note: string | null,
): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO saved_repositories (id, user_id, repository_id, status, note, version, added_at, updated_at)
     VALUES (?, ?, ?, 'saved', ?, 1, '2026-01-01', '2026-01-01')`,
  ).run(id, userId, repositoryId, note);
  return id;
}

describe("List export/import round-trip (INH-384/402/515)", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = bootstrapDb();
    seedUser(db, "u1", "111", "alice");
    seedUser(db, "u2", "222", "bob");
    insertRepo(db, "r1", "github", "github.com", "1", "honojs/hono", "public");
    insertRepo(
      db,
      "rpriv",
      "github",
      "github.com",
      "99",
      "alice/secret",
      "private",
    );
    insertRepo(db, "rgl", "gitlab", "gitlab.com", "77", "group/proj", "public");
  });
  afterEach(() => teardownDb());

  function buildList(): string {
    const listId = randomUUID();
    db.prepare(
      `INSERT INTO lists (id, user_id, name, description, version, created_at, updated_at) VALUES (?, 'u1', 'Mixed', '', 1, '2026-01-01', '2026-01-01')`,
    ).run(listId);
    const s1 = insertSaved(db, "u1", "r1", "great framework");
    const sPriv = insertSaved(db, "u1", "rpriv", "private note");
    const sGl = insertSaved(db, "u1", "rgl", null);
    const tagId = randomUUID();
    db.prepare(
      `INSERT INTO tags (id, user_id, name, created_at) VALUES (?, 'u1', 'web', '2026-01-01')`,
    ).run(tagId);
    db.prepare(
      `INSERT INTO repository_tags (tag_id, saved_repository_id, created_at) VALUES (?, ?, '2026-01-01')`,
    ).run(tagId, s1);
    [
      [s1, 0],
      [sPriv, 1],
      [sGl, 2],
    ].forEach(([savedId, pos]) => {
      db.prepare(
        `INSERT INTO list_items (id, list_id, saved_repository_id, position, version, created_at, updated_at) VALUES (?, ?, ?, ?, 1, '2026-01-01', '2026-01-01')`,
      ).run(randomUUID(), listId, savedId as string, pos as number);
    });
    return listId;
  }

  it("exports a sanitized, mixed-provider list and excludes private repositories", () => {
    const listId = buildList();
    const doc = exportList("u1", listId);
    expect(doc).not.toBeNull();
    expect(doc!.format).toBe(LIST_FORMAT);
    expect(doc!.schema_version).toBe(LIST_SCHEMA_VERSION);
    // 3 items in the list, but the private repo must be excluded -> 2 portable items
    expect(doc!.items).toHaveLength(2);
    const providers = doc!.items.map((i) => i.source.provider).sort();
    expect(providers).toEqual(["github", "gitlab"]);
    expect(JSON.stringify(doc)).not.toContain("alice/secret");
    expect(JSON.stringify(doc)).not.toContain("private note");
    expect(validateListExport(doc).ok).toBe(true);
    // no forbidden fields anywhere
    const raw = JSON.stringify(doc);
    for (const forbidden of [
      "user_id",
      "saved_repository_id",
      "repository_id",
      "access_token",
    ]) {
      expect(raw).not.toContain(forbidden);
    }
  });

  it("previews an import without mutating, then commits idempotently", () => {
    const doc = exportList("u1", buildList())!;
    const text = JSON.stringify(doc);

    const preview = importPreview("u2", text);
    expect(preview.ok).toBe(true);
    expect(preview.summary.new).toBe(2);
    expect(preview.summary.total).toBe(2);
    // preview must not mutate
    expect(
      Number(
        (
          db
            .prepare(
              "SELECT COUNT(*) n FROM saved_repositories WHERE user_id = ?",
            )
            .get("u2") as { n: number }
        ).n,
      ),
    ).toBe(0);

    const first = importCommit("u2", text, { listName: "Imported" });
    expect(first.ok).toBe(true);
    expect(first.counts?.imported).toBe(2);
    expect(
      Number(
        (
          db
            .prepare(
              "SELECT COUNT(*) n FROM saved_repositories WHERE user_id = ?",
            )
            .get("u2") as { n: number }
        ).n,
      ),
    ).toBe(2);

    // re-import the same list: no duplicates
    const second = importCommit("u2", text, { listName: "Imported" });
    expect(second.counts?.imported).toBe(0);
    expect(second.counts?.existing).toBe(2);
    expect(
      Number(
        (
          db
            .prepare(
              "SELECT COUNT(*) n FROM saved_repositories WHERE user_id = ?",
            )
            .get("u2") as { n: number }
        ).n,
      ),
    ).toBe(2);
    expect(
      Number(
        (db.prepare("SELECT COUNT(*) n FROM list_items").get() as { n: number })
          .n,
      ),
    ).toBe(3 + 2); // u1's 3 + u2's 2
  });

  it("retains unknown-provider items as unresolved instead of discarding them", () => {
    const text = JSON.stringify({
      format: LIST_FORMAT,
      schema_version: 0,
      title: "Unknown",
      items: [
        {
          source: {
            provider: "bitbucket",
            host: "bitbucket.org",
            remote_id: "abc",
            path: "team/repo",
          },
        },
      ],
    });
    const preview = importPreview("u2", text);
    expect(preview.summary.unresolved).toBe(1);
    const result = importCommit("u2", text);
    expect(result.counts?.unresolved).toBe(1);
    const repo = db
      .prepare(
        `SELECT status FROM repositories WHERE provider_type = 'bitbucket'`,
      )
      .get() as { status: string };
    expect(repo.status).toBe("unresolved");
    expect(
      Number(
        (
          db
            .prepare(
              "SELECT COUNT(*) n FROM saved_repositories WHERE user_id = ?",
            )
            .get("u2") as { n: number }
        ).n,
      ),
    ).toBe(1);
  });

  it("rejects malformed and oversized payloads without mutating", () => {
    expect(importPreview("u2", '{"bad":true}').ok).toBe(false);
    expect(importPreview("u2", "not json").ok).toBe(false);
    const forbiddenField = JSON.stringify({
      format: LIST_FORMAT,
      schema_version: 0,
      title: "x",
      items: [
        { source: { provider: "github", remote_id: "1" }, user_id: "leak" },
      ],
    });
    expect(importPreview("u2", forbiddenField).ok).toBe(false);
    expect(importCommit("u2", forbiddenField).ok).toBe(false);
    expect(
      Number(
        (
          db
            .prepare(
              "SELECT COUNT(*) n FROM saved_repositories WHERE user_id = ?",
            )
            .get("u2") as { n: number }
        ).n,
      ),
    ).toBe(0);
  });
});
