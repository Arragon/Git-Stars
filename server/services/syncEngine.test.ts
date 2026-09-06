import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
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
import { upsertProviderAccount } from "./credentials.js";
import { syncProvider } from "./syncEngine.js";

const fixtures = JSON.parse(
  readFileSync(
    new URL("../providers/__fixtures__/github/fixtures.json", import.meta.url),
    "utf8",
  ),
) as Record<string, unknown>;

type Route = {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
};
function stubFetch(routes: Array<[string, Route]>): void {
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      for (const [pattern, route] of routes) {
        if (url.includes(pattern)) {
          const body =
            typeof route.body === "string"
              ? route.body
              : JSON.stringify(route.body ?? null);
          return new Response(body, {
            status: route.status,
            headers: {
              "content-type": "application/json",
              ...(route.headers ?? {}),
            },
          });
        }
      }
      return new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  );
}

describe("sync engine invariants (ARCHITECTURE.md 15, ADR-0004)", () => {
  let db: DatabaseSync;
  const count = (table: string): number =>
    Number(
      (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number })
        .n,
    );

  beforeEach(() => {
    db = bootstrapDb();
    seedUser(db, "u1", "111", "alice");
    upsertProviderAccount({
      userId: "u1",
      providerType: "github",
      host: "github.com",
      remoteUserId: "111",
      remoteUsername: "alice",
      token: "tok",
    });
  });
  afterEach(() => {
    teardownDb();
    vi.unstubAllGlobals();
  });

  const starred = (body: unknown): Array<[string, Route]> => [
    ["/user/starred", { status: 200, body }],
    ["/users/alice/repos", { status: 200, body: [] }],
  ];

  it("populates the new domain and is idempotent across re-runs", async () => {
    stubFetch(starred(fixtures.starred));
    const first = await syncProvider("u1", "github");
    expect(first.ok).toBe(true);
    expect(count("repositories")).toBe(1);
    expect(count("saved_repositories")).toBe(1);
    expect(count("remote_memberships")).toBe(1);

    stubFetch(starred(fixtures.starred));
    const second = await syncProvider("u1", "github");
    expect(second.ok).toBe(true);
    expect(count("repositories")).toBe(1);
    expect(count("saved_repositories")).toBe(1);
    expect(count("remote_memberships")).toBe(1);
  });

  it("remote unstar deactivates the membership but preserves the SavedRepository", async () => {
    stubFetch(starred(fixtures.starred));
    await syncProvider("u1", "github");
    expect(count("saved_repositories")).toBe(1);

    stubFetch(starred([])); // repo no longer starred remotely
    const result = await syncProvider("u1", "github");
    expect(result.counts?.deactivated).toBe(1);
    expect(count("saved_repositories")).toBe(1); // knowledge preserved
    const membership = db
      .prepare("SELECT active FROM remote_memberships")
      .get() as { active: number };
    expect(membership.active).toBe(0);
  });

  it("a fetch failure does not advance sync state or write partial data", async () => {
    stubFetch([
      [
        "/user/starred",
        {
          status: 403,
          headers: { "x-ratelimit-remaining": "0" },
          body: { message: "API rate limit exceeded" },
        },
      ],
      ["/users/alice/repos", { status: 200, body: [] }],
    ]);
    const result = await syncProvider("u1", "github");
    expect(result.ok).toBe(false);
    expect(result.code).toBe("RATE_LIMITED");
    expect(count("sync_states")).toBe(0);
    expect(count("saved_repositories")).toBe(0);
    expect(count("repositories")).toBe(0);
  });

  it("records sync state after a successful run", async () => {
    stubFetch(starred(fixtures.starred));
    await syncProvider("u1", "github");
    expect(count("sync_states")).toBeGreaterThan(0);
  });

  it("does NOT deactivate memberships when the remote fetch is truncated at the page cap", async () => {
    // Seed an active star membership for a repo that will NOT appear in the fetched pages.
    const acct = (
      db
        .prepare(
          "SELECT id FROM provider_accounts WHERE user_id='u1' AND provider_type='github'",
        )
        .get() as { id: string }
    ).id;
    db.prepare(
      `INSERT INTO repositories (id, provider_type, host, remote_id, canonical_key, name, web_url, visibility, stars_count, forks_count, status, created_at, updated_at)
       VALUES ('rx','github','github.com','rx','github:github.com/o/rx','rx','https://github.com/o/rx','public',0,0,'active','2026-01-01','2026-01-01')`,
    ).run();
    db.prepare(
      `INSERT INTO remote_memberships (id, user_id, repository_id, provider_account_id, kind, active, first_seen_at, last_seen_at)
       VALUES ('mx','u1','rx',?,'star',1,'2026-01-01','2026-01-01')`,
    ).run(acct);

    // A full 100-item page on every request forces pagination to MAX_PAGES -> truncated.
    const bigPage = Array.from({ length: 100 }, (_, i) => ({
      starred_at: "2026-01-01T00:00:00Z",
      repo: {
        id: 1000 + i,
        name: `r${i}`,
        full_name: `o/r${i}`,
        html_url: `https://github.com/o/r${i}`,
        stargazers_count: 0,
        forks_count: 0,
        private: false,
        owner: { login: "o" },
      },
    }));
    stubFetch([
      ["/user/starred", { status: 200, body: bigPage }],
      ["/users/alice/repos", { status: 200, body: [] }],
    ]);

    const result = await syncProvider("u1", "github");
    expect(result.ok).toBe(true);
    const membership = db
      .prepare("SELECT active FROM remote_memberships WHERE id='mx'")
      .get() as { active: number };
    expect(membership.active).toBe(1); // not falsely deactivated by a truncated reconcile
  });
});
