// server/routes/appComposition.test.ts
// Regression test for route-composition middleware leakage (found by the
// real-server smoke test): a wildcard `use(requireUser)` inside a sub-app
// mounted at /api intercepts EVERY /api route registered after it, which broke
// the anonymous public/hub surface. This test mounts the routers in the same
// order as server/index.ts and asserts the anonymous paths stay anonymous.

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";
import {
  bootstrapDb,
  seedUser,
  seedRepository,
  teardownDb,
} from "../testing/bootstrap.js";
import { getDb } from "../db.js";
import { publish } from "../services/publication.js";
import { publicationRoutes } from "./publications.js";
import { publicRoutes } from "./public.js";
import { hubRoutes } from "./hub.js";
import { adminRoutes } from "./admin.js";

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

// Same order as server/index.ts.
function buildApp(): Hono {
  const app = new Hono();
  app.route("/api", publicationRoutes);
  app.route("/api", publicRoutes);
  app.route("/api", hubRoutes);
  app.route("/api", adminRoutes);
  return app;
}

const USER = "composer";
let shareId: string;

function seedWorld(): void {
  const db = bootstrapDb();
  seedUser(db, USER, "8100", "composer");
  seedRepository(db, "repo-comp-1", {
    remoteId: "810001",
    name: "comp-repo",
    fullName: "comp/org",
  });
  db.prepare(
    `INSERT INTO saved_repositories (id, user_id, repository_id, status, ai_tags, version, added_at, updated_at)
     VALUES ('sr-comp-1', ?, 'repo-comp-1', 'saved', '[]', 1, '2026-01-01', '2026-01-01')`,
  ).run(USER);
  db.prepare(
    `INSERT INTO lists (id, user_id, name, description, version, created_at, updated_at)
     VALUES ('list-comp-1', ?, 'Composed', '', 1, '2026-01-01', '2026-01-01')`,
  ).run(USER);
  db.prepare(
    `INSERT INTO list_items (id, list_id, saved_repository_id, position, position_key, version, created_at, updated_at)
     VALUES ('item-comp-1', 'list-comp-1', 'sr-comp-1', 0, 'a', 1, '2026-01-01', '2026-01-01')`,
  ).run();

  const result = publish(USER, "list-comp-1");
  if (!result.ok) throw new Error(`publish failed: ${JSON.stringify(result)}`);
  const row = getDb()
    .prepare("SELECT id FROM list_publications WHERE list_id = 'list-comp-1'")
    .get() as unknown as { id: string };
  if (!row) throw new Error("publish reported ok but no publication row");
  shareId = row.id;
}

describe("route composition (index.ts mount order)", () => {
  beforeEach(() => {
    seedWorld();
  });
  afterEach(() => teardownDb());

  it("anonymous hub catalog is reachable through the composed app", async () => {
    const res = await buildApp().request("/api/hub/lists");
    expect(res.status).toBe(200);
    const page = (await res.json()) as { items: Array<{ shareId: string }> };
    expect(page.items.map((i) => i.shareId)).not.toContain(shareId); // not hub-opted-in
  });

  it("anonymous public snapshot is reachable through the composed app", async () => {
    const res = await buildApp().request(`/api/public/lists/${shareId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { shareId: string };
    expect(body.shareId).toBe(shareId);
  });

  it("publication endpoints still require a session through the composed app", async () => {
    const res = await buildApp().request("/api/lists/list-comp-1/publication");
    expect(res.status).toBe(401);
  });

  it("report endpoint stays anonymous through the composed app", async () => {
    const res = await buildApp().request(
      `/api/public/lists/${shareId}/report`,
      {
        method: "POST",
        body: JSON.stringify({ reason: "spam" }),
        headers: { "Content-Type": "application/json" },
      },
    );
    expect(res.status).toBe(202);
  });
});
