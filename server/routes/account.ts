import { Hono } from "hono";
import { requireUser, type AuthedVariables } from "../middleware/auth.js";
import { buildAccountExport } from "../services/accountExport.js";
import {
  requestDeletion,
  confirmDeletion,
  hasPendingDeletion,
} from "../services/accountDeletion.js";
import { buildClearCookieHeader } from "../session.js";
import { apiError } from "../httpErrors.js";

// Account ownership surface (INH-476): full data export + recovery-safe account
// deletion. Deletion is two-step (request issues a one-time confirmation token;
// confirm executes atomically) and also destroys the current session.
export const accountRoutes = new Hono<{ Variables: AuthedVariables }>();

accountRoutes.use("*", requireUser);

// Full user-data export: library (+notes/tags), lists (+item notes), preferences
// and provider connection metadata — never any credential material.
accountRoutes.get("/export", (c) => {
  return c.json(buildAccountExport(c.get("userId")));
});

accountRoutes.post("/delete", (c) => {
  const token = requestDeletion(c.get("userId"));
  return c.json({
    confirmation: token,
    message:
      "Send this token to POST /api/account/delete/confirm to permanently delete the account.",
  });
});

accountRoutes.post("/delete/confirm", async (c) => {
  const userId = c.get("userId");
  let body: { confirmation?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 400, "VALIDATION", "Request body must be JSON");
  }
  const token = typeof body.confirmation === "string" ? body.confirmation : "";
  if (!token) {
    return apiError(c, 400, "VALIDATION", "confirmation token is required");
  }

  if (!hasPendingDeletion(userId)) {
    return apiError(c, 404, "NOT_FOUND", "No pending deletion request");
  }
  const ok = confirmDeletion(userId, token);
  if (!ok) {
    return apiError(c, 403, "FORBIDDEN", "Confirmation token mismatch");
  }

  // The user row (and therefore all sessions) is gone — clear the cookie.
  c.header("Set-Cookie", buildClearCookieHeader());
  return c.json({ ok: true });
});
