// server/routes/shareSmoke.test.ts
// Anonymous smoke suite over the seeded Share/Hub fixture environment (INH-524).
// Proves the public surface works without any provider API and that privacy
// boundaries hold — a failure here blocks CI.

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { bootstrapDb, cookieFor, teardownDb } from "../testing/bootstrap.js";
import { getDb } from "../db.js";
import {
  seedShareFixtures,
  type ShareFixtureIds,
} from "../testing/shareFixtures.js";
import { publicRoutes, NOT_FOUND_MESSAGE } from "./public.js";
import { hubRoutes } from "./hub.js";
import { listRoutes } from "./lists.js";

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

const USER = "fixture-owner";
let fixtures: ShareFixtureIds;

describe("Share/Hub anonymous smoke (seeded fixtures)", () => {
  beforeEach(() => {
    bootstrapDb();
    fixtures = seedShareFixtures(USER, cookieFor);
  });
  afterEach(() => teardownDb());

  it("anonymous read works for every active fixture without provider access", async () => {
    for (const shareId of [
      fixtures.hubNormal,
      fixtures.hubEmpty,
      fixtures.hubCrossProvider,
      fixtures.linkOnlyPartial,
    ]) {
      const res = await publicRoutes.request(`/public/lists/${shareId}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { shareId: string; items: unknown[] };
      expect(body.shareId).toBe(shareId);
      expect(Array.isArray(body.items)).toBe(true);
    }
  });

  it("empty fixture returns an empty item list; partial-unavailable marks private items", async () => {
    const empty = (await (
      await publicRoutes.request(`/public/lists/${fixtures.hubEmpty}`)
    ).json()) as { items: unknown[] };
    expect(empty.items).toHaveLength(0);

    const partial = (await (
      await publicRoutes.request(`/public/lists/${fixtures.linkOnlyPartial}`)
    ).json()) as { items: Array<Record<string, unknown>> };
    const unavailable = partial.items.filter((i) => i.unavailable === true);
    expect(unavailable).toHaveLength(1);
    // Unavailable entries leak nothing beyond the marker.
    expect(Object.keys(unavailable[0])).toEqual(["unavailable"]);
  });

  it("link-only publication is NOT in the Hub catalog or search", async () => {
    const res = await hubRoutes.request("/hub/lists");
    const page = (await res.json()) as { items: Array<{ shareId: string }> };
    const ids = page.items.map((i) => i.shareId);
    expect(ids).toContain(fixtures.hubNormal);
    expect(ids).toContain(fixtures.hubEmpty);
    expect(ids).toContain(fixtures.hubCrossProvider);
    expect(ids).not.toContain(fixtures.linkOnlyPartial);
    expect(ids).not.toContain(fixtures.revoked);
    expect(ids).not.toContain(fixtures.takenDown);

    // Search also excludes it (same catalog source).
    const search = await hubRoutes.request("/hub/lists?q=link-only");
    const results = (await search.json()) as {
      items: Array<{ shareId: string }>;
    };
    expect(results.items.map((i) => i.shareId)).not.toContain(
      fixtures.linkOnlyPartial,
    );
  });

  it("revoked, takedown and unknown shareIds answer identical 404s (enumeration resistance)", async () => {
    const bodies: string[] = [];
    for (const shareId of [
      fixtures.revoked,
      fixtures.takenDown,
      "zzzzzzzzzzzzzzzzzzzzzzzzzz",
    ]) {
      const res = await publicRoutes.request(`/public/lists/${shareId}`);
      expect(res.status).toBe(404);
      const body = (await res.json()) as { code: string; message: string };
      expect(body.code).toBe("NOT_FOUND");
      expect(body.message).toBe(NOT_FOUND_MESSAGE);
      bodies.push(body.message);
    }
    expect(new Set(bodies).size).toBe(1);
  });

  it("hub detail answers 404 for revoked/takedown with the same message", async () => {
    for (const shareId of [fixtures.revoked, fixtures.takenDown]) {
      const res = await hubRoutes.request(`/hub/lists/${shareId}`);
      expect(res.status).toBe(404);
    }
  });

  it("public payloads never contain notes, tags, internal ids or credential keys (privacy gate)", async () => {
    const forbidden = [
      "private note",
      "list item note",
      "frontend",
      "sr-fix-",
      "list-fix-",
      USER,
      "note",
      "userId",
      "encrypted_token",
      "access_token",
      "aiTags",
    ];
    for (const shareId of [
      fixtures.hubNormal,
      fixtures.hubEmpty,
      fixtures.hubCrossProvider,
      fixtures.linkOnlyPartial,
    ]) {
      const res = await publicRoutes.request(`/public/lists/${shareId}`);
      const raw = JSON.stringify(await res.json());
      for (const needle of forbidden) {
        expect(raw).not.toContain(needle);
      }
    }
    const catalog = await hubRoutes.request("/hub/lists");
    const raw = JSON.stringify(await catalog.json());
    for (const needle of forbidden) {
      expect(raw).not.toContain(needle);
    }
  });

  it("authenticated copy/import smoke: import creates an independent private list", async () => {
    // Import the hub fixture as a second user (same fixture DB, fresh session).
    const { seedUser } = await import("../testing/bootstrap.js");
    seedUser(getDb(), "importer", "8002", "importer");
    const importerCookie = { headers: { cookie: cookieFor("importer") } };

    const res = await publicRoutes.request(
      `/public/lists/${fixtures.hubNormal}/import`,
      { method: "POST", ...importerCookie },
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { listId: string; name: string };
    expect(body.name).toContain("Fixture: hub normal");

    // The copy is a normal private list of the importer.
    const lists = await listRoutes.request("/", importerCookie);
    const all = (await lists.json()) as Array<{ id: string; name: string }>;
    expect(all.map((l) => l.id)).toContain(body.listId);

    // Owner revokes afterwards: importer's copy is unaffected.
    await publicRoutes.request(`/public/lists/${fixtures.hubNormal}`, {
      method: "GET",
    });
    expect(
      (await publicRoutes.request(`/public/lists/${fixtures.revoked}`)).status,
    ).toBe(404);
  });
});
