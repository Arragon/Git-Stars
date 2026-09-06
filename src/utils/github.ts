import { apiGet, apiPost, ApiError } from "./api";

export type SyncGitHubDataResult =
  | {
      status: "success";
      inserted?: { projects: number; links: number };
      fetched?: { stars: number; forks: number };
    }
  | { status: "failed"; code?: string; message?: string }
  | { status: "aborted"; notified: true; code?: string; message?: string };

export class GitHubRateLimitError extends Error {
  resetAt?: number;

  constructor(message: string, resetAt?: number) {
    super(message);
    this.name = "GitHubRateLimitError";
    this.resetAt = resetAt;
  }
}

export class GitHubInvalidRepoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubInvalidRepoError";
  }
}

interface SyncResponse {
  status: "success" | "failed";
  code?: string;
  message?: string;
  resetAt?: number;
  inserted?: { projects: number; links: number };
  fetched?: { stars: number; forks: number };
}

interface ActivityResponse {
  index: number;
  details: { commits: number; issues: number; prs: number; releases: number };
  partial: boolean;
  analyzedAt: string;
}

/**
 * Trigger a GitHub sync on the backend. The backend reads the user's access_token
 * from the session, fetches stars/forks from GitHub API, and upserts into SQLite.
 */
export async function syncGitHubData(): Promise<SyncGitHubDataResult> {
  console.log("[Sync] Triggering backend GitHub sync...");

  try {
    const response = await apiPost<SyncResponse>("/api/sync/github");

    if (response.status === "success") {
      console.log(
        "[Sync] ✅ Sync completed:",
        response.inserted,
        response.fetched,
      );
      return {
        status: "success",
        inserted: response.inserted,
        fetched: response.fetched,
      };
    }

    console.error("[Sync] ❌ Sync failed:", response.code, response.message);
    return { status: "failed", code: response.code, message: response.message };
  } catch (error) {
    if (error instanceof ApiError) {
      console.error("[Sync] ❌ API error:", error.code, error.message);

      if (error.code === "GITHUB_RATE_LIMIT") {
        const resetAt = (error.details as { resetAt?: number })?.resetAt;
        throw new GitHubRateLimitError(error.message, resetAt);
      }

      if (error.code === "IDENTITY_CONFLICT") {
        return {
          status: "aborted",
          notified: true,
          code: error.code,
          message: error.message,
        };
      }

      return { status: "failed", code: error.code, message: error.message };
    }

    console.error("[Sync] ❌ Unexpected error:", error);
    return {
      status: "failed",
      code: "NETWORK_ERROR",
      message: "Failed to reach backend",
    };
  }
}

/**
 * Analyze a repository's recent activity (commits, issues, PRs, releases) via the backend.
 * The backend calls GitHub API and persists the result to the projects table if known.
 */
export async function analyzeProjectActivity(fullName: string) {
  console.log(`[Activity] Analyzing ${fullName} via backend...`);

  if (!fullName || fullName === "Unknown" || !fullName.includes("/")) {
    throw new GitHubInvalidRepoError("Invalid repository full name");
  }

  const [owner, repo] = fullName.split("/");
  if (!owner || !repo) {
    throw new GitHubInvalidRepoError("Invalid repository full name");
  }

  try {
    const response = await apiGet<ActivityResponse>(
      `/api/github/activity/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    );
    console.log(`[Activity] ✅ Index: ${response.index}`, response.details);
    return {
      index: response.index,
      details: response.details,
      partial: response.partial,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.code === "GITHUB_RATE_LIMIT") {
        const resetAt = (error.details as { resetAt?: number })?.resetAt;
        throw new GitHubRateLimitError(error.message, resetAt);
      }
      if (error.code === "REPO_NOT_FOUND") {
        throw new Error("Repository not found");
      }
      if (error.code === "INVALID_REPO") {
        throw new GitHubInvalidRepoError(error.message);
      }
    }
    throw error;
  }
}
