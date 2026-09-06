import {
  dedupe,
  httpBytes,
  httpJson,
  parseRetryAfterMs,
  type HttpResult,
} from "../shared/http.js";
import {
  ProviderError,
  type AssetBytes,
  type FileResult,
  type MembershipKind,
  type MembershipPage,
  type ProviderCapabilities,
  type ProviderConnectionContext,
  type ReadmeResult,
  type ReleasePage,
  type RepositoryIdentity,
  type RepositoryProvider,
  type RepositorySnapshot,
  type SearchPage,
  type TreePage,
} from "../types.js";

const API = "https://api.github.com";
const PER_PAGE = 100;
const MAX_FILE_BYTES = 512 * 1024; // decode text files up to 512 KB; larger is truncated

// remoteId -> "owner/repo". GitHub sub-resource endpoints need the full name; resolving it
// from the stable numeric id costs one call, cached here.
// ponytail: no TTL; a remote rename could stale this until process restart. Re-resolve on 404 if that bites.
const fullNameCache = new Map<string, string>();

interface GhRepo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  html_url: string;
  created_at: string | null;
  updated_at: string | null;
  private?: boolean;
  fork?: boolean;
  default_branch?: string;
  owner?: { login?: string };
}

function assertOk(res: HttpResult, what: string): void {
  if (res.ok) return;
  if (res.status === 404)
    throw new ProviderError("NOT_FOUND", `${what} not found`, { status: 404 });
  if (res.status === 401)
    throw new ProviderError("UNAUTHORIZED", `${what}: bad credentials`, {
      status: 401,
    });
  if (res.status === 403 || res.status === 429) {
    const remaining = res.headers.get("x-ratelimit-remaining");
    const reset = res.headers.get("x-ratelimit-reset");
    const message =
      typeof res.data === "object" && res.data && "message" in res.data
        ? String((res.data as { message: unknown }).message)
        : "";
    const isRate =
      res.status === 429 || remaining === "0" || /rate limit/i.test(message);
    if (isRate) {
      const resetAt = reset
        ? Number(reset) * 1000
        : parseRetryAfterMs(res.headers)
          ? Date.now() + parseRetryAfterMs(res.headers)!
          : undefined;
      throw new ProviderError(
        "RATE_LIMITED",
        `${what}: GitHub rate limit exceeded`,
        {
          retryable: true,
          status: res.status,
          resetAt: Number.isFinite(resetAt) ? resetAt : undefined,
        },
      );
    }
    throw new ProviderError("FORBIDDEN", `${what}: forbidden`, { status: 403 });
  }
  if (res.status >= 500)
    throw new ProviderError("SERVER", `${what}: GitHub server error`, {
      retryable: true,
      status: res.status,
    });
  throw new ProviderError(
    "SERVER",
    `${what}: unexpected status ${res.status}`,
    { status: res.status },
  );
}

function identityOf(repo: GhRepo): RepositoryIdentity {
  return {
    providerType: "github",
    host: "github.com",
    remoteId: String(repo.id),
  };
}

function normalize(repo: GhRepo): RepositorySnapshot {
  const fullName = repo.full_name ?? "";
  const slash = fullName.indexOf("/");
  return {
    identity: identityOf(repo),
    canonicalKey: `github:github.com/${fullName}`,
    namespacePath:
      repo.owner?.login ?? (slash > 0 ? fullName.slice(0, slash) : null),
    name: repo.name ?? (slash > 0 ? fullName.slice(slash + 1) : fullName),
    webUrl: repo.html_url ?? `https://github.com/${fullName}`,
    description: repo.description ?? null,
    visibility: repo.private ? "private" : "public",
    primaryLanguage: repo.language ?? null,
    starsCount: repo.stargazers_count ?? 0,
    forksCount: repo.forks_count ?? 0,
    providerCreatedAt: repo.created_at ?? null,
    providerUpdatedAt: repo.updated_at ?? null,
    providerData: {
      defaultBranch: repo.default_branch ?? "main",
      fork: Boolean(repo.fork),
    },
  };
}

async function resolveFullName(
  identity: RepositoryIdentity,
  ctx: ProviderConnectionContext,
): Promise<string> {
  const cached = fullNameCache.get(identity.remoteId);
  if (cached) return cached;
  const res = await httpJson(`${API}/repositories/${identity.remoteId}`, {
    token: ctx.token,
  });
  assertOk(res, "Repository");
  const repo = res.data as GhRepo;
  if (!repo?.full_name)
    throw new ProviderError("NOT_FOUND", "Repository full name unavailable", {
      status: 404,
    });
  fullNameCache.set(identity.remoteId, repo.full_name);
  return repo.full_name;
}

