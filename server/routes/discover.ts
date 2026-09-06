import { Hono } from "hono";
import { requireUser, type AuthedVariables } from "../middleware/auth.js";
import { getProvider } from "../providers/registry.js";
import { loadContext } from "../services/repository.js";
import { providerErrorToHttp, apiError } from "../httpErrors.js";

// Discover search (ADR-0006 D1, INH-365): provider-aware aggregation. Only providers whose
// capabilities advertise search are queried; others fail closed with PROVIDER_NOT_IMPLEMENTED.

export const discoverRoutes = new Hono<{ Variables: AuthedVariables }>();

discoverRoutes.use("*", requireUser);

discoverRoutes.get("/search", async (c) => {
  const userId = c.get("userId");
  const q = (c.req.query("q") ?? "").trim();
  const providerType = c.req.query("provider") ?? "github";
  const cursor = c.req.query("cursor") ?? null;

  if (!q) return apiError(c, 400, "VALIDATION", "q is required");

  const provider = getProvider(providerType);
  if (!provider?.search || !provider.capabilities.search) {
    return apiError(
      c,
      501,
      "PROVIDER_NOT_IMPLEMENTED",
      `${providerType} search is not available`,
    );
  }

  try {
    const page = await provider.search(
      q,
      loadContext(userId, providerType),
      cursor,
    );
    return c.json(page);
  } catch (error) {
    const mapped = providerErrorToHttp(error);
    if (mapped) return c.json(mapped.body, mapped.status);
    console.error("[discover] unexpected error:", error);
    return apiError(c, 500, "INTERNAL_ERROR", "Unexpected error");
  }
});
