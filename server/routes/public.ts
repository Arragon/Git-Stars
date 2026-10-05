import { Hono } from "hono";
import { requireUser, type AuthedVariables } from "../middleware/auth.js";
import {
  getPublicSnapshot,
  recordReport,
  REPORT_REASONS,
  snapshotToPortable,
} from "../services/publication.js";
import { importCommit, importPreview } from "../services/listsIo.js";
import { apiError } from "../httpErrors.js";
import { hit, clientIp } from "../lib/rateLimit.js";

// Anonymous public share surface (M5, INH-437/443). No requireUser except the
// import endpoint, which acts on the session user's own library.
//
// Enumeration resistance: unknown, revoked and takedown shareIds all answer the
// SAME 404 code+message; reports on unknown shareIds still answer 202.

export const NOT_FOUND_MESSAGE =
  "This share link does not exist or is no longer available";

const IMPORT_LIMIT = 20;
const IMPORT_WINDOW_MS = 60 * 60 * 1000;
const REPORT_LIMIT = 5;
const REPORT_WINDOW_MS = 60 * 60 * 1000;
// Anonymous read limits (INH-451): bound enumeration/abuse without hurting
// normal browsing. Generous relative to human traffic; keyset on IP.
const ANON_READ_LIMIT = 120;
const ANON_READ_WINDOW_MS = 60 * 60 * 1000;

export const publicRoutes = new Hono<{ Variables: AuthedVariables }>();

publicRoutes.get("/public/lists/:shareId", (c) => {
  const rl = hit(
    `read:${clientIp(c.req.header("X-Forwarded-For"))}`,
    ANON_READ_LIMIT,
    ANON_READ_WINDOW_MS,
  );
  if (!rl.ok) {
    return apiError(c, 429, "RATE_LIMITED", "Too many requests", {
      retryAfterSec: rl.retryAfterSec,
    });
  }
  const snapshot = getPublicSnapshot(c.req.param("shareId"));
  if (!snapshot) {
    return apiError(c, 404, "NOT_FOUND", NOT_FOUND_MESSAGE);
  }
  return c.json(snapshot);
});

// Import a shared list as an INDEPENDENT private list for the session user.
// Reuses the portable-list pipeline (parse -> validate -> preview -> commit) so
// unknown providers are retained as 'unresolved' (ADR-0009 D4). The copy shares
// no rows with the publication; publishing user edits never affect it.
publicRoutes.post("/public/lists/:shareId/import", requireUser, async (c) => {
  const userId = c.get("userId");
  const shareId = c.req.param("shareId");

  const rl = hit(`import:${userId}`, IMPORT_LIMIT, IMPORT_WINDOW_MS);
  if (!rl.ok) {
    return apiError(c, 429, "RATE_LIMITED", "Too many import requests", {
      retryAfterSec: rl.retryAfterSec,
    });
  }

  const snapshot = getPublicSnapshot(shareId);
  if (!snapshot) {
    return apiError(c, 404, "NOT_FOUND", NOT_FOUND_MESSAGE);
  }

  const text = JSON.stringify(snapshotToPortable(snapshot));
  const preview = importPreview(userId, text);
  if (!preview.ok) {
    return apiError(c, 400, "VALIDATION", "Import validation failed", {
      errors: preview.errors,
    });
  }
  const result = importCommit(userId, text);
  if (!result.ok || !result.listId) {
    return apiError(c, 400, "VALIDATION", "Import validation failed", {
      errors: result.errors,
    });
  }
  return c.json(
    {
      listId: result.listId,
      name: `${snapshot.title} (imported)`,
      itemCount: result.counts?.total ?? 0,
    },
    201,
  );
});

publicRoutes.post("/public/lists/:shareId/report", async (c) => {
  const shareId = c.req.param("shareId");
  // Rate limit per client IP (first X-Forwarded-For hop when behind a proxy).
  const rl = hit(
    `report:${clientIp(c.req.header("X-Forwarded-For"))}`,
    REPORT_LIMIT,
    REPORT_WINDOW_MS,
  );
  if (!rl.ok) {
    return apiError(c, 429, "RATE_LIMITED", "Too many reports", {
      retryAfterSec: rl.retryAfterSec,
    });
  }

  let body: { reason?: unknown; detail?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 400, "VALIDATION", "Request body must be JSON");
  }
  const reason = typeof body.reason === "string" ? body.reason : "";
  if (!(REPORT_REASONS as readonly string[]).includes(reason)) {
    return apiError(
      c,
      400,
      "VALIDATION",
      `reason must be one of: ${REPORT_REASONS.join(", ")}`,
    );
  }
  const detail = typeof body.detail === "string" ? body.detail : undefined;
  recordReport(shareId, reason, detail);
  return c.json({ ok: true }, 202);
});
