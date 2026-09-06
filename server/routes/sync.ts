import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { getDb, inTransaction } from "../db.js";
import { requireUser, type AuthedVariables } from "../middleware/auth.js";
import { syncProvider } from "../services/syncEngine.js";
import type { RepositorySnapshot } from "../providers/types.js";

export const syncRoutes = new Hono<{ Variables: AuthedVariables }>();

syncRoutes.use("*", requireUser);

// TEMPORARY migration compatibility (Roadmap D9 "narrowly documented compatibility path"):
// mirror the new-domain sync result into the legacy projects/user_projects tables so the
// pre-M3 UI keeps working. Remove once the frontend reads the new domain exclusively.
function mirrorToLegacy(
  userId: string,
  repos: RepositorySnapshot[],
  memberships: Array<{
    remoteId: string;
    kind: string;
    remoteCreatedAt: string | null;
  }>,
): { projects: number; links: number } {
  const db = getDb();
  const nowIso = new Date().toISOString();
  let projects = 0;
  let links = 0;

  inTransaction(() => {
    const projectByRemoteId = new Map<string, string>();
    for (const snap of repos) {
      const githubId = Number(snap.identity.remoteId);
      if (!Number.isFinite(githubId)) continue;
      const existing = db
        .prepare("SELECT id FROM projects WHERE github_id = ?")
        .get(githubId) as unknown as { id: string } | undefined;
      const projectId = existing?.id ?? randomUUID();
      const fullName = snap.namespacePath
        ? `${snap.namespacePath}/${snap.name}`
        : snap.name;
      db.prepare(
        `INSERT INTO projects (id, github_id, name, full_name, description, language, stars_count, forks_count,
                               html_url, github_created_at, github_updated_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(github_id) DO UPDATE SET
           name = excluded.name, full_name = excluded.full_name, description = excluded.description,
           language = excluded.language, stars_count = excluded.stars_count, forks_count = excluded.forks_count,
           html_url = excluded.html_url, github_created_at = excluded.github_created_at,
           github_updated_at = excluded.github_updated_at, updated_at = excluded.updated_at`,
      ).run(
        projectId,
        githubId,
        snap.name,
        fullName,
        snap.description,
        snap.primaryLanguage,
        snap.starsCount,
        snap.forksCount,
        snap.webUrl,
        snap.providerCreatedAt,
        snap.providerUpdatedAt,
        nowIso,
      );
      if (!existing) projects += 1;
      projectByRemoteId.set(snap.identity.remoteId, projectId);
    }

    for (const m of memberships) {
      const projectId = projectByRemoteId.get(m.remoteId);
      if (!projectId) continue;
      const type = m.kind === "fork" ? "fork" : "star";
      const before = db
        .prepare(
          "SELECT 1 AS one FROM user_projects WHERE user_id = ? AND project_id = ? AND type = ?",
        )
        .get(userId, projectId, type);
      db.prepare(
        `INSERT INTO user_projects (id, user_id, project_id, type, starred_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id, project_id, type) DO UPDATE SET starred_at = excluded.starred_at`,
      ).run(randomUUID(), userId, projectId, type, m.remoteCreatedAt);
      if (!before) links += 1;
    }

    db.prepare(
      "UPDATE users SET last_synced_at = ?, updated_at = ? WHERE id = ?",
    ).run(nowIso, nowIso, userId);
  });

  return { projects, links };
}

// POST /api/sync/:provider - runs the provider-neutral sync engine (new domain) and mirrors
// to legacy. Response keeps the legacy shape the current frontend expects, plus new counts.
syncRoutes.post("/:provider", async (c) => {
  const user = c.get("user");
  const providerType = c.req.param("provider");

  const outcome = await syncProvider(user.id, providerType);
  if (!outcome.ok) {
    let status: 401 | 429 | 501 | 502 = 502;
    if (outcome.code === "RATE_LIMITED") status = 429;
    else if (outcome.code === "PROVIDER_NOT_IMPLEMENTED") status = 501;
    else if (outcome.code === "UNAUTHORIZED") status = 401;
    return c.json(
      {
        status: "failed",
        code: outcome.code,
        message: outcome.message,
        resetAt: outcome.resetAt,
      },
      status,
    );
  }

  const legacy = mirrorToLegacy(user.id, outcome.repos, outcome.memberships);
  return c.json({
    status: "success",
    provider: providerType,
    startedAt: outcome.startedAt,
    completedAt: outcome.completedAt,
    inserted: { projects: legacy.projects, links: legacy.links },
    fetched: {
      stars: outcome.memberships.filter((m) => m.kind === "star").length,
      forks: outcome.memberships.filter((m) => m.kind === "fork").length,
    },
    counts: outcome.counts,
  });
});
