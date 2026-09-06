import { env } from "./env.js";

const GITHUB_API_URL = "https://api.github.com";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";

export const GITHUB_OAUTH_SCOPES = "read:user user:email";

export class GitHubRateLimitError extends Error {
  resetAt?: number;
  constructor(message: string, resetAt?: number) {
    super(message);
    this.name = "GitHubRateLimitError";
    this.resetAt = resetAt;
  }
}

export class GitHubApiError extends Error {
  status?: number;
  code: string;
  constructor(message: string, code: string, status?: number) {
    super(message);
    this.name = "GitHubApiError";
    this.code = code;
    this.status = status;
  }
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  html_url: string;
  created_at: string;
  updated_at: string;
  fork: boolean;
}

export interface GitHubStar {
  starred_at: string;
  repo: GitHubRepo;
}

export interface GitHubUserProfile {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
}

type JsonResult =
  | { ok: true; status: number; headers: Headers; data: unknown }
  | {
      ok: false;
      status?: number;
      headers?: Headers;
      data?: unknown;
      error: unknown;
    };

async function fetchJson(
  url: string,
  init: RequestInit = {},
): Promise<JsonResult> {
  try {
    const response = await fetch(url, init);
    const contentType = response.headers.get("content-type") ?? "";
    let data: unknown = null;
    if (
      contentType.includes("application/json") ||
      contentType.includes("application/x-www-form-urlencoded")
    ) {
      const text = await response.text();
      if (contentType.includes("application/x-www-form-urlencoded")) {
        data = Object.fromEntries(new URLSearchParams(text));
      } else {
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          data = text;
        }
      }
    } else {
      try {
        data = await response.text();
      } catch {
        data = null;
      }
    }
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        headers: response.headers,
        data,
        error: new Error(`HTTP ${response.status}`),
      };
    }
    return {
      ok: true,
      status: response.status,
      headers: response.headers,
      data,
    };
  } catch (error) {
    return { ok: false, error };
  }
}

function getRateLimitResetAt(result: JsonResult): number | undefined {
  if (result.ok || result.status !== 403) return undefined;
  const reset = result.headers?.get("x-ratelimit-reset");
  const resetSeconds = reset ? Number(reset) : NaN;
  return Number.isFinite(resetSeconds) ? resetSeconds * 1000 : undefined;
}

