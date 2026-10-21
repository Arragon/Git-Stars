// src/lib/libraryRouteState.ts
// URL <-> Library filters (M8-04). Kept pure so the encode/decode rules are testable and
// a hand-edited URL can never inject an invalid filter or a foreign link.

import {
  EMPTY_LIBRARY_FILTERS,
  type LibraryFilters,
} from "../utils/libraryFilters";

const SORTS = new Set(["added_at", "stars", "name"]);
const KINDS = new Set(["star", "fork"]);
const MAX_SEARCH = 200;

function clean(value: string | null): string {
  return (value ?? "").trim().slice(0, MAX_SEARCH);
}

/** Parse filters from a query string; unknown/invalid values fall back to defaults. */
export function parseLibraryRoute(search: string): LibraryFilters {
  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  const sort = params.get("sort") ?? "";
  const kind = params.get("kind") ?? "";
  return {
    search: clean(params.get("q")),
    provider: clean(params.get("provider")),
    tag: clean(params.get("tag")),
    aiTags: clean(params.get("ai"))
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
    language: clean(params.get("lang")),
    kind: KINDS.has(kind) ? kind : "",
    sort: SORTS.has(sort) ? (sort as LibraryFilters["sort"]) : "added_at",
  };
}

/** Serialize non-default filters so the canonical URL stays short. */
export function serializeLibraryRoute(filters: LibraryFilters): string {
  const params = new URLSearchParams();
  if (filters.search) params.set("q", filters.search);
  if (filters.provider) params.set("provider", filters.provider);
  if (filters.tag) params.set("tag", filters.tag);
  if (filters.aiTags.length > 0) params.set("ai", filters.aiTags.join(","));
  if (filters.language) params.set("lang", filters.language);
  if (filters.kind) params.set("kind", filters.kind);
  if (filters.sort !== "added_at") params.set("sort", filters.sort);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** Same-origin app path for the Repository View "back" link, or "/library". */
export function safeReturnPath(raw: unknown): string {
  if (typeof raw !== "string") return "/library";
  const value = raw.trim();
  if (!value.startsWith("/") || value.startsWith("//")) return "/library";
  if (value.includes("\\") || value.startsWith("/api/")) return "/library";
  return value;
}

export { EMPTY_LIBRARY_FILTERS };
