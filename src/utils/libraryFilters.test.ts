// src/utils/libraryFilters.test.ts
import { describe, expect, it } from "vitest";
import type { SavedRepository } from "./gitstarsApi";
import {
  applyLibraryFilters,
  collectAiTags,
  collectLanguages,
  computeLibraryStats,
  formatCount,
  EMPTY_LIBRARY_FILTERS,
} from "./libraryFilters";

function item(overrides: Partial<SavedRepository> = {}): SavedRepository {
  return {
    id: "sr-1",
    version: 1,
    etag: '"sr-1:1"',
    status: "saved",
    aiTags: [],
    addedAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    repository: {
      id: "repo-1",
      providerType: "github",
      host: "github.com",
      remoteId: "1",
      canonicalKey: "o/r",
      name: "react",
      webUrl: "https://github.com/o/react",
      starsCount: 100,
      forksCount: 20,
      status: "active",
    },
    tags: [],
    ...overrides,
  };
}

describe("applyLibraryFilters", () => {
  const items = [
    item({
      id: "a",
      aiSummary: "A React UI 组件库",
      aiTags: ["前端", "React"],
      kinds: ["star"],
      repository: {
        ...item().repository,
        id: "r1",
        name: "alpha",
        primaryLanguage: "TypeScript",
        starsCount: 500,
        forksCount: 50,
      },
      tags: [{ id: "t1", name: "work" }],
    }),
    item({
      id: "b",
      note: "fork 后研究用",
      kinds: ["fork"],
      repository: {
        ...item().repository,
        id: "r2",
        name: "beta",
        primaryLanguage: "Go",
        starsCount: 10,
        forksCount: 2,
      },
    }),
    item({
      id: "c",
      aiTags: ["前端"],
      kinds: ["star", "fork"],
      repository: {
        ...item().repository,
        id: "r3",
        name: "gamma",
        primaryLanguage: "TypeScript",
        starsCount: 50,
        forksCount: 5,
      },
    }),
  ];

  it("empty filters return all items sorted by added_at desc", () => {
    expect(
      applyLibraryFilters(items, EMPTY_LIBRARY_FILTERS).map((i) => i.id),
    ).toEqual(["a", "b", "c"]);
  });

  it("search matches name, description, ai summary and note", () => {
    const f = (search: string) =>
      applyLibraryFilters(items, { ...EMPTY_LIBRARY_FILTERS, search }).map(
        (i) => i.id,
      );
    expect(f("alpha")).toEqual(["a"]); // name
    expect(f("react")).toEqual(["a"]); // ai summary text (component library)
    expect(f("研究用")).toEqual(["b"]); // note
    expect(f("zzz")).toEqual([]);
  });

  it("filters by star/fork kind inclusively", () => {
    const starOnly = applyLibraryFilters(items, {
      ...EMPTY_LIBRARY_FILTERS,
      kind: "star",
    }).map((i) => i.id);
    expect(starOnly.sort()).toEqual(["a", "c"]); // c has both kinds
    const forkOnly = applyLibraryFilters(items, {
      ...EMPTY_LIBRARY_FILTERS,
      kind: "fork",
    }).map((i) => i.id);
    expect(forkOnly.sort()).toEqual(["b", "c"]);
  });

  it("filters by AI tags with AND semantics across multi-select", () => {
    const one = applyLibraryFilters(items, {
      ...EMPTY_LIBRARY_FILTERS,
      aiTags: ["前端"],
    }).map((i) => i.id);
    expect(one.sort()).toEqual(["a", "c"]);
    const two = applyLibraryFilters(items, {
      ...EMPTY_LIBRARY_FILTERS,
      aiTags: ["前端", "React"],
    });
    expect(two.map((i) => i.id)).toEqual(["a"]);
  });

  it("filters by language, user tag and provider", () => {
    expect(
      applyLibraryFilters(items, {
        ...EMPTY_LIBRARY_FILTERS,
        language: "Go",
      }).map((i) => i.id),
    ).toEqual(["b"]);
    expect(
      applyLibraryFilters(items, { ...EMPTY_LIBRARY_FILTERS, tag: "work" }).map(
        (i) => i.id,
      ),
    ).toEqual(["a"]);
    expect(
      applyLibraryFilters(items, {
        ...EMPTY_LIBRARY_FILTERS,
        provider: "gitlab",
      }),
    ).toEqual([]);
  });

  it("sorts by stars and name", () => {
    expect(
      applyLibraryFilters(items, {
        ...EMPTY_LIBRARY_FILTERS,
        sort: "stars",
      }).map((i) => i.id),
    ).toEqual(["a", "c", "b"]);
    expect(
      applyLibraryFilters(items, {
        ...EMPTY_LIBRARY_FILTERS,
        sort: "name",
      }).map((i) => i.id),
    ).toEqual(["a", "b", "c"]);
  });
});

describe("collect/aggregate helpers", () => {
  it("collects distinct sorted languages and AI tags", () => {
    const items = [
      item({
        aiTags: ["工具"],
        repository: { ...item().repository, primaryLanguage: "Go" },
      }),
      item({
        aiTags: ["工具", "CLI"],
        repository: { ...item().repository, primaryLanguage: "Go" },
      }),
      item({
        aiTags: [],
        repository: { ...item().repository, primaryLanguage: undefined },
      }),
    ];
    expect(collectLanguages(items)).toEqual(["Go"]);
    expect(collectAiTags(items)).toEqual(["CLI", "工具"]);
  });

  it("computes library stats", () => {
    const items = [
      item(),
      item({
        repository: { ...item().repository, starsCount: 5, forksCount: 1 },
      }),
    ];
    expect(computeLibraryStats(items)).toEqual({
      total: 2,
      stars: 105,
      forks: 21,
    });
  });

  it("formats counts compactly", () => {
    expect(formatCount(999)).toBe("999");
    expect(formatCount(1200)).toBe("1.2k");
    expect(formatCount(56000)).toBe("56k");
  });
});