function isRateLimited(result: JsonResult): boolean {
  if (result.ok || result.status !== 403) return false;
  const remaining = result.headers?.get("x-ratelimit-remaining");
  if (remaining === "0") return true;
  const message =
    typeof result.data === "object" && result.data && "message" in result.data
      ? String((result.data as { message: unknown }).message)
      : typeof result.data === "string"
        ? result.data
        : "";
  return message.toLowerCase().includes("rate limit");
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function buildAuthHeaders(
  token: string | null | undefined,
  accept: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: accept,
    "User-Agent": "gitstars-local-backend",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export function buildAuthorizeUrl(state: string, redirectUri: string): string {
  if (!env.githubClientId) {
    throw new GitHubApiError(
      "GitHub OAuth is not configured on this server",
      "OAUTH_NOT_CONFIGURED",
    );
  }
  const params = new URLSearchParams({
    client_id: env.githubClientId,
    redirect_uri: redirectUri,
    scope: GITHUB_OAUTH_SCOPES,
    state,
    allow_signup: "false",
  });
  return `${GITHUB_AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeCodeForToken(
  code: string,
  redirectUri: string,
): Promise<string> {
  if (!env.githubClientId || !env.githubClientSecret) {
    throw new GitHubApiError(
      "GitHub OAuth is not configured on this server",
      "OAUTH_NOT_CONFIGURED",
    );
  }
  const result = await fetchJson(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: env.githubClientId,
      client_secret: env.githubClientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!result.ok) {
    throw new GitHubApiError(
      "Failed to exchange GitHub OAuth code",
      "OAUTH_EXCHANGE_FAILED",
      result.status,
    );
  }

  const data = result.data as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (data.error || !data.access_token) {
    throw new GitHubApiError(
      data.error_description ||
        data.error ||
        "GitHub OAuth exchange returned no access_token",
      "OAUTH_EXCHANGE_FAILED",
    );
  }
  return data.access_token;
}

export async function fetchGitHubUser(
  token: string,
): Promise<GitHubUserProfile> {
  const result = await fetchJson(`${GITHUB_API_URL}/user`, {
    headers: buildAuthHeaders(token, "application/vnd.github.v3+json"),
  });
  if (!result.ok) {
    if (isRateLimited(result)) {
      throw new GitHubRateLimitError(
        "GitHub API rate limit exceeded",
        getRateLimitResetAt(result),
      );
    }
    throw new GitHubApiError(
      "Failed to fetch GitHub user profile",
      "USER_FETCH_FAILED",
      result.status,
    );
  }
  const data = result.data as GitHubUserProfile;
  if (!data || typeof data.id !== "number" || !data.login) {
    throw new GitHubApiError(
      "GitHub user profile is malformed",
      "USER_FETCH_FAILED",
    );
  }
  return data;
}

export async function fetchUserStars(
  username: string,
  token: string | null,
  lastSyncedAt?: string | null,
): Promise<GitHubStar[]> {
  if (!username) return [];

  const allStars: GitHubStar[] = [];
  let page = 1;
  const perPage = 100;
  let hasMore = true;

  while (hasMore) {
    const url = token
      ? `${GITHUB_API_URL}/user/starred?page=${page}&per_page=${perPage}`
      : `${GITHUB_API_URL}/users/${encodeURIComponent(username)}/starred?page=${page}&per_page=${perPage}`;

    const result = await fetchJson(url, {
      headers: buildAuthHeaders(token, "application/vnd.github.v3.star+json"),
    });

    if (!result.ok) {
      if (isRateLimited(result)) {
        throw new GitHubRateLimitError(
          "GitHub API rate limit exceeded",
          getRateLimitResetAt(result),
        );
      }
      if (result.status === 404) {
        throw new GitHubApiError(
          `GitHub user ${username} not found`,
          "USER_NOT_FOUND",
          404,
        );
      }
      throw new GitHubApiError(
        `Failed to fetch stars (HTTP ${result.status ?? "unknown"})`,
        "STARS_FETCH_FAILED",
        result.status,
      );
    }

    const data = asArray(result.data) as GitHubStar[];
    if (data.length === 0) break;

    if (lastSyncedAt) {
      const lastSyncedDate = new Date(lastSyncedAt);
      const newStars = data.filter(
        (item) => new Date(item.starred_at) > lastSyncedDate,
      );
      allStars.push(...newStars);
      if (newStars.length < data.length) break;
    } else {
      allStars.push(...data);
      if (page >= 5) hasMore = false; // cap initial sync at ~500 stars
    }

    page++;
  }

  return allStars;
}

export async function fetchUserForks(
  username: string,
  token: string | null,
  lastSyncedAt?: string | null,
): Promise<GitHubRepo[]> {
  if (!username) return [];

  const allForks: GitHubRepo[] = [];
  let page = 1;
  const perPage = 100;
  let hasMore = true;

  while (hasMore) {
    const url = `${GITHUB_API_URL}/users/${encodeURIComponent(username)}/repos?type=forks&sort=created&direction=desc&page=${page}&per_page=${perPage}`;
    const result = await fetchJson(url, {
      headers: buildAuthHeaders(token, "application/vnd.github.v3+json"),
    });

    if (!result.ok) {
      if (isRateLimited(result)) {
        throw new GitHubRateLimitError(
          "GitHub API rate limit exceeded",
          getRateLimitResetAt(result),
        );
      }
      if (result.status === 404) {
        throw new GitHubApiError(
          `GitHub user ${username} not found`,
          "USER_NOT_FOUND",
          404,
        );
      }
      throw new GitHubApiError(
        `Failed to fetch forks (HTTP ${result.status ?? "unknown"})`,
        "FORKS_FETCH_FAILED",
        result.status,
      );
    }

    const data = asArray(result.data) as GitHubRepo[];
    if (data.length === 0) break;

    const forks = data.filter((repo) => repo.fork);

    if (lastSyncedAt) {
      const lastSyncedDate = new Date(lastSyncedAt);
      const newForks = forks.filter(
        (repo) => new Date(repo.created_at) > lastSyncedDate,
      );
      allForks.push(...newForks);
      if (newForks.length < forks.length) break;
    } else {
      allForks.push(...forks);
      if (page >= 5) hasMore = false;
    }

    page++;
  }

  return allForks;
}

export interface ActivityAnalysis {
  index: number;
  details: { commits: number; issues: number; prs: number; releases: number };
  partial: boolean;
}

export async function fetchRepoActivity(
  fullName: string,
  token: string | null,
): Promise<ActivityAnalysis> {
  if (!fullName || !fullName.includes("/")) {
    throw new GitHubApiError("Invalid repository full name", "INVALID_REPO");
  }

  const headers = buildAuthHeaders(token, "application/vnd.github.v3+json");
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [commitsResult, issuesResult, releasesResult] = await Promise.all([
    fetchJson(
      `${GITHUB_API_URL}/repos/${fullName}/commits?since=${since}&per_page=100`,
      { headers },
    ),
    fetchJson(
      `${GITHUB_API_URL}/repos/${fullName}/issues?since=${since}&state=all&per_page=100`,
      { headers },
    ),
    fetchJson(`${GITHUB_API_URL}/repos/${fullName}/releases?per_page=100`, {
      headers,
    }),
  ]);

  const results = [commitsResult, issuesResult, releasesResult];
  const anyOk = results.some((r) => r.ok);
  const rateLimited = results.some(isRateLimited);

  if (!anyOk) {
    if (rateLimited) {
      const resets = results
        .map(getRateLimitResetAt)
        .filter(
          (v): v is number => typeof v === "number" && Number.isFinite(v),
        );
      throw new GitHubRateLimitError(
        "GitHub API rate limit exceeded",
        resets.length ? Math.min(...resets) : undefined,
      );
    }
    const statuses = results
      .map((r) => r.status)
      .filter((s): s is number => typeof s === "number");
    if (statuses.length && statuses.every((s) => s === 404)) {
      throw new GitHubApiError("Repository not found", "REPO_NOT_FOUND", 404);
    }
    throw new GitHubApiError(
      "Failed to fetch project activity data",
      "ACTIVITY_FETCH_FAILED",
    );
  }

  const sinceDate = new Date(since);
  const commits = commitsResult.ok ? asArray(commitsResult.data) : [];
  const issuesAndPrs = issuesResult.ok ? asArray(issuesResult.data) : [];
  const releases = releasesResult.ok ? asArray(releasesResult.data) : [];

  const prsCount = issuesAndPrs.filter((item) =>
    Boolean((item as { pull_request?: unknown }).pull_request),
  ).length;
  const issuesCount = Math.max(issuesAndPrs.length - prsCount, 0);
  const recentReleasesCount = releases.filter((release) => {
    const publishedAt = (release as { published_at?: string }).published_at;
    if (!publishedAt) return false;
    const publishedDate = new Date(publishedAt);
    return (
      Number.isFinite(publishedDate.getTime()) && publishedDate > sinceDate
    );
  }).length;

  const commitScore = Math.min(commits.length * 2, 50);
  const prScore = Math.min(prsCount * 4, 20);
  const issueScore = Math.min(issuesCount * 2, 20);
  const releaseScore = Math.min(recentReleasesCount * 10, 10);
  const index = Math.min(
    commitScore + prScore + issueScore + releaseScore,
    100,
  );

  return {
    index,
    details: {
      commits: commits.length,
      issues: issuesCount,
      prs: prsCount,
      releases: recentReleasesCount,
    },
    partial: !results.every((r) => r.ok),
  };
}
