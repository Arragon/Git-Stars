// src/store/useSyncDrawerStore.ts
// UI state for the global sync drawer (pending mutations + conflicts).

import { create } from "zustand";

interface SyncDrawerState {
  open: boolean;
  toggle(): void;
  close(): void;
}

export const useSyncDrawerStore = create<SyncDrawerState>((set) => ({
  open: false,
  toggle: () => set((s) => ({ open: !s.open })),
  close: () => set({ open: false }),
}));
