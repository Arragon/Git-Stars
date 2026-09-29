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
  teardownDb,
} from "../testing/bootstrap.js";
import { publicationRoutes } from "../routes/publications.js";
import {
  buildSnapshot,
  generateShareId,
  getPublicSnapshot,
  listCatalog,
  publish,
  recordReport,
  revoke,
  setHubOptIn,
  snapshotToPortable,
  takedown,
} from "./publication.js";
import { getDb } from "../db.js";

const OWNER = "user-owner";
const OTHER = "user-bob";

const NOTE_TEXT = "note-should-leak-xyz";
const TAG_NAME = "tag-should-leak-xyz";

function insertRepo(
  db: DatabaseSync,
  id: string,
  provider: string,
  host: string,
  remoteId: string,
  path: string,
  visibility: string | null,
): void {
  db.prepare(
    `INSERT INTO repositories (id, provider_type, host, remote_id, canonical_key, namespace_path, name, web_url, description,
       visibility, primary_language, stars_count, forks_count, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 10, 1, 'active', '2026-01-01', '2026-01-01')`,
  ).run(
    id,
    provider,
    host,
    remoteId,
    `${provider}:${host}/${path}`,
    path.split("/")[0] ?? null,
    path.split("/").pop() ?? path,
    `https://${host}/${path}`,
    `${path} description`,
    visibility,
    "TypeScript",
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

function insertList(
  db: DatabaseSync,
  id: string,
  userId: string,
  name: string,
  description: string,
  updatedAt = "2026-01-01T00:00:00.000Z",
): void {
  db.prepare(
    `INSERT INTO lists (id, user_id, name, description, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, '2026-01-01', ?)`,
  ).run(id, userId, name, description, updatedAt);
}

function insertListItem(
  db: DatabaseSync,
  listId: string,
  savedId: string,
  position: number,
  positionKey: string,
): void {
  db.prepare(
    `INSERT INTO list_items (id, list_id, saved_repository_id, position, position_key, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, '2026-01-01', '2026-01-01')`,
  ).run(randomUUID(), listId, savedId, position, positionKey);
}

// (user_id, repository_id) is UNIQUE: reuse the existing saved row if present.
function savedFor(
  db: DatabaseSync,
  userId: string,
  repositoryId: string,
): string {
  const existing = db
    .prepare(
      "SELECT id FROM saved_repositories WHERE user_id = ? AND repository_id = ?",
    )
    .get(userId, repositoryId) as unknown as { id: string } | undefined;
  if (existing) return existing.id;
  return insertSaved(db, userId, repositoryId, null);
}

// Owner list: [public github, private github, public gitlab] in that order.
function seedWorld(db: DatabaseSync): string {
  seedUser(db, OWNER, "111", "alice");
  seedUser(db, OTHER, "222", "bob");
  insertRepo(
    db,
    "repo-public-1",
    "github",
    "github.com",
    "1",
    "honojs/hono",
    "public",
  );
  insertRepo(
    db,
    "repo-private-1",
    "github",
    "github.com",
    "2",
    "alice/secret",
    "private",
  );
  insertRepo(
    db,
    "repo-gitlab-1",
    "gitlab",
    "gitlab.com",
    "3",
    "group/proj",
    "public",
  );

  const s1 = insertSaved(db, OWNER, "repo-public-1", NOTE_TEXT);
  const s2 = insertSaved(db, OWNER, "repo-private-1", "private note");
  const s3 = insertSaved(db, OWNER, "repo-gitlab-1", null);
  const tagId = randomUUID();
  db.prepare(
    `INSERT INTO tags (id, user_id, name, created_at) VALUES (?, ?, ?, '2026-01-01')`,
  ).run(tagId, OWNER, TAG_NAME);
  db.prepare(
    `INSERT INTO repository_tags (tag_id, saved_repository_id, created_at) VALUES (?, ?, '2026-01-01')`,
  ).run(tagId, s1);

  insertList(db, "list-1", OWNER, "My Reading", "curated picks");
  insertListItem(db, "list-1", s1, 0, "a");
  insertListItem(db, "list-1", s2, 1, "b");
  insertListItem(db, "list-1", s3, 2, "c");
  return "list-1";
}

describe("publication service (M5)", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = bootstrapDb();
    seedWorld(db);
  });

  afterEach(() => teardownDb());

  it("generates 26-char Crockford base32 share ids that are not UUIDs", () => {
    const a = generateShareId();
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(a).not.toMatch(/-/);
    expect(generateShareId()).not.toEqual(a);
  });

  it("builds a sanitized snapshot excluding private repositories with order preserved", () => {
    const snapshot = buildSnapshot(OWNER, "list-1");
    expect(snapshot).not.toBeNull();
    expect(snapshot!.title).toBe("My Reading");
    expect(snapshot!.repositoryCount).toBe(3);
    expect(snapshot!.items).toHaveLength(3);

    const [first, second, third] = snapshot!.items;
    if ("unavailable" in first)
      throw new Error("first item should be available");
    expect(first).toMatchObject({
      providerType: "github",
      host: "github.com",
      remoteId: "1",
      name: "hono",
      starsCount: 10,
    });
    expect(second).toEqual({ unavailable: true });
    if ("unavailable" in third)
      throw new Error("third item should be available");
    expect(third.providerType).toBe("gitlab");

    const json = JSON.stringify(snapshot);
    expect(json).not.toContain(NOTE_TEXT);
    expect(json).not.toContain(TAG_NAME);
    expect(json).not.toContain("repo-public-1");
    expect(json).not.toContain("list-1");
    expect(json).not.toContain(OWNER);
  });

  it("publish -> republish bumps snapshot_version in place, reactivate after revoke", () => {
    const first = publish(OWNER, "list-1");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.mode).toBe("created");
    const shareId = first.publication.shareId;
    expect(first.publication.snapshotVersion).toBe(1);
    expect(first.publication.shareUrl).toBe(`/s/${shareId}`);

    const second = publish(OWNER, "list-1");
    if (!second.ok) return;
    expect(second.mode).toBe("republished");
    expect(second.publication.shareId).toBe(shareId);
    expect(second.publication.snapshotVersion).toBe(2);

    expect(revoke(OWNER, { shareId })).toBe(true);
    expect(getPublicSnapshot(shareId)).toBeNull();

    const third = publish(OWNER, "list-1");
    if (!third.ok) return;
    expect(third.mode).toBe("reactivated");
    expect(third.publication.shareId).toBe(shareId);
    expect(getPublicSnapshot(shareId)).not.toBeNull();
  });

  it("refuses to republish a taken-down publication", () => {
    const first = publish(OWNER, "list-1");
    if (!first.ok) throw new Error("publish failed");
    expect(takedown(first.publication.shareId)).toBe(true);
    const again = publish(OWNER, "list-1");
    expect(again).toEqual({ ok: false, reason: "takedown" });
    expect(getPublicSnapshot(first.publication.shareId)).toBeNull();
  });

  it("publish is idempotent by Idempotency-Key at the route level", async () => {
    const headers = {
      cookie: cookieFor(OWNER),
      "Idempotency-Key": "publish-key-1",
    };
    const res1 = await publicationRoutes.request("/lists/list-1/publication", {
      method: "POST",
      headers,
    });
    expect(res1.status).toBe(201);
    const body1 = (await res1.json()) as {
      shareId: string;
      snapshotVersion: number;
    };

    const res2 = await publicationRoutes.request("/lists/list-1/publication", {
      method: "POST",
      headers,
    });
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as {
      shareId: string;
      snapshotVersion: number;
    };

    expect(body2).toEqual(body1);
    expect(body1.snapshotVersion).toBe(1);

    // A different key republishes for real (snapshot_version bumps).
    const res3 = await publicationRoutes.request("/lists/list-1/publication", {
      method: "POST",
      headers: { cookie: cookieFor(OWNER), "Idempotency-Key": "publish-key-2" },
    });
    expect(res3.status).toBe(200);
    const body3 = (await res3.json()) as { snapshotVersion: number };
    expect(body3.snapshotVersion).toBe(2);
  });

  it("resolves repositoryId at read time and hides everything for unavailable items", () => {
    const { publication } = publish(OWNER, "list-1") as Extract<
      ReturnType<typeof publish>,
      { ok: true }
    >;
    const snap = getPublicSnapshot(publication.shareId);
    expect(snap).not.toBeNull();
    expect(snap!.availableCount).toBe(2);
    const available = snap!.items.filter((i) => !("unavailable" in i));
    expect(available[0]).toMatchObject({
      name: "hono",
      repositoryId: "repo-public-1",
    });
    const unavailable = snap!.items.filter((i) => "unavailable" in i);
    expect(unavailable).toHaveLength(1);
    expect(JSON.stringify(unavailable)).toBe(
      JSON.stringify([{ unavailable: true }]),
    );
  });

  it("gates hub opt-in on an active publication and filters the catalog", () => {
    // No publication yet -> refused.
    expect(setHubOptIn(OWNER, "list-1", true)).toBe(false);

    const { publication } = publish(OWNER, "list-1") as Extract<
      ReturnType<typeof publish>,
      { ok: true }
    >;
    expect(setHubOptIn(OWNER, "list-1", true)).toBe(true);
    expect(getPublicSnapshot(publication.shareId)!.hubOptIn).toBe(true);
    expect(
      listCatalog({}).items.some((i) => i.shareId === publication.shareId),
    ).toBe(true);

    expect(setHubOptIn(OWNER, "list-1", false)).toBe(true);
    expect(
      listCatalog({}).items.some((i) => i.shareId === publication.shareId),
    ).toBe(false);

    // Link-only publications never appear in the catalog.
    expect(setHubOptIn(OWNER, "list-1", true)).toBe(true);
    revoke(OWNER, { listId: "list-1" });
    expect(listCatalog({}).items).toHaveLength(0);
  });

  it("catalog excludes link-only, revoked and takedown publications and matches q", () => {
    // list-1: published, hub opted in.
    publish(OWNER, "list-1");
    setHubOptIn(OWNER, "list-1", true);
    // list-2: published, hub opted in, then revoked.
    insertList(
      db,
      "list-2",
      OWNER,
      "Archived Picks",
      "older",
      "2026-01-02T00:00:00.000Z",
    );
    insertListItem(db, "list-2", savedFor(db, OWNER, "repo-public-1"), 0, "a");
    publish(OWNER, "list-2");
    setHubOptIn(OWNER, "list-2", true);
    revoke(OWNER, { listId: "list-2" });
    // list-3: published, taken down.
    insertList(
      db,
      "list-3",
      OTHER,
      "Bob Picks",
      "bob curates",
      "2026-01-03T00:00:00.000Z",
    );
    insertListItem(db, "list-3", savedFor(db, OTHER, "repo-public-1"), 0, "a");
    const p3 = publish(OTHER, "list-3") as Extract<
      ReturnType<typeof publish>,
      { ok: true }
    >;
    setHubOptIn(OTHER, "list-3", true);
    takedown(p3.publication.shareId);
    // list-4: published but link-only (no hub opt-in).
    insertList(
      db,
      "list-4",
      OTHER,
      "Secret Picks",
      "not in hub",
      "2026-01-04T00:00:00.000Z",
    );
    insertListItem(db, "list-4", savedFor(db, OTHER, "repo-public-1"), 0, "a");
    publish(OTHER, "list-4");

    const page = listCatalog({});
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      title: "My Reading",
      description: "curated picks",
      repositoryCount: 3,
    });
    expect(page.items[0].shareId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();

    // q matches title and description, case-insensitively.
    expect(listCatalog({ q: "reading" }).items).toHaveLength(1);
    expect(listCatalog({ q: "CURATED" }).items).toHaveLength(1);
    expect(listCatalog({ q: "no-such-thing" }).items).toHaveLength(0);
  });

  it("catalog ordering, q and cursor are deterministic", () => {
    const backdate = (shareId: string, t: string) => {
      db.prepare(
        "UPDATE list_publications SET updated_at = ? WHERE id = ?",
      ).run(t, shareId);
    };
    const { publication } = publish(OWNER, "list-1") as Extract<
      ReturnType<typeof publish>,
      { ok: true }
    >;
    setHubOptIn(OWNER, "list-1", true);
    backdate(publication.shareId, "2026-03-04T00:00:00.000Z");
    for (let i = 0; i < 3; i++) {
      const id = `list-det-${i}`;
      insertList(
        db,
        id,
        OWNER,
        `Det List ${i}`,
        "det",
        "2026-01-05T00:00:00.000Z",
      );
      insertListItem(db, id, savedFor(db, OWNER, "repo-public-1"), 0, "a");
      const p = publish(OWNER, id) as Extract<
        ReturnType<typeof publish>,
        { ok: true }
      >;
      setHubOptIn(OWNER, id, true);
      backdate(p.publication.shareId, `2026-02-0${i + 1}T00:00:00.000Z`);
    }

    // Determinism: identical queries return identical pages.
    const a = listCatalog({ limit: 2 });
    const b = listCatalog({ limit: 2 });
    expect(a).toEqual(b);
    expect(a.items).toHaveLength(2);
    expect(a.hasMore).toBe(true);

    // recent sort: updated_at DESC -> My Reading (03-04), Det 2 (02-03), Det 1, Det 0.
    const recent = listCatalog({ sort: "recent", limit: 50 });
    expect(recent.items.map((i) => i.title)).toEqual([
      "My Reading",
      "Det List 2",
      "Det List 1",
      "Det List 0",
    ]);

    // Keyset pagination walks every item exactly once, in order.
    const page1 = listCatalog({ limit: 2 });
    const page2 = listCatalog({ limit: 2, cursor: page1.nextCursor! });
    expect(page1.items.map((i) => i.title)).toEqual([
      "My Reading",
      "Det List 2",
    ]);
    expect(page2.items.map((i) => i.title)).toEqual([
      "Det List 1",
      "Det List 0",
    ]);
    expect(
      new Set([...page1.items, ...page2.items].map((i) => i.shareId)).size,
    ).toBe(4);

    // title sort: NOCASE ascending, deterministic cursor too.
    const titles = listCatalog({ sort: "title", limit: 50 }).items.map(
      (i) => i.title,
    );
    expect(titles).toEqual([
      "Det List 0",
      "Det List 1",
      "Det List 2",
      "My Reading",
    ]);
    const t1 = listCatalog({ sort: "title", limit: 2 });
    const t2 = listCatalog({ sort: "title", limit: 2, cursor: t1.nextCursor! });
    expect([
      ...t1.items.map((i) => i.title),
      ...t2.items.map((i) => i.title),
    ]).toEqual(titles);
  });

  it("privacy scan: no notes, tags, internal ids or forbidden JSON keys anywhere public", () => {
    const { publication } = publish(OWNER, "list-1") as Extract<
      ReturnType<typeof publish>,
      { ok: true }
    >;
    setHubOptIn(OWNER, "list-1", true);

    const snapshotJson = JSON.stringify(getPublicSnapshot(publication.shareId));
    const catalogJson = JSON.stringify(listCatalog({}));
    const everything = snapshotJson + catalogJson;

    expect(everything).not.toContain(NOTE_TEXT);
    expect(everything).not.toContain("private note");
    expect(everything).not.toContain(TAG_NAME);
    expect(everything).not.toContain("list-1");
    expect(everything).not.toContain("list-det-");
    expect(everything).not.toContain(OWNER);
    expect(everything).not.toContain(OTHER);
    expect(everything).not.toContain("sr-");
    // Forbidden JSON keys never appear.
    expect(everything).not.toMatch(/"note"\s*:/);
    expect(everything).not.toMatch(/"userId"\s*:/);
    expect(everything).not.toMatch(/"savedRepositoryId"\s*:/);
  });

  it("records reports with enum validation, capped detail and an anonymous audit event", () => {
    const { publication } = publish(OWNER, "list-1") as Extract<
      ReturnType<typeof publish>,
      { ok: true }
    >;
    expect(recordReport(publication.shareId, "violence")).toBe(
      "invalid_reason",
    );
    expect(recordReport(publication.shareId, "spam", "x".repeat(600))).toBe(
      "ok",
    );
    const report = getDb()
      .prepare(
        "SELECT reason, detail FROM publication_reports ORDER BY created_at DESC, rowid DESC LIMIT 1",
      )
      .get() as unknown as { reason: string; detail: string };
    expect(report.reason).toBe("spam");
    expect(report.detail).toHaveLength(500);

    const audit = getDb()
      .prepare(
        "SELECT actor, action, subject FROM audit_events ORDER BY created_at DESC, rowid DESC LIMIT 1",
      )
      .get() as unknown as { actor: string; action: string; subject: string };
    expect(audit.actor).toBe("anonymous");
    expect(audit.action).toBe("report");
    expect(audit.subject).toBe(publication.shareId);

    // Reports on unknown shareIds are accepted silently (no row, no audit).
    expect(recordReport("AAAAAAAAAAAAAAAAAAAAAAAAAA", "spam")).toBe(
      "not_found",
    );
  });

  it("admin takedown writes an audit event and leaves the source list untouched", () => {
    const { publication } = publish(OWNER, "list-1") as Extract<
      ReturnType<typeof publish>,
      { ok: true }
    >;
    expect(takedown(publication.shareId)).toBe(true);
    const row = getDb()
      .prepare("SELECT status FROM list_publications WHERE id = ?")
      .get(publication.shareId) as unknown as { status: string };
    expect(row.status).toBe("takedown");
    const audit = getDb()
      .prepare(
        "SELECT actor, action FROM audit_events ORDER BY created_at DESC, rowid DESC LIMIT 1",
      )
      .get() as unknown as { actor: string; action: string };
    expect(audit).toEqual({ actor: "admin", action: "takedown" });
    // Source list survives.
    const list = getDb()
      .prepare("SELECT deleted_at FROM lists WHERE id = 'list-1'")
      .get() as unknown as { deleted_at: string | null };
    expect(list.deleted_at).toBeNull();
  });

  it("snapshotToPortable yields a valid PortableList v0 of available items only", () => {
    const { publication } = publish(OWNER, "list-1") as Extract<
      ReturnType<typeof publish>,
      { ok: true }
    >;
    const snap = getPublicSnapshot(publication.shareId)!;
    const doc = snapshotToPortable(snap);
    expect(doc.format).toBe("gitstars-list");
    expect(doc.schema_version).toBe(0);
    expect(doc.title).toBe("My Reading (imported)");
    expect(doc.items).toHaveLength(2);
    expect(doc.items[0].source).toMatchObject({
      provider: "github",
      host: "github.com",
      remote_id: "1",
      path: "honojs/hono",
    });
    const json = JSON.stringify(doc);
    expect(json).not.toContain(NOTE_TEXT);
    expect(json).not.toContain(TAG_NAME);
  });
});
