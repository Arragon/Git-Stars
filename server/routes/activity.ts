import { Hono } from "hono";
import { getDb } from "../db.js";
import { requireUser, type AuthedVariables } from "../middleware/auth.js";
import {
  fetchRepoActivity,
  GitHubApiError,
  GitHubRateLimitError,
} from "../github.js";
import { getProviderToken } from "../services/credentials.js";

export const activityRoutes = new Hono<{ Variables: AuthedVariables }>();

activityRoutes.use("*", requireUser);

activityRoutes.get("/:owner/:repo", async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const fullName = `${owner}/${repo}`;

  if (!owner || !repo) {
    return c.json(
      { code: "INVALID_REPO", message: "Owner and repo are required" },
      400,
    );
  }

  const user = c.get("user");
  const token = getProviderToken(user.id, "github");

  try {
    const analysis = await fetchRepoActivity(fullName, token);
    const nowIso = new Date().toISOString();

    // Persist the analysis on the projects row if we already know this repo.
    const db = getDb();
    const existing = db
      .prepare(
        `SELECT p.id FROM projects p
         JOIN user_projects up ON up.project_id = p.id
         WHERE p.full_name = ? AND up.user_id = ?`,
      )
      .get(fullName, user.id) as unknown as { id: string } | undefined;
    if (existing) {
      db.prepare(
        `UPDATE projects
         SET activity_index = ?, activity_details = ?, activity_analyzed_at = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        analysis.index,
        JSON.stringify(analysis.details),
        nowIso,
        nowIso,
        existing.id,
      );
    }

    return c.json({ ...analysis, analyzedAt: nowIso });
  } catch (error) {
    if (error instanceof GitHubRateLimitError) {
      return c.json(
        {
          code: "GITHUB_RATE_LIMIT",
          message: error.message,
          resetAt: error.resetAt,
        },
        429,
      );
    }
    if (error instanceof GitHubApiError) {
      const status =
        error.code === "REPO_NOT_FOUND"
          ? 404
          : error.code === "INVALID_REPO"
            ? 400
            : 502;
      return c.json({ code: error.code, message: error.message }, status);
    }
    console.error("[activity] unexpected error:", error);
    return c.json(
      {
        code: "ACTIVITY_FAILED",
        message: "Unexpected error analyzing activity",
      },
      500,
    );
  }
});
