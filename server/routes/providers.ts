import { Hono } from "hono";
import { requireUser, type AuthedVariables } from "../middleware/auth.js";
import {
  listProviderAccounts,
  revokeProviderAccount,
} from "../services/credentials.js";
import { apiError } from "../httpErrors.js";

// Forge connections (ADR-0005). Tokens are never returned; GitHub connect happens through
// the OAuth flow in routes/auth.ts. GitLab/Gitee connect is deferred (ADR-0002 stubs).
export const providerRoutes = new Hono<{ Variables: AuthedVariables }>();

providerRoutes.use("*", requireUser);

providerRoutes.get("/", (c) => {
  const userId = c.get("userId");
  return c.json(listProviderAccounts(userId));
});

providerRoutes.post("/:type/revoke", (c) => {
  const userId = c.get("userId");
  const type = c.req.param("type");
  const host = c.req.query("host") || undefined;
  const changed = revokeProviderAccount(userId, type, host);
  if (changed === 0) {
    return apiError(
      c,
      404,
      "NOT_FOUND",
      "No active connection for this provider",
    );
  }
  return c.json({ ok: true, revoked: changed });
});
