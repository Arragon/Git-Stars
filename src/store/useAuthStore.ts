import { create } from "zustand";

export interface SessionUser {
  id: string;
  github_id: string;
  username: string;
  email?: string;
  avatar_url?: string;
  full_name?: string;
  last_synced_at?: string;
}

interface AuthState {
  user: SessionUser | null;
  setUser: (user: SessionUser | null) => void;
  isLoading: boolean;
  setIsLoading: (isLoading: boolean) => void;
  devLoginEnabled: boolean;
  devLoginUsername?: string;
  setDevLoginInfo: (enabled: boolean, username?: string) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
  isLoading: true,
  setIsLoading: (isLoading) => set({ isLoading }),
  devLoginEnabled: false,
  devLoginUsername: undefined,
  setDevLoginInfo: (devLoginEnabled, devLoginUsername) =>
    set({ devLoginEnabled, devLoginUsername }),
}));
