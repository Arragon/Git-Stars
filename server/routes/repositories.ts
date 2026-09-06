import { Hono } from "hono";
import {
  requireUser,
  type AuthedContext,
  type AuthedVariables,
} from "../middleware/auth.js";
import {
  getRepositoryView,
  refreshRepository,
  repositoryReader,
} from "../services/repository.js";
import { providerErrorToHttp, apiError } from "../httpErrors.js";

// Repository View API (ADR-0006 D1). Metadata is served from the cache; README/tree/file/
// releases/asset are fetched through the provider adapter. Release assets are proxied by the
// server so the provider token never reaches the client (ADR-0005).

export const repositoryRoutes = new Hono<{ Variables: AuthedVariables }>();

repositoryRoutes.use("*", requireUser);

function guard(
  c: AuthedContext,
  fn: () => Response | Promise<Response>,
): Promise<Response> {
  return Promise.resolve()
    .then(fn)
    .catch((error: unknown) => {
      const mapped = providerErrorToHttp(error);
      if (mapped) return c.json(mapped.body, mapped.status);
      console.error("[repositories] unexpected error:", error);
      return apiError(c, 500, "INTERNAL_ERROR", "Unexpected error");
    });
}

repositoryRoutes.get("/:id", (c) =>
  guard(c, async () => {
    const userId = c.get("userId");
    const id = c.req.param("id");
    if (c.req.query("refresh") === "1") await refreshRepository(id, userId);
    const view = getRepositoryView(id, userId);
    if (!view) return apiError(c, 404, "NOT_FOUND", "Repository not found");
    return c.json(view);
  }),
);

repositoryRoutes.get("/:id/readme", (c) =>
  guard(c, async () => {
    const readme = await repositoryReader.readme(
      c.req.param("id"),
      c.get("userId"),
    );
    if (!readme) return apiError(c, 404, "NOT_FOUND", "No README found");
    return c.json(readme);
  }),
);

repositoryRoutes.get("/:id/tree", (c) =>
  guard(c, async () => {
    const tree = await repositoryReader.tree(
      c.req.param("id"),
      c.req.query("ref") ?? "",
      c.req.query("path") ?? "",
      c.get("userId"),
    );
    return c.json(tree);
  }),
);

repositoryRoutes.get("/:id/file", (c) =>
  guard(c, async () => {
    const path = c.req.query("path") ?? "";
    if (!path)
      return apiError(c, 400, "VALIDATION", "path query parameter is required");
    const file = await repositoryReader.file(
      c.req.param("id"),
      c.req.query("ref") ?? "",
      path,
      c.get("userId"),
    );
    return c.json(file);
  }),
);

repositoryRoutes.get("/:id/releases", (c) =>
  guard(c, async () => {
    const releases = await repositoryReader.releases(
      c.req.param("id"),
      c.get("userId"),
      c.req.query("cursor"),
    );
    return c.json(releases);
  }),
);

// Secure release-asset download: the server fetches the bytes with the provider token and
// streams them to the authenticated client; the token is never exposed (ADR-0005/0008).
repositoryRoutes.get("/:id/releases/:assetId/download", (c) =>
  guard(c, async () => {
    const asset = await repositoryReader.asset(
      c.req.param("id"),
      c.req.param("assetId"),
      c.get("userId"),
    );
    c.header("Content-Type", asset.contentType);
    c.header(
      "Content-Disposition",
      `attachment; filename="${asset.filename.replace(/["\\\r\n]/g, "")}"`,
    );
    c.header("Content-Length", String(asset.size));
    return c.body(asset.body.buffer as ArrayBuffer);
  }),
);
