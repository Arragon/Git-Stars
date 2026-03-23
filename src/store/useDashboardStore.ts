import { create } from 'zustand';

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
  type: 'star' | 'fork';
  starred_at?: string;
  created_at?: string;
  github_created_at?: string;
  github_updated_at?: string;
}

interface DashboardState {
  projects: Project[];
  setProjects: (projects: Project[]) => void;
  isLoadingData: boolean;
  setIsLoadingData: (isLoading: boolean) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  filterType: 'all' | 'star' | 'fork';
  setFilterType: (type: 'all' | 'star' | 'fork') => void;
  filterLanguage: string;
  setFilterLanguage: (language: string) => void;
  sortBy: 'starred_at' | 'stars_count' | 'name';
  setSortBy: (sort: 'starred_at' | 'stars_count' | 'name') => void;
  sortOrder: 'asc' | 'desc';
  setSortOrder: (order: 'asc' | 'desc') => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  projects: [],
  setProjects: (projects) => set({ projects }),
  isLoadingData: false,
  setIsLoadingData: (isLoadingData) => set({ isLoadingData }),
  searchQuery: '',
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  filterType: 'all',
  setFilterType: (filterType) => set({ filterType }),
  filterLanguage: 'all',
  setFilterLanguage: (filterLanguage) => set({ filterLanguage }),
  sortBy: 'starred_at',
  setSortBy: (sortBy) => set({ sortBy }),
  sortOrder: 'desc',
  setSortOrder: (sortOrder) => set({ sortOrder }),
}));
