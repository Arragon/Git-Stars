import { Project } from '../store/useDashboardStore';

export const ALL_PROJECTS_COLLECTION_ID = 'system:all-projects';
export const GITHUB_STARS_COLLECTION_ID = 'system:github-stars';

export interface Collection {
  id: string;
  user_id: string;
  name: string;
  description?: string | null;
  auto_collect_enabled: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface CollectionProject {
  id?: string;
  collection_id: string;
  project_id: string;
  source: 'manual' | 'auto';
  reason?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface CollectionMatchResult {
  matched: boolean;
  score: number;
  reason: string;
  matchedKeywords: string[];
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'your', 'this', 'that', 'tool',
  'tools', 'project', 'projects', 'repo', 'repository', 'github', 'favorite',
  'favorites', 'collection', 'collections', '收藏', '收藏夹', '项目', '仓库', '相关',
  '一个', '多个', '管理', '自动', '主题', '合集'
]);

function normalizeText(text: string = '') {
  return text
    .toLowerCase()
    .replace(/[_/\\|.-]+/g, ' ')
    .replace(/[^\u4e00-\u9fffa-z0-9+#\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactText(text: string = '') {
  return normalizeText(text).replace(/\s+/g, '');
}

function addHanFragments(target: Set<string>, value: string) {
  if (value.length < 2) return;
  target.add(value);
  const maxFragmentLength = Math.min(4, value.length);
  for (let length = 2; length <= maxFragmentLength; length++) {
    for (let index = 0; index <= value.length - length; index++) {
      target.add(value.slice(index, index + length));
    }
  }
}

export function tokenizeMixedText(text: string = '') {
  const normalized = normalizeText(text);
  const tokens = new Set<string>();
  const matches = normalized.match(/[\u4e00-\u9fff]{2,}|[a-z0-9+#]{2,}/g) || [];

  matches.forEach((match) => {
    if (/^[\u4e00-\u9fff]+$/.test(match)) {
      addHanFragments(tokens, match);
      return;
    }

    if (!STOP_WORDS.has(match)) {
      tokens.add(match);
    }
  });

  return Array.from(tokens);
}

export function matchProjectToCollection(project: Project, collection: Collection): CollectionMatchResult {
  const aiSummary = project.ai_summary?.trim() || '';
  const aiTags = Array.isArray(project.ai_tags) ? project.ai_tags.filter(Boolean) : [];
  const hasAiSignal = Boolean(aiSummary || aiTags.length);

  if (!hasAiSignal) {
    return {
      matched: false,
      score: 0,
      reason: 'Skipped because this project does not have AI summary or AI tags yet.',
      matchedKeywords: []
    };
  }

  const collectionProfile = `${collection.name} ${collection.description || ''}`.trim();
  const collectionTokens = tokenizeMixedText(collectionProfile);
  const summaryTokens = new Set(tokenizeMixedText(aiSummary));
  const tagTokens = new Set(aiTags.flatMap((tag) => tokenizeMixedText(tag)));
  const projectTokens = new Set([
    ...summaryTokens,
    ...tagTokens,
    ...tokenizeMixedText(project.name),
    ...tokenizeMixedText(project.description || ''),
    ...tokenizeMixedText(project.language || '')
  ]);

  let score = 0;
  const reasons: string[] = [];
  const matchedKeywords = collectionTokens.filter((token) => projectTokens.has(token));

  const normalizedProfile = compactText(collectionProfile);
  const normalizedName = compactText(collection.name);
  const normalizedSummary = compactText(aiSummary);

  const tagMatches = aiTags.filter((tag) => {
    const compactTag = compactText(tag);
    return Boolean(compactTag) && (
      compactTag.includes(normalizedName) ||
      normalizedName.includes(compactTag) ||
      normalizedProfile.includes(compactTag)
    );
  });

  if (tagMatches.length > 0) {
    score += Math.min(tagMatches.length * 4, 8);
    reasons.push(`AI tags matched: ${tagMatches.slice(0, 3).join(', ')}`);
  }

  const summaryMatches = collectionTokens.filter((token) => summaryTokens.has(token));
  if (summaryMatches.length > 0) {
    score += Math.min(summaryMatches.length * 2, 6);
    reasons.push(`AI summary matched: ${summaryMatches.slice(0, 4).join(', ')}`);
  }

  const keywordMatches = matchedKeywords.filter((token) => !summaryMatches.includes(token));
  if (keywordMatches.length > 0) {
    score += Math.min(keywordMatches.length, 3);
    reasons.push(`Keywords overlapped: ${keywordMatches.slice(0, 4).join(', ')}`);
  }

  if (normalizedName && normalizedSummary.includes(normalizedName)) {
    score += 3;
    reasons.push('Collection title appears directly in the AI summary');
  }

  if (project.language) {
    const normalizedLanguage = compactText(project.language);
    if (normalizedLanguage && normalizedProfile.includes(normalizedLanguage)) {
      score += 1;
      reasons.push(`Language matched: ${project.language}`);
    }
  }

  return {
    matched: score >= 4,
    score,
    reason: reasons.join('; ') || 'Weak semantic overlap',
    matchedKeywords
  };
}
