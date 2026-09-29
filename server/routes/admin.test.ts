import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";

// Mutable env mock: the admin token is configured mid-file so the same suite
// covers ADMIN_NOT_CONFIGURED (503), wrong token (401) and success (200).
const envState = vi.hoisted(() => ({ adminToken: "" }));

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
    get adminToken() {
      return envState.adminToken;
    },
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
import { adminRoutes } from "./admin.js";
import { publicRoutes } from "./public.js";
import { listRoutes } from "./lists.js";
import { publish } from "../services/publication.js";
import { getDb } from "../db.js";

const OWNER = "user-owner";
const ADMIN_TOKEN = "unit-test-admin-token";

describe("admin takedown route", () => {
  let db: DatabaseSync;
  let shareId: string;

  beforeEach(() => {
    envState.adminToken = "";
    db = bootstrapDb();
    seedUser(db, OWNER, "111", "alice");
    seedRepository(db, "repo-1", { remoteId: "1" });
    db.prepare(
      `INSERT INTO saved_repositories (id, user_id, repository_id, status, note, version, added_at, updated_at)
       VALUES ('sr-1', ?, 'repo-1', 'saved', NULL, 1, '2026-01-01', '2026-01-01')`,
    ).run(OWNER);
    db.prepare(
      `INSERT INTO lists (id, user_id, name, description, version, created_at, updated_at)
       VALUES ('list-1', ?, 'Shared', '', 1, '2026-01-01', '2026-01-01')`,
    ).run(OWNER);
    db.prepare(
      `INSERT INTO list_items (id, list_id, saved_repository_id, position, position_key, version, created_at, updated_at)
       VALUES ('item-1', 'list-1', 'sr-1', 0, 'a', 1, '2026-01-01', '2026-01-01')`,
    ).run();
    const result = publish(OWNER, "list-1");
    if (!result.ok) throw new Error("seed publish failed");
    shareId = result.publication.shareId;
  });

  afterEach(() => {
    teardownDb();
    envState.adminToken = "";
  });

  it("answers 503 ADMIN_NOT_CONFIGURED when ADMIN_TOKEN is empty", async () => {
    const res = await adminRoutes.request(
      `/admin/publications/${shareId}/takedown`,
      { method: "POST", headers: { authorization: `Bearer ${ADMIN_TOKEN}` } },
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("ADMIN_NOT_CONFIGURED");
  });

  it("rejects a wrong bearer token with 401 UNAUTHENTICATED", async () => {
    envState.adminToken = ADMIN_TOKEN;
    const res = await adminRoutes.request(
      `/admin/publications/${shareId}/takedown`,
      { method: "POST", headers: { authorization: "Bearer wrong-token" } },
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("UNAUTHENTICATED");
  });

  it("takes the publication down with the correct token without touching the source list", async () => {
    envState.adminToken = ADMIN_TOKEN;
    const res = await adminRoutes.request(
      `/admin/publications/${shareId}/takedown`,
      { method: "POST", headers: { authorization: `Bearer ${ADMIN_TOKEN}` } },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    // Publication row is marked takedown; the anonymous snapshot 404s.
    const row = getDb()
      .prepare("SELECT status FROM list_publications WHERE id = ?")
      .get(shareId) as unknown as { status: string };
    expect(row.status).toBe("takedown");
    const anon = await publicRoutes.request(`/public/lists/${shareId}`);
    expect(anon.status).toBe(404);

    // The private source list is NEVER touched: owner still reads it normally.
    const listRes = await listRoutes.request("/list-1", {
      headers: { cookie: cookieFor(OWNER) },
    });
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as { name: string; itemCount: number };
    expect(list.name).toBe("Shared");
    expect(list.itemCount).toBe(1);

    // Audit event written with the admin actor.
    const audit = getDb()
      .prepare(
        "SELECT actor, action, subject FROM audit_events ORDER BY created_at DESC, rowid DESC LIMIT 1",
      )
      .get() as unknown as { actor: string; action: string; subject: string };
    expect(audit).toEqual({
      actor: "admin",
      action: "takedown",
      subject: shareId,
    });
  });

  it("returns 404 NOT_FOUND for an unknown shareId with a valid token", async () => {
    envState.adminToken = ADMIN_TOKEN;
    const res = await adminRoutes.request(
      "/admin/publications/AAAAAAAAAAAAAAAAAAAAAAAAAA/takedown",
      { method: "POST", headers: { authorization: `Bearer ${ADMIN_TOKEN}` } },
    );
    expect(res.status).toBe(404);
  });
});
