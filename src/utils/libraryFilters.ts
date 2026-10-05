// src/utils/libraryFilters.ts
// Pure client-side filter/statistics engine for the Library page. Everything
// here runs over cached items too, so in-library search and filtering work
// offline. Kept pure for deterministic unit tests.

import type { SavedRepository } from "./gitstarsApi";

export interface LibraryFilters {
  /** Free-text search: name, namespace, description, AI summary and note. */
  search: string;
  provider: string; // "" = all
  /** User tag (single, from the tags dropdown). */
  tag: string; // "" = all
  /** AI tags (multi-select chips). */
  aiTags: string[];
  language: string; // "" = all
  /** "star" | "fork" | "" (all). */
  kind: string;
  sort: "added_at" | "stars" | "name";
}

export const EMPTY_LIBRARY_FILTERS: LibraryFilters = {
  search: "",
  provider: "",
  tag: "",
  aiTags: [],
  language: "",
  kind: "",
  sort: "added_at",
};

export function applyLibraryFilters(
  items: SavedRepository[],
  filters: LibraryFilters,
): SavedRepository[] {
  const searchLower = filters.search.trim().toLowerCase();
  const out = items.filter((it) => {
    if (filters.provider && it.repository.providerType !== filters.provider) {
      return false;
    }
    if (filters.tag && !it.tags.some((t) => t.name === filters.tag)) {
      return false;
    }
    if (
      filters.aiTags.length > 0 &&
      !filters.aiTags.every((tag) => it.aiTags.includes(tag))
    ) {
      return false;
    }
    if (
      filters.language &&
      (it.repository.primaryLanguage ?? "") !== filters.language
    ) {
      return false;
    }
    if (filters.kind && !(it.kinds ?? []).includes(filters.kind)) {
      return false;
    }
    if (searchLower) {
      const haystack = [
        it.repository.name,
        it.repository.namespacePath ?? "",
        it.repository.description ?? "",
        it.aiSummary ?? "",
        it.note ?? "",
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(searchLower)) return false;
    }
    return true;
  });

  const sorted = [...out];
  if (filters.sort === "stars") {
    sorted.sort((a, b) => b.repository.starsCount - a.repository.starsCount);
  } else if (filters.sort === "name") {
    sorted.sort((a, b) => a.repository.name.localeCompare(b.repository.name));
  } else {
    sorted.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  }
  return sorted;
}

/** Distinct languages present in the library, sorted alphabetically. */
export function collectLanguages(items: SavedRepository[]): string[] {
  const langs = new Set<string>();
  for (const it of items) {
    if (it.repository.primaryLanguage) langs.add(it.repository.primaryLanguage);
  }
  return Array.from(langs).sort((a, b) => a.localeCompare(b));
}

/** Distinct AI tags across the library, sorted alphabetically. */
export function collectAiTags(items: SavedRepository[]): string[] {
  const tags = new Set<string>();
  for (const it of items) {
    for (const tag of it.aiTags) tags.add(tag);
  }
  return Array.from(tags).sort((a, b) => a.localeCompare(b));
}

export interface LibraryStats {
  total: number;
  stars: number;
  forks: number;
}

export function computeLibraryStats(items: SavedRepository[]): LibraryStats {
  return {
    total: items.length,
    stars: items.reduce((sum, it) => sum + it.repository.starsCount, 0),
    forks: items.reduce((sum, it) => sum + it.repository.forksCount, 0),
  };
}

/** Compact "1.2k" style formatting for stat display. */
export function formatCount(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return `${k >= 100 ? Math.round(k) : Math.round(k * 10) / 10}k`;
  }
  return String(n);
}
