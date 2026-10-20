// src/lib/libraryRouteState.test.ts
// M8-04: URL <-> filters round trip, invalid input fallback, safe back paths.

import { describe, expect, it } from "vitest";
import {
  parseLibraryRoute,
  safeReturnPath,
  serializeLibraryRoute,
} from "./libraryRouteState";
import { EMPTY_LIBRARY_FILTERS } from "../utils/libraryFilters";

describe("parseLibraryRoute", () => {
  it("round-trips every supported filter", () => {
    const filters = {
      search: "react hooks",
      provider: "github",
      tag: "work",
      aiTags: ["前端", "state"],
      language: "TypeScript",
      kind: "fork",
      sort: "stars" as const,
    };
    expect(parseLibraryRoute(serializeLibraryRoute(filters))).toEqual(filters);
  });

  it("returns defaults for an empty query", () => {
    expect(parseLibraryRoute("")).toEqual(EMPTY_LIBRARY_FILTERS);
    expect(serializeLibraryRoute(EMPTY_LIBRARY_FILTERS)).toBe("");
  });

  it("ignores invalid sort/kind and trims values", () => {
    const parsed = parseLibraryRoute(
      "?q=%20react%20&sort=random&kind=owner&ai=a%2C%20%2Cb",
    );
    expect(parsed.search).toBe("react");
    expect(parsed.sort).toBe("added_at");
    expect(parsed.kind).toBe("");
    expect(parsed.aiTags).toEqual(["a", "b"]);
  });

  it("caps oversized search input", () => {
    expect(parseLibraryRoute(`?q=${"x".repeat(500)}`).search).toHaveLength(200);
  });
});

describe("safeReturnPath", () => {
  it("accepts only same-origin app paths", () => {
    expect(safeReturnPath("/library?q=react&sort=stars")).toBe(
      "/library?q=react&sort=stars",
    );
    for (const bad of [
      "https://evil.com",
      "//evil.com",
      "/\\evil.com",
      "javascript:alert(1)",
      "/api/library",
      undefined,
      42,
    ]) {
      expect(safeReturnPath(bad)).toBe("/library");
    }
  });
});
