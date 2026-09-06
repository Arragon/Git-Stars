import { Hono } from "hono";
import { getDb } from "../db.js";
import { requireUser, type AuthedVariables } from "../middleware/auth.js";

interface ProjectRow {
  id: string;
  github_id: number;
  name: string;
  full_name: string;
  description: string | null;
  language: string | null;
  stars_count: number;
  forks_count: number;
  html_url: string;
  github_created_at: string | null;
  github_updated_at: string | null;
  activity_index: number;
  activity_details: string;
  activity_analyzed_at: string | null;
  ai_summary: string | null;
  ai_tags: string;
  created_at: string;
  updated_at: string;
}

interface UserProjectRow extends ProjectRow {
  type: "star" | "fork";
  starred_at: string | null;
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function serializeProject(
  row: ProjectRow & { type?: "star" | "fork"; starred_at?: string | null },
) {
  return {
    id: row.id,
    github_id: row.github_id,
    name: row.name,
    full_name: row.full_name,
    description: row.description ?? "",
    language: row.language ?? "",
    stars_count: row.stars_count,
    forks_count: row.forks_count,
    html_url: row.html_url,
    github_created_at: row.github_created_at ?? undefined,
    github_updated_at: row.github_updated_at ?? undefined,
    activity_index: row.activity_index,
    activity_details: parseJson(row.activity_details, {
      commits: 0,
      issues: 0,
      prs: 0,
      releases: 0,
    }),
    activity_analyzed_at: row.activity_analyzed_at ?? undefined,
    ai_summary: row.ai_summary ?? undefined,
    ai_tags: parseJson<string[]>(row.ai_tags, []),
    type: row.type,
    starred_at: row.starred_at ?? undefined,
  };
}

export const projectRoutes = new Hono<{ Variables: AuthedVariables }>();

projectRoutes.use("*", requireUser);

projectRoutes.get("/me", (c) => {
  const userId = c.get("userId");
  const rows = getDb()
    .prepare(
      `SELECT up.type, up.starred_at,
              p.id, p.github_id, p.name, p.full_name, p.description, p.language,
              p.stars_count, p.forks_count, p.html_url,
              p.github_created_at, p.github_updated_at,
              p.activity_index, p.activity_details, p.activity_analyzed_at,
              p.ai_summary, p.ai_tags, p.created_at, p.updated_at
       FROM user_projects up
       JOIN projects p ON p.id = up.project_id
       WHERE up.user_id = ?
       ORDER BY up.starred_at DESC`,
    )
    .all(userId) as unknown as UserProjectRow[];

  return c.json(rows.map((row) => serializeProject(row)));
});

projectRoutes.get("/:id", (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const row = getDb()
    .prepare(
      `SELECT p.* FROM projects p
       JOIN user_projects up ON up.project_id = p.id
       WHERE p.id = ? AND up.user_id = ?`,
    )
    .get(id, userId) as unknown as ProjectRow | undefined;
  if (!row) {
    return c.json(
      { code: "PROJECT_NOT_FOUND", message: "Project not found" },
      404,
    );
  }
  return c.json(serializeProject(row));
});

projectRoutes.patch("/:id/ai", async (c) => {
  const id = c.req.param("id");
  let body: { summary?: unknown; tags?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { code: "INVALID_JSON", message: "Request body must be JSON" },
      400,
    );
  }

  const summary = typeof body.summary === "string" ? body.summary : null;
  const tags = Array.isArray(body.tags)
    ? body.tags.filter((t): t is string => typeof t === "string")
    : null;

  if (summary === null && tags === null) {
    return c.json(
      {
        code: "INVALID_PAYLOAD",
        message: "Provide at least one of summary or tags",
      },
      400,
    );
  }

  const db = getDb();
  const userId = c.get("userId");
  const existing = db
    .prepare(
      `SELECT p.id FROM projects p
       JOIN user_projects up ON up.project_id = p.id
       WHERE p.id = ? AND up.user_id = ?`,
    )
    .get(id, userId) as unknown as { id: string } | undefined;
  if (!existing) {
    return c.json(
      { code: "PROJECT_NOT_FOUND", message: "Project not found" },
      404,
    );
  }

  const nowIso = new Date().toISOString();
  if (summary !== null && tags !== null) {
    db.prepare(
      "UPDATE projects SET ai_summary = ?, ai_tags = ?, updated_at = ? WHERE id = ?",
    ).run(summary, JSON.stringify(tags), nowIso, id);
  } else if (summary !== null) {
    db.prepare(
      "UPDATE projects SET ai_summary = ?, updated_at = ? WHERE id = ?",
    ).run(summary, nowIso, id);
  } else if (tags !== null) {
    db.prepare(
      "UPDATE projects SET ai_tags = ?, updated_at = ? WHERE id = ?",
    ).run(JSON.stringify(tags), nowIso, id);
  }

  const row = db
    .prepare("SELECT * FROM projects WHERE id = ?")
    .get(id) as unknown as ProjectRow;
  return c.json(serializeProject(row));
});
