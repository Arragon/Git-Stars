import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";

vi.mock("./env.js", () => ({
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
  seedRepository,
  seedUser,
  teardownDb,
} from "./testing/bootstrap.js";
import { libraryRoutes } from "./routes/library.js";
import { listRoutes } from "./routes/lists.js";
import { tagRoutes } from "./routes/tags.js";
import { preferenceRoutes } from "./routes/preferences.js";
import { changesRoutes } from "./routes/changes.js";
import { providerRoutes } from "./routes/providers.js";

type Json = Record<string, never> & unknown;

function authed(
  cookie: string,
  init: RequestInit = {},
  extra: Record<string, string> = {},
): RequestInit {
  return {
    ...init,
    headers: {
      Cookie: cookie,
      ...extra,
      ...(init.headers as Record<string, string> | undefined),
    },
  };
}

const json = (body: unknown): string => JSON.stringify(body);
const CT = { "Content-Type": "application/json" };

describe("M1 domain routes (library/lists/tags/preferences/changes/providers)", () => {
  let db: DatabaseSync;
  let cookieA: string;
  let cookieB: string;

  beforeEach(() => {
    db = bootstrapDb();
    seedUser(db, "u1", "111", "alice");
    seedUser(db, "u2", "222", "bob");
    seedRepository(db, "r1");
    cookieA = cookieFor("u1");
    cookieB = cookieFor("u2");
  });
  afterEach(() => teardownDb());

  const save = async (cookie: string, repositoryId: string, key?: string) => {
    const res = await libraryRoutes.request(
      "/",
      authed(
        cookie,
        { method: "POST", body: json({ repositoryId }) },
        { ...CT, ...(key ? { "Idempotency-Key": key } : {}) },
      ),
    );
    return { status: res.status, body: (await res.json()) as Json };
  };

  it("rejects unauthenticated requests with 401", async () => {
    const res = await libraryRoutes.request("/");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("UNAUTHENTICATED");
  });

  it("saves a repository and lists it with a normalized repository projection", async () => {
    const { status, body } = await save(cookieA, "r1");
    expect(status).toBe(201);
    expect(
      (body as unknown as { repository: { remoteId: string } }).repository
        .remoteId,
    ).toBe("42");

    const listRes = await libraryRoutes.request("/", authed(cookieA));
    const items = (await listRes.json()) as unknown as Array<{ id: string }>;
    expect(items).toHaveLength(1);
  });

  it("honors Idempotency-Key: a replay does not duplicate", async () => {
    await save(cookieA, "r1", "k1");
    await save(cookieA, "r1", "k1");
    const row = db
      .prepare("SELECT COUNT(*) AS n FROM saved_repositories")
      .get() as { n: number };
    expect(Number(row.n)).toBe(1);
  });

  it("returns 409 VERSION_CONFLICT on a stale If-Match update", async () => {
    const { body } = await save(cookieA, "r1");
    const id = (body as unknown as { id: string }).id;
    await libraryRoutes.request(
      `/${id}`,
      authed(cookieA, { method: "PUT", body: json({ note: "first" }) }, CT),
    );
    const stale = await libraryRoutes.request(
      `/${id}`,
      authed(
        cookieA,
        { method: "PUT", body: json({ note: "stale" }) },
        { ...CT, "If-Match": `"${id}:1"` },
      ),
    );
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { code: string }).code).toBe(
      "VERSION_CONFLICT",
    );
  });

  it("enforces ownership: user B cannot read user A saved repository", async () => {
    const { body } = await save(cookieA, "r1");
    const id = (body as unknown as { id: string }).id;
    const res = await libraryRoutes.request(`/${id}`, authed(cookieB));
    expect(res.status).toBe(404);
  });

  it("soft-deletes and emits a change-feed tombstone", async () => {
    const { body } = await save(cookieA, "r1");
    const id = (body as unknown as { id: string }).id;
    const del = await libraryRoutes.request(
      `/${id}`,
      authed(cookieA, { method: "DELETE" }),
    );
    expect(del.status).toBe(200);

    const listRes = await libraryRoutes.request("/", authed(cookieA));
    expect(((await listRes.json()) as unknown[]).length).toBe(0);

    const feedRes = await changesRoutes.request("/", authed(cookieA));
    const feed = (await feedRes.json()) as {
      changes: Array<{ entityType: string; op: string }>;
    };
    expect(
      feed.changes.some(
        (ch) => ch.entityType === "saved_repository" && ch.op === "deleted",
      ),
    ).toBe(true);
  });

  it("creates and attaches a tag", async () => {
    const { body } = await save(cookieA, "r1");
    const id = (body as unknown as { id: string }).id;
    const tagRes = await tagRoutes.request(
      "/",
      authed(cookieA, { method: "POST", body: json({ name: "web" }) }, CT),
    );
    const tag = (await tagRes.json()) as { id: string };
    await libraryRoutes.request(
      `/${id}/tags/${tag.id}`,
      authed(cookieA, { method: "PUT" }),
    );
    const oneRes = await libraryRoutes.request(`/${id}`, authed(cookieA));
    const one = (await oneRes.json()) as { tags: Array<{ name: string }> };
    expect(one.tags.map((t) => t.name)).toContain("web");
  });

  it("list membership is set-semantic and reorderable", async () => {
    seedRepository(db, "r2", { remoteId: "43", name: "x", fullName: "o/x" });
    const s1 = (await save(cookieA, "r1")).body as unknown as { id: string };
    const s2 = (await save(cookieA, "r2")).body as unknown as { id: string };
    const listRes = await listRoutes.request(
      "/",
      authed(cookieA, { method: "POST", body: json({ name: "Faves" }) }, CT),
    );
    const list = (await listRes.json()) as { id: string };

    const putItems = (payload: unknown) =>
      listRoutes.request(
        `/${list.id}/items`,
        authed(cookieA, { method: "PUT", body: json(payload) }, CT),
      );

    await putItems({ add: [s1.id, s2.id] });
    await putItems({ add: [s1.id, s2.id] }); // duplicate add is harmless
    let detail = (await (
      await listRoutes.request(`/${list.id}`, authed(cookieA))
    ).json()) as { items: Array<{ savedRepositoryId: string }> };
    expect(detail.items).toHaveLength(2);

    await putItems({ reorder: [s2.id, s1.id] });
    detail = (await (
      await listRoutes.request(`/${list.id}`, authed(cookieA))
    ).json()) as { items: Array<{ savedRepositoryId: string }> };
    expect(detail.items[0].savedRepositoryId).toBe(s2.id);

    await putItems({ remove: [s1.id] });
    const afterRemove = (await (
      await listRoutes.request(`/${list.id}`, authed(cookieA))
    ).json()) as { items: unknown[] };
    expect(afterRemove.items).toHaveLength(1);
  });

  it("cannot add another user's saved repository to a list", async () => {
    const sA = (await save(cookieA, "r1")).body as unknown as { id: string };
    const listB = (await (
      await listRoutes.request(
        "/",
        authed(cookieB, { method: "POST", body: json({ name: "B" }) }, CT),
      )
    ).json()) as { id: string };
    await listRoutes.request(
      `/${listB.id}/items`,
      authed(cookieB, { method: "PUT", body: json({ add: [sA.id] }) }, CT),
    );
    const detail = (await (
      await listRoutes.request(`/${listB.id}`, authed(cookieB))
    ).json()) as { items: unknown[] };
    expect(detail.items).toHaveLength(0);
  });

  it("preferences shallow-merge and bump version", async () => {
    await preferenceRoutes.request(
      "/",
      authed(
        cookieA,
        { method: "PUT", body: json({ data: { theme: "dark" } }) },
        CT,
      ),
    );
    const res = await preferenceRoutes.request(
      "/",
      authed(
        cookieA,
        { method: "PUT", body: json({ data: { sort: "stars" } }) },
        CT,
      ),
    );
    const body = (await res.json()) as {
      data: Record<string, unknown>;
      version: number;
    };
    expect(body.data).toEqual({ theme: "dark", sort: "stars" });
    expect(body.version).toBe(2);
  });

  it("provider list exposes has_token but never the token itself", async () => {
    const { upsertProviderAccount } = await import("./services/credentials.js");
    upsertProviderAccount({
      userId: "u1",
      providerType: "github",
      host: "github.com",
      remoteUserId: "111",
      remoteUsername: "alice",
      token: "ghp_secret_value",
    });
    const res = await providerRoutes.request("/", authed(cookieA));
    const text = await res.text();
    expect(text).toContain('"has_token":true');
    expect(text).not.toContain("ghp_secret_value");
  });
});
