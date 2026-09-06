import { create } from "zustand";
import { localStore } from "../data";
import type { CachedRepository, CachedSavedRepository } from "../data/types";

// Project view model — mapped from cached data (CachedSavedRepository + CachedRepository).
// Kept compatible with existing Dashboard/ProjectCard UI.
export interface Project {
  id: string;
  github_id: number;
  name: string;
  full_name: string;
  description: string;
  language: string;
  stars_count: number;
  forks_count: number;
  html_url: string;
  type: "star" | "fork";
  starred_at?: string;
  created_at?: string;
  github_created_at?: string;
  github_updated_at?: string;
  activity_index?: number;
  activity_details?: {
    commits: number;
    issues: number;
    prs: number;
    releases: number;
  };
  activity_analyzed_at?: string;
  ai_summary?: string;
  ai_tags?: string[];
  is_summarizing?: boolean;
}

// Map cached entities to the Project view model.
function mapToProject(
  sr: CachedSavedRepository,
  repo: CachedRepository | undefined,
): Project {
  const r = repo;
  return {
    id: sr.id,
    github_id: r ? Number(r.remoteId) || 0 : 0,
    name: r?.name ?? "Unknown",
    full_name: r
      ? r.namespacePath
        ? `${r.namespacePath}/${r.name}`
        : r.name
      : "Unknown",
    description: r?.description ?? "",
    language: r?.primaryLanguage ?? "",
    stars_count: r?.starsCount ?? 0,
    forks_count: r?.forksCount ?? 0,
    html_url: r?.webUrl ?? "",
    type: sr.status === "forked" ? "fork" : "star",
    starred_at: sr.addedAt,
    created_at: sr.addedAt,
    github_created_at: r?.providerCreatedAt,
    github_updated_at: r?.providerUpdatedAt,
    ai_tags: sr.aiTags ?? [],
  };
}

interface DashboardState {
  projects: Project[];
  setProjects: (projects: Project[]) => void;
  isLoadingData: boolean;
  setIsLoadingData: (isLoading: boolean) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  filterType: "all" | "star" | "fork";
  setFilterType: (type: "all" | "star" | "fork") => void;
  filterLanguage: string;
  setFilterLanguage: (language: string) => void;
  filterTag: string;
  setFilterTag: (tag: string) => void;
  sortBy: "starred_at" | "stars_count" | "name" | "activity";
  setSortBy: (sort: "starred_at" | "stars_count" | "name" | "activity") => void;
  sortOrder: "asc" | "desc";
  setSortOrder: (order: "asc" | "desc") => void;

  // Load projects from IndexedDB cache.
  loadFromCache(): Promise<void>;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  projects: [],
  setProjects: (projects) => set({ projects }),
  isLoadingData: false,
  setIsLoadingData: (isLoadingData) => set({ isLoadingData }),
  searchQuery: "",
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  filterType: "all",
  setFilterType: (filterType) => set({ filterType }),
  filterLanguage: "all",
  setFilterLanguage: (filterLanguage) => set({ filterLanguage }),
  filterTag: "all",
  setFilterTag: (filterTag) => set({ filterTag }),
  sortBy: "starred_at",
  setSortBy: (sortBy) => set({ sortBy }),
  sortOrder: "desc",
  setSortOrder: (sortOrder) => set({ sortOrder }),

  loadFromCache: async () => {
    try {
      const [savedRepos, repos] = await Promise.all([
        localStore.getSavedRepositories(),
        localStore.getRepositories(),
      ]);

      // Build repo lookup
      const repoMap = new Map<string, CachedRepository>();
      for (const r of repos) {
        repoMap.set(r.id, r);
      }

      // Map active saved repos to Project view models
      const active = savedRepos.filter((sr) => !sr.deletedAt);
      const projects = active.map((sr) =>
        mapToProject(sr, repoMap.get(sr.repositoryId)),
      );

      set({ projects });
    } catch (err) {
      console.error("[Dashboard] Failed to load from cache:", err);
    }
  },
}));
