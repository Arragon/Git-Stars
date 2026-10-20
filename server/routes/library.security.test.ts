// server/routes/library.security.test.ts
// M7-07 / INH-1701: knowing a local repository UUID is not authorization. A Saved row
// must never elevate private metadata visibility, and revoking the provider connection
// must stop cached reads immediately. Tests drive the real route composition.
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
  seedUser,
  teardownDb,
} from "../testing/bootstrap.js";
import { getDb } from "../db.js";
import { libraryRoutes } from "./library.js";
import { repositoryRoutes } from "./repositories.js";
import {
  revokeProviderAccount,
  upsertProviderAccount,
} from "../services/credentials.js";
import { importPreview } from "../services/listsIo.js";

const OWNER = "user-alice";
const OTHER = "user-bob";
const PRIVATE_ID = "repo-private-1";
const PRIVATE_NAME = "alice-secret-repo";
const PRIVATE_DESCRIPTION = "confidential-description-xyz";

function seedPrivateRepo(db: DatabaseSync): void {
  db.prepare(
    `INSERT INTO repositories
       (id, provider_type, host, remote_id, canonical_key, namespace_path, name, web_url,
        description, visibility, stars_count, forks_count, status, created_at, updated_at)
     VALUES (?, 'github', 'github.com', '9001', 'github:github.com/alice/secret',
             'alice', ?, 'https://github.com/alice/secret', ?, 'private', 3, 0, 'active',
             '2026-01-01', '2026-01-01')`,
  ).run(PRIVATE_ID, PRIVATE_NAME, PRIVATE_DESCRIPTION);
}

function connectOwner(): string {
  const account = upsertProviderAccount({
    userId: OWNER,
    providerType: "github",
    host: "github.com",
    remoteUserId: "1",
    remoteUsername: "alice",
    token: "owner-token",
  });
  getDb()
    .prepare(
      `INSERT INTO remote_memberships
         (id, user_id, repository_id, provider_account_id, kind, active, first_seen_at, last_seen_at)
       VALUES ('m-owner', ?, ?, ?, 'star', 1, '2026-01-01', '2026-01-01')`,
    )
    .run(OWNER, PRIVATE_ID, account.id);
  return account.id;
}

describe("private repository authorization (M7-07)", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = bootstrapDb();
    seedUser(db, OWNER, "1", "alice");
    seedUser(db, OTHER, "2", "bob");
    seedPrivateRepo(db);
  });

  afterEach(() => {
    teardownDb();
    vi.restoreAllMocks();
  });

  it("refuses to save a private repo the caller cannot access, and leaks no fields", async () => {
    const res = await libraryRoutes.request("/", {
      method: "POST",
      headers: {
        cookie: cookieFor(OTHER),
        "content-type": "application/json",
      },
      body: JSON.stringify({ repositoryId: PRIVATE_ID }),
    });
    expect(res.status).toBe(404);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain(PRIVATE_NAME);
    expect(text).not.toContain(PRIVATE_DESCRIPTION);
    expect(text).not.toContain("github.com/alice/secret");

    // No Saved row was created as a side effect.
    const saved = db
      .prepare("SELECT COUNT(*) AS n FROM saved_repositories WHERE user_id = ?")
      .get(OTHER) as { n: number };
    expect(saved.n).toBe(0);
  });

  it("hides private cached metadata from a viewer who knows the UUID", async () => {
    const res = await repositoryRoutes.request(`/${PRIVATE_ID}`, {
      headers: { cookie: cookieFor(OTHER) },
    });
    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).not.toContain(PRIVATE_DESCRIPTION);
  });

  it("hides legacy Saved rows whose repo the viewer cannot access", async () => {
    // Simulate a row created before the authorization fix.
    db.prepare(
      `INSERT INTO saved_repositories (id, user_id, repository_id, status, version, added_at, updated_at)
       VALUES ('sr-legacy', ?, ?, 'saved', 1, '2026-01-01', '2026-01-01')`,
    ).run(OTHER, PRIVATE_ID);

    const res = await libraryRoutes.request("/", {
      headers: { cookie: cookieFor(OTHER) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(body).toHaveLength(0);
    expect(JSON.stringify(body)).not.toContain(PRIVATE_DESCRIPTION);
  });

  it("lets an owner with a live provider connection read and save the private repo", async () => {
    connectOwner();
    const save = await libraryRoutes.request("/", {
      method: "POST",
      headers: {
        cookie: cookieFor(OWNER),
        "content-type": "application/json",
      },
      body: JSON.stringify({ repositoryId: PRIVATE_ID }),
    });
    expect(save.status).toBe(201);
    const saved = (await save.json()) as {
      repository: { name: string; visibility: string };
    };
    expect(saved.repository.name).toBe(PRIVATE_NAME);
    expect(saved.repository.visibility).toBe("private");

    const view = await repositoryRoutes.request(`/${PRIVATE_ID}`, {
      headers: { cookie: cookieFor(OWNER) },
    });
    expect(view.status).toBe(200);
  });

  it("stops cached reads as soon as the provider connection is revoked", async () => {
    connectOwner();
    const before = await repositoryRoutes.request(`/${PRIVATE_ID}`, {
      headers: { cookie: cookieFor(OWNER) },
    });
    expect(before.status).toBe(200);

    revokeProviderAccount(OWNER, "github", "github.com");

    const after = await repositoryRoutes.request(`/${PRIVATE_ID}`, {
      headers: { cookie: cookieFor(OWNER) },
    });
    expect(after.status).toBe(404);
  });

  it("guards provider-backed readers before any provider call", async () => {
    const res = await repositoryRoutes.request(`/${PRIVATE_ID}/readme`, {
      headers: { cookie: cookieFor(OTHER) },
    });
    expect(res.status).toBe(404);
  });

  it("marks import items the importer cannot access as unresolved", () => {
    const text = JSON.stringify({
      format: "gitstars-list",
      schema_version: 0,
      title: "probe",
      items: [
        {
          source: {
            provider: "github",
            host: "github.com",
            remote_id: "9001",
            path: "alice/secret",
          },
        },
      ],
    });
    const preview = importPreview(OTHER, text);
    expect(preview.ok).toBe(true);
    expect(preview.summary.unresolved).toBe(1);
    expect(preview.summary.new).toBe(0);
  });
});
