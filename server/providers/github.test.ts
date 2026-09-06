import { describe, expect, it, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { githubProvider } from "./github/index.js";
import { gitlabProvider } from "./gitlab/index.js";
import { giteeProvider } from "./gitee/index.js";
import { ProviderError } from "./types.js";

// Deterministic adapter conformance tests (ADR-0007 D2): global fetch is mocked with fixtures,
// so no real network is used.

const fixtures = JSON.parse(
  readFileSync(
    new URL("./__fixtures__/github/fixtures.json", import.meta.url),
    "utf8",
  ),
) as Record<string, unknown>;

type Route = {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
};

function stubFetch(routes: Array<[string, Route]>): void {
  const fn = async (input: RequestInfo | URL): Promise<Response> => {
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
    return new Response("null", {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  };
  vi.stubGlobal("fetch", fn);
}

afterEach(() => vi.unstubAllGlobals());

const ctx = {
  providerType: "github",
  host: "github.com",
  token: "tok",
  remoteUsername: "alice",
};
const id1 = { providerType: "github", host: "github.com", remoteId: "1" };

describe("github adapter normalization", () => {
  it("normalizes a repository snapshot", async () => {
    stubFetch([
      ["/repositories/1", { status: 200, body: fixtures.repoSuccess }],
    ]);
    const snap = await githubProvider.fetchRepository(id1, ctx);
    expect(snap.identity.remoteId).toBe("1");
    expect(snap.name).toBe("hono");
    expect(snap.namespacePath).toBe("honojs");
    expect(snap.visibility).toBe("public");
    expect(snap.canonicalKey).toBe("github:github.com/honojs/hono");
    expect(snap.starsCount).toBe(20000);
  });

  it("maps a private repository visibility", async () => {
    stubFetch([
      ["/repositories/2", { status: 200, body: fixtures.repoPrivate }],
    ]);
    const snap = await githubProvider.fetchRepository(
      { providerType: "github", host: "github.com", remoteId: "2" },
      ctx,
    );
    expect(snap.visibility).toBe("private");
  });

  it("keeps identity stable across a rename (same remoteId)", async () => {
    stubFetch([
      ["/repositories/1", { status: 200, body: fixtures.repoRenamed }],
    ]);
    const snap = await githubProvider.fetchRepository(id1, ctx);
    expect(snap.identity.remoteId).toBe("1");
    expect(snap.name).toBe("hono-renamed");
  });

  it("normalizes starred memberships", async () => {
    stubFetch([["/user/starred", { status: 200, body: fixtures.starred }]]);
    const page = await githubProvider.listMemberships(ctx, "star");
    expect(page.items).toHaveLength(1);
    expect(page.items[0].kind).toBe("star");
    expect(page.items[0].identity.remoteId).toBe("1");
    expect(page.items[0].remoteCreatedAt).toBe("2026-01-02T00:00:00Z");
  });

  it("normalizes search results", async () => {
    stubFetch([
      ["/search/repositories", { status: 200, body: fixtures.search }],
    ]);
    const page = await githubProvider.search!("hono", ctx);
    expect(page.total).toBe(1);
    expect(page.items[0].name).toBe("hono");
  });

  it("normalizes releases with downloadable assets", async () => {
    stubFetch([
      ["/repositories/1", { status: 200, body: fixtures.repoSuccess }],
      ["/repos/honojs/hono/releases", { status: 200, body: fixtures.releases }],
    ]);
    const page = await githubProvider.listReleases!(id1, ctx);
    expect(page.items[0].tagName).toBe("v1.0.0");
    expect(page.items[0].assets[0].downloadRef).toContain(
      "/releases/assets/555",
    );
  });
});

describe("github adapter error classification", () => {
  it("classifies 404 as NOT_FOUND", async () => {
    stubFetch([
      ["/repositories/999", { status: 404, body: { message: "Not Found" } }],
    ]);
    await expect(
      githubProvider.fetchRepository(
        { providerType: "github", host: "github.com", remoteId: "999" },
        ctx,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("classifies 403 with x-ratelimit-remaining:0 as RATE_LIMITED (retryable)", async () => {
    stubFetch([
      [
        "/repositories/1",
        {
          status: 403,
          headers: {
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": "1893456000",
          },
          body: { message: "API rate limit exceeded" },
        },
      ],
    ]);
    const err = await githubProvider
      .fetchRepository(id1, ctx)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).code).toBe("RATE_LIMITED");
    expect((err as ProviderError).retryable).toBe(true);
  });

  it("classifies 403 without rate-limit signals as FORBIDDEN (not every 403 is a rate limit)", async () => {
    stubFetch([
      [
        "/repositories/1",
        {
          status: 403,
          headers: { "x-ratelimit-remaining": "50" },
          body: { message: "Resource not accessible by integration" },
        },
      ],
    ]);
    const err = await githubProvider
      .fetchRepository(id1, ctx)
      .catch((e: unknown) => e);
    expect((err as ProviderError).code).toBe("FORBIDDEN");
  });

  it("classifies 401 as UNAUTHORIZED (not retryable)", async () => {
    stubFetch([
      ["/repositories/1", { status: 401, body: fixtures.unauthorized }],
    ]);
    const err = await githubProvider
      .fetchRepository(id1, ctx)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).code).toBe("UNAUTHORIZED");
    expect((err as ProviderError).retryable).toBe(false);
  });

  it("returns nextCursor when a membership page is full (pagination signal)", async () => {
    // Build a full page of PER_PAGE (100) starred entries so the adapter signals more pages.
    const fullPage = Array.from({ length: 100 }, (_, i) => ({
      starred_at: "2026-01-02T00:00:00Z",
      repo: {
        id: i + 10,
        name: `repo-${i}`,
        full_name: `org/repo-${i}`,
        description: null,
        language: "TS",
        stargazers_count: 0,
        forks_count: 0,
        html_url: `https://github.com/org/repo-${i}`,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        private: false,
        fork: false,
        owner: { login: "org" },
      },
    }));
    stubFetch([["/user/starred", { status: 200, body: fullPage }]]);
    const page = await githubProvider.listMemberships(ctx, "star");
    expect(page.items).toHaveLength(100);
    expect(page.nextCursor).toBe("2"); // page 2
  });
});

describe("stub providers fail closed (ADR-0002 D4)", () => {
  it("gitlab fetchRepository throws NOT_IMPLEMENTED", async () => {
    await expect(
      gitlabProvider.fetchRepository(id1, {
        providerType: "gitlab",
        host: "gitlab.com",
      }),
    ).rejects.toMatchObject({ code: "NOT_IMPLEMENTED" });
  });

  it("gitlab listMemberships throws NOT_IMPLEMENTED", async () => {
    await expect(
      gitlabProvider.listMemberships(
        { providerType: "gitlab", host: "gitlab.com" },
        "star",
      ),
    ).rejects.toMatchObject({ code: "NOT_IMPLEMENTED" });
  });

  it("gitee fetchRepository throws NOT_IMPLEMENTED", async () => {
    await expect(
      giteeProvider.fetchRepository(id1, {
        providerType: "gitee",
        host: "gitee.com",
      }),
    ).rejects.toMatchObject({ code: "NOT_IMPLEMENTED" });
  });

  it("gitee listMemberships throws NOT_IMPLEMENTED", async () => {
    await expect(
      giteeProvider.listMemberships(
        { providerType: "gitee", host: "gitee.com" },
        "star",
      ),
    ).rejects.toMatchObject({ code: "NOT_IMPLEMENTED" });
  });

  it("stubs advertise no capabilities", () => {
    expect(gitlabProvider.capabilities.readme).toBe(false);
    expect(gitlabProvider.capabilities.memberships).toEqual([]);
    expect(giteeProvider.capabilities.search).toBe(false);
    expect(giteeProvider.capabilities.memberships).toEqual([]);
  });
});
