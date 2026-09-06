// src/store/useSyncStatusStore.ts
// Global sync status tracking store.

import { create } from "zustand";
import { mutationQueue, conflictLog } from "../sync/syncClient";
import { localStore } from "../data";

type PullStatus = "idle" | "pulling" | "error";
type PushStatus = "idle" | "pushing" | "paused" | "error";
type CacheStatus = "fresh" | "stale" | "empty";

interface SyncStatusState {
  // Connection state
  isOnline: boolean;

  // Pull sync state
  pullStatus: PullStatus;
  lastPullAt?: string;
  pullError?: string;

  // Push sync state
  pushStatus: PushStatus;
  pendingMutationCount: number;
  quarantinedCount: number;

  // Conflict state
  unresolvedConflictCount: number;

  // Cache state
  repositoryCacheStatus: CacheStatus;

  // Actions
  setOnline(online: boolean): void;
  setPullStatus(status: PullStatus): void;
  setPushStatus(status: PushStatus): void;
  setPullError(error?: string): void;
  updatePendingCount(): Promise<void>;
  updateConflictCount(): Promise<void>;
  updateCacheStatus(): Promise<void>;
  refreshAll(): Promise<void>;
  reset(): void;
}

export const useSyncStatusStore = create<SyncStatusState>((set, get) => ({
  isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
  pullStatus: "idle",
  lastPullAt: undefined,
  pullError: undefined,
  pushStatus: "idle",
  pendingMutationCount: 0,
  quarantinedCount: 0,
  unresolvedConflictCount: 0,
  repositoryCacheStatus: "empty",

  setOnline: (online) => set({ isOnline: online }),
  setPullStatus: (pullStatus) => set({ pullStatus }),
  setPushStatus: (pushStatus) => set({ pushStatus }),
  setPullError: (pullError) => set({ pullError }),

  updatePendingCount: async () => {
    try {
      const pending = await mutationQueue.getPending();
      const quarantined = pending.filter((m) => m.status === "quarantined").length;
      set({ pendingMutationCount: pending.length, quarantinedCount: quarantined });
    } catch {
      // ignore
    }
  },

  updateConflictCount: async () => {
    try {
      const unresolved = await conflictLog.getUnresolved();
      set({ unresolvedConflictCount: unresolved.length });
    } catch {
      // ignore
    }
  },

  updateCacheStatus: async () => {
    try {
      const saved = await localStore.getSavedRepositories();
      const active = saved.filter((s) => !s.deletedAt);
      if (active.length === 0) {
        set({ repositoryCacheStatus: "empty" });
      } else {
        const cursor = await localStore.getSyncCursor();
        if (!cursor?.lastSyncedAt) {
          set({ repositoryCacheStatus: "stale" });
        } else {
          const age = Date.now() - new Date(cursor.lastSyncedAt).getTime();
          // Stale if older than 5 minutes
          set({ repositoryCacheStatus: age > 5 * 60 * 1000 ? "stale" : "fresh" });
        }
      }
    } catch {
      set({ repositoryCacheStatus: "empty" });
    }
  },

  refreshAll: async () => {
    const state = get();
    await Promise.all([
      state.updatePendingCount(),
      state.updateConflictCount(),
      state.updateCacheStatus(),
    ]);
  },

  reset: () =>
    set({
      pullStatus: "idle",
      lastPullAt: undefined,
      pullError: undefined,
      pushStatus: "idle",
      pendingMutationCount: 0,
      quarantinedCount: 0,
      unresolvedConflictCount: 0,
      repositoryCacheStatus: "empty",
    }),
}));

// --- Polling helper ---

let pollInterval: ReturnType<typeof setInterval> | null = null;

export function startSyncStatusPolling(intervalMs = 5000) {
  if (pollInterval) return;
  const store = useSyncStatusStore.getState();
  void store.refreshAll();
  pollInterval = setInterval(() => {
    void useSyncStatusStore.getState().refreshAll();
  }, intervalMs);
}

export function stopSyncStatusPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}
