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
import { getRepositoryView } from "./repository.js";

function insertRepo(db: DatabaseSync, id: string, visibility: string): void {
  db.prepare(
    `INSERT INTO repositories (id, provider_type, host, remote_id, canonical_key, name, web_url, visibility,
       stars_count, forks_count, status, created_at, updated_at)
     VALUES (?, 'github', 'github.com', ?, ?, ?, ?, ?, 0, 0, 'active', '2026-01-01', '2026-01-01')`,
  ).run(
    id,
    id,
    `github:github.com/x/${id}`,
    id,
    `https://github.com/x/${id}`,
    visibility,
  );
}

function insertSaved(
  db: DatabaseSync,
  userId: string,
  repositoryId: string,
): void {
  db.prepare(
    `INSERT INTO saved_repositories (id, user_id, repository_id, status, version, added_at, updated_at)
     VALUES (?, ?, ?, 'saved', 1, '2026-01-01', '2026-01-01')`,
  ).run(randomUUID(), userId, repositoryId);
}

describe("repository visibility gate (ADR-0005 D4)", () => {
  let db: DatabaseSync;
  beforeEach(() => {
    db = bootstrapDb();
    seedUser(db, "u1", "1", "alice");
    seedUser(db, "u2", "2", "bob");
  });
  afterEach(() => teardownDb());

  it("public repository metadata is visible to any authenticated user", () => {
    insertRepo(db, "pub1", "public");
    expect(getRepositoryView("pub1", "u2")).not.toBeNull();
  });

  it("private repository metadata is hidden (404) from a user with no link", () => {
    insertRepo(db, "priv1", "private");
    expect(getRepositoryView("priv1", "u2")).toBeNull();
  });

  it("private repository metadata is visible to the user who saved it, still hidden from others", () => {
    insertRepo(db, "priv1", "private");
    insertSaved(db, "u1", "priv1");
    expect(getRepositoryView("priv1", "u1")).not.toBeNull();
    expect(getRepositoryView("priv1", "u2")).toBeNull();
  });
});
