// src/utils/autoCollect.ts
// Auto-collect adapter: reuses the legacy keyword/scoring engine
// (matchProjectToCollection) to suggest which saved repositories belong in a
// List, based on the List's name/description and each repo's AI summary/tags.

import type { SavedRepository } from "./gitstarsApi";
import {
  matchProjectToCollection,
  type CollectionMatchResult,
} from "./collections";

export interface AutoCollectTarget {
  id: string;
  name: string;
  description: string;
}

export interface AutoCollectMatch {
  item: SavedRepository;
  score: number;
  reason: string;
}

/**
 * Score one saved repository against a List profile. Returns the raw match
 * result; callers decide the threshold (matchProjectToCollection already
 * requires a minimum score for `matched`).
 */
export function matchSavedToList(
  item: SavedRepository,
  target: AutoCollectTarget,
): CollectionMatchResult {
  const pseudoProject = {
    id: item.id,
    github_id: 0,
    name: item.repository.name,
    full_name: `${item.repository.namespacePath ?? ""}${item.repository.name}`,
    description: item.repository.description ?? "",
    language: item.repository.primaryLanguage ?? "",
    stars_count: item.repository.starsCount,
    forks_count: item.repository.forksCount,
    html_url: item.repository.webUrl,
    type: "star" as const,
    ai_summary: item.aiSummary ?? "",
    ai_tags: item.aiTags,
  };
  const pseudoCollection = {
    id: target.id,
    user_id: "",
    name: target.name,
    description: target.description,
    auto_collect_enabled: true,
  };
  return matchProjectToCollection(pseudoProject, pseudoCollection);
}

/**
 * Pick library items that match the List profile. Existing members can be
 * excluded by the caller via `excludeIds`.
 */
export function autoCollectForList(
  items: SavedRepository[],
  target: AutoCollectTarget,
  excludeIds: Set<string> = new Set(),
): AutoCollectMatch[] {
  const matches: AutoCollectMatch[] = [];
  for (const item of items) {
    if (excludeIds.has(item.id)) continue;
    const result = matchSavedToList(item, target);
    if (result.matched) {
      matches.push({ item, score: result.score, reason: result.reason });
    }
  }
  return matches.sort((a, b) => b.score - a.score);
}
