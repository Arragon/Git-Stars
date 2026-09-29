import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { buildAccountExport } from "./accountExport.js";
import {
  bootstrapDb,
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

const USER = "export-user";
const OTHER = "other-user";

function seedWorld(): void {
  const db = bootstrapDb();
  seedUser(db, USER, "777", "alice");
  seedUser(db, OTHER, "778", "bob");
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
    `INSERT INTO saved_repositories (id, user_id, repository_id, status, note, ai_tags, version, added_at, updated_at)
     VALUES ('sr-1', ?, 'repo-1', 'saved', 'my private note', '["web"]', 1, '2026-01-01', '2026-01-01')`,
  ).run(USER);
  db.prepare(
    `INSERT INTO saved_repositories (id, user_id, repository_id, status, version, added_at, updated_at)
     VALUES ('sr-2', ?, 'repo-2', 'saved', 1, '2026-01-02', '2026-01-02')`,
  ).run(USER);
  db.prepare(
    `INSERT INTO saved_repositories (id, user_id, repository_id, status, version, added_at, updated_at)
     VALUES ('sr-other', ?, 'repo-2', 'saved', 1, '2026-01-02', '2026-01-02')`,
  ).run(OTHER);
  db.prepare(
    "INSERT INTO tags (id, user_id, name, created_at) VALUES ('tag-1', ?, 'frontend', '2026-01-01')",
  ).run(USER);
  db.prepare(
    "INSERT INTO repository_tags (tag_id, saved_repository_id, created_at) VALUES ('tag-1', 'sr-1', '2026-01-01')",
  ).run();
  db.prepare(
    `INSERT INTO lists (id, user_id, name, description, version, created_at, updated_at)
     VALUES ('list-1', ?, 'Reading list', 'to read', 1, '2026-01-01', '2026-01-01')`,
  ).run(USER);
  db.prepare(
    `INSERT INTO list_items (id, list_id, saved_repository_id, position, position_key, note, version, created_at, updated_at)
     VALUES ('item-1', 'list-1', 'sr-1', 0, 'a', 'item-level note', 1, '2026-01-01', '2026-01-01')`,
  ).run();
  db.prepare(
    `INSERT INTO preferences (user_id, data, version, updated_at)
     VALUES (?, '{"theme":"dark"}', 2, '2026-01-01')`,
  ).run(USER);
  // Provider account with an ENCRYPTED token: the export must include connection
  // metadata but no credential material whatsoever.
  db.prepare(
    `INSERT INTO provider_accounts
       (id, user_id, provider_type, host, remote_user_id, remote_username, status, scopes, encrypted_token, created_at, updated_at)
     VALUES ('pa-1', ?, 'github', 'github.com', '777', 'alice', 'active', 'read:user user:email', 'vault-ciphertext-not-a-real-token', '2026-01-01', '2026-01-01')`,
  ).run(USER);
}

describe("buildAccountExport", () => {
  beforeEach(seedWorld);
  afterEach(() => teardownDb());

  it("exports the full user inventory", () => {
    const doc = buildAccountExport(USER);

    expect(doc.format).toBe("gitstars-account-export");
    expect(doc.schemaVersion).toBe(1);
    expect(doc.profile.username).toBe("alice");
    expect(doc.library).toHaveLength(2);
    expect(doc.library.map((l) => l.repository.name).sort()).toEqual([
      "hono",
      "react",
    ]);
    expect(doc.lists).toHaveLength(1);
    expect(doc.lists[0].items).toHaveLength(1);
    expect(doc.preferences).toEqual({ theme: "dark" });
    expect(doc.providers).toHaveLength(1);
  });

  it("includes user notes and tags (account export is not a public snapshot)", () => {
    const doc = buildAccountExport(USER);
    const hono = doc.library.find((l) => l.repository.name === "hono")!;
    expect(hono.note).toBe("my private note");
    expect(hono.tags).toEqual(["frontend"]);
    expect(doc.lists[0].items[0].note).toBe("item-level note");
  });

  it("never includes provider secrets or credential material", () => {
    const doc = buildAccountExport(USER);
    const serialized = JSON.stringify(doc);
    expect(serialized).not.toContain("encrypted_token");
    expect(serialized).not.toContain("vault-ciphertext-not-a-real-token");
    expect(serialized).not.toContain("access_token");
    expect(doc.providers[0]).toEqual({
      providerType: "github",
      host: "github.com",
      remoteUsername: "alice",
      scopes: "read:user user:email",
      status: "active",
    });
  });

  it("does not include other users' data", () => {
    const doc = buildAccountExport(USER);
    expect(JSON.stringify(doc)).not.toContain("sr-other");
    const other = buildAccountExport(OTHER);
    expect(other.library).toHaveLength(1);
    expect(other.lists).toHaveLength(0);
  });

  it("is stable across repeated invocations (modulo exportedAt)", () => {
    const a = buildAccountExport(USER);
    const b = buildAccountExport(USER);
    a.exportedAt = "";
    b.exportedAt = "";
    expect(a).toEqual(b);
  });
});