function pageFromCursor(cursor?: string | null): number {
  const n = cursor ? Number(cursor) : 1;
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

export const githubProvider: RepositoryProvider = {
  type: "github",
  defaultHost: "github.com",
  capabilities: {
    memberships: ["star", "fork"],
    readme: true,
    tree: true,
    file: true,
    releases: true,
    releaseAssets: true,
    search: true,
    activity: true,
    privateRepos: true,
  } as ProviderCapabilities,

  async fetchRepository(identity, ctx) {
    const res = await dedupe(`gh:repo:${identity.remoteId}`, () =>
      httpJson(`${API}/repositories/${identity.remoteId}`, {
        token: ctx.token,
      }),
    );
    assertOk(res, "Repository");
    return normalize(res.data as GhRepo);
  },

  async listMemberships(ctx, kind: MembershipKind, cursor) {
    if (kind !== "star" && kind !== "fork")
      return { items: [], nextCursor: null };
    const page = pageFromCursor(cursor);
    const username = encodeURIComponent(ctx.remoteUsername ?? "");
    if (!ctx.token && !ctx.remoteUsername) {
      throw new ProviderError(
        "VALIDATION",
        "Listing memberships requires a token or a username",
      );
    }
    const url =
      kind === "star"
        ? ctx.token
          ? `${API}/user/starred?per_page=${PER_PAGE}&page=${page}`
          : `${API}/users/${username}/starred?per_page=${PER_PAGE}&page=${page}`
        : `${API}/users/${username}/repos?type=forks&per_page=${PER_PAGE}&page=${page}`;
    const accept =
      kind === "star"
        ? "application/vnd.github.v3.star+json"
        : "application/vnd.github+json";
    const res = await httpJson(url, { token: ctx.token, accept });
    assertOk(res, kind === "star" ? "Stars" : "Forks");
    const raw = Array.isArray(res.data) ? res.data : [];

    const items = raw.map((entry) => {
      const repo = (
        kind === "star" ? (entry as { repo: GhRepo }).repo : entry
      ) as GhRepo;
      const starredAt =
        kind === "star"
          ? ((entry as { starred_at?: string }).starred_at ?? null)
          : (repo.created_at ?? null);
      return {
        identity: identityOf(repo),
        kind,
        remoteCreatedAt: starredAt,
        snapshot: normalize(repo),
      };
    });
    const nextCursor = items.length === PER_PAGE ? String(page + 1) : null;
    return { items, nextCursor } satisfies MembershipPage;
  },

  async getReadme(identity, ctx) {
    const full = await resolveFullName(identity, ctx);
    const res = await httpJson(`${API}/repos/${full}/readme`, {
      token: ctx.token,
      accept: "application/vnd.github.raw",
    });
    if (res.status === 404) return null;
    assertOk(res, "README");
    const content = typeof res.data === "string" ? res.data : "";
    return {
      path: "README.md",
      format: "markdown",
      content,
    } satisfies ReadmeResult;
  },

  async getTree(identity, ref, path, ctx) {
    const full = await resolveFullName(identity, ctx);
    const qs = `ref=${encodeURIComponent(ref || "HEAD")}`;
    const suffix = path
      ? `/${path.split("/").map(encodeURIComponent).join("/")}`
      : "";
    const res = await httpJson(`${API}/repos/${full}/contents${suffix}?${qs}`, {
      token: ctx.token,
    });
    assertOk(res, "File tree");
    const entries = Array.isArray(res.data) ? res.data : [res.data];
    return {
      ref: ref || "HEAD",
      path,
      truncated: false,
      entries: entries.map((e) => {
        const entry = e as {
          name: string;
          path: string;
          type: string;
          size?: number;
        };
        return {
          path: entry.path ?? entry.name,
          type: entry.type === "dir" ? "dir" : "file",
          size: entry.size,
        };
      }),
    } satisfies TreePage;
  },

  async getFile(identity, ref, path, ctx) {
    const full = await resolveFullName(identity, ctx);
    const qs = `ref=${encodeURIComponent(ref || "HEAD")}`;
    const res = await httpJson(
      `${API}/repos/${full}/contents/${path.split("/").map(encodeURIComponent).join("/")}?${qs}`,
      { token: ctx.token },
    );
    assertOk(res, "File");
    const data = res.data as {
      name: string;
      path?: string;
      size: number;
      encoding: string;
      content?: string;
      type?: string;
    };
    if (data.type === "dir")
      throw new ProviderError("VALIDATION", "Path is a directory, not a file");
    const size = Number(data.size ?? 0);
    const truncated = size > MAX_FILE_BYTES;
    let text = "";
    if (data.encoding === "base64" && typeof data.content === "string") {
      const buf = Buffer.from(data.content, "base64");
      text = buf.subarray(0, MAX_FILE_BYTES).toString("utf8");
    } else if (typeof data.content === "string") {
      text = data.content.slice(0, MAX_FILE_BYTES);
    }
    return {
      path: data.path ?? path,
      encoding: "utf-8",
      content: text,
      size,
      truncated,
    } satisfies FileResult;
  },

  async listReleases(identity, ctx, cursor) {
    const full = await resolveFullName(identity, ctx);
    const page = pageFromCursor(cursor);
    const res = await httpJson(
      `${API}/repos/${full}/releases?per_page=${PER_PAGE}&page=${page}`,
      { token: ctx.token },
    );
    assertOk(res, "Releases");
    const raw = Array.isArray(res.data) ? res.data : [];
    const items = raw.map((r) => {
      const rel = r as {
        id: number;
        tag_name: string;
        name: string | null;
        published_at: string | null;
        assets?: Array<{
          id: number;
          name: string;
          size: number;
          content_type: string;
          url: string;
        }>;
      };
      return {
        id: String(rel.id),
        tagName: rel.tag_name,
        name: rel.name ?? null,
        publishedAt: rel.published_at ?? null,
        assets: (rel.assets ?? []).map((a) => ({
          id: String(a.id),
          name: a.name,
          size: Number(a.size ?? 0),
          contentType: a.content_type ?? "application/octet-stream",
          downloadRef: a.url,
        })),
      };
    });
    return {
      items,
      nextCursor: items.length === PER_PAGE ? String(page + 1) : null,
    } satisfies ReleasePage;
  },

  async getReleaseAsset(identity, downloadRef, ctx): Promise<AssetBytes> {
    // downloadRef may be a bare asset id (from the route) or a full GitHub API asset URL.
    let url = downloadRef;
    if (!/^https:\/\//.test(url)) {
      const full = await resolveFullName(identity, ctx);
      url = `${API}/repos/${full}/releases/assets/${encodeURIComponent(downloadRef)}`;
    }
    if (!/^https:\/\/api\.github\.com\//.test(url)) {
      throw new ProviderError(
        "VALIDATION",
        "Refusing to fetch asset from a non-GitHub API URL",
      );
    }
    const res = await httpBytes(url, {
      token: ctx.token,
      accept: "application/octet-stream",
    });
    if (res.status !== 200)
      throw new ProviderError(
        "SERVER",
        `Asset download failed (${res.status})`,
        { status: res.status, retryable: res.status >= 500 },
      );
    const disposition = res.headers.get("content-disposition") ?? "";
    const match = /filename="?([^";]+)"?/.exec(disposition);
    return {
      filename: match ? match[1] : "download",
      contentType:
        res.headers.get("content-type") ?? "application/octet-stream",
      size: res.body.byteLength,
      body: res.body,
    };
  },

  async search(query, ctx, cursor) {
    const page = pageFromCursor(cursor);
    const url = `${API}/search/repositories?q=${encodeURIComponent(query)}&per_page=${PER_PAGE}&page=${page}`;
    const res = await httpJson(url, { token: ctx.token });
    assertOk(res, "Search");
    const data = res.data as { total_count?: number; items?: GhRepo[] };
    const items = (data.items ?? []).map((repo) => ({
      identity: identityOf(repo),
      name: repo.name,
      namespacePath: repo.owner?.login ?? null,
      webUrl: repo.html_url,
      description: repo.description ?? null,
      starsCount: repo.stargazers_count ?? 0,
      primaryLanguage: repo.language ?? null,
    }));
    return {
      items,
      total: data.total_count,
      nextCursor: items.length === PER_PAGE ? String(page + 1) : null,
    } satisfies SearchPage;
  },
};
