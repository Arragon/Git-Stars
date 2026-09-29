import { Hono } from "hono";
import { getPublicSnapshot, listCatalog } from "../services/publication.js";
import { apiError } from "../httpErrors.js";
import { NOT_FOUND_MESSAGE } from "./public.js";

// Anonymous hub catalog (M5, INH-435). Read-only over active + hub-opted-in
// publications; never exposes link-only or revoked/taken-down shares.

export const hubRoutes = new Hono();

hubRoutes.get("/hub/lists", (c) => {
  const sortParam = c.req.query("sort");
  const limitRaw = Number(c.req.query("limit"));
  return c.json(
    listCatalog({
      q: c.req.query("q") || undefined,
      sort: sortParam === "title" ? "title" : "recent",
      cursor: c.req.query("cursor") || undefined,
      limit:
        Number.isFinite(limitRaw) && limitRaw > 0
          ? Math.floor(limitRaw)
          : undefined,
    }),
  );
});

hubRoutes.get("/hub/lists/:shareId", (c) => {
  const snapshot = getPublicSnapshot(c.req.param("shareId"));
  if (!snapshot) {
    return apiError(c, 404, "NOT_FOUND", NOT_FOUND_MESSAGE);
  }
  return c.json(snapshot);
});
