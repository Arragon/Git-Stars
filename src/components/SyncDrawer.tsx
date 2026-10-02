// src/components/SyncDrawer.tsx
// Globally reachable slide-over with the pending-mutations and conflict
// panels. Rendered once by Layout; opened from the SyncStatusBar pill.

import React, { useEffect } from "react";
import { X } from "lucide-react";
import { useSyncDrawerStore } from "../store/useSyncDrawerStore";
import { PendingMutations } from "./PendingMutations";
import { ConflictPanel } from "./ConflictPanel";

export const SyncDrawer: React.FC = () => {
  const open = useSyncDrawerStore((s) => s.open);
  const close = useSyncDrawerStore((s) => s.close);

  // Close on Escape for keyboard users.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="同步状态"
    >
      <div
        className="absolute inset-0 bg-black/40"
        onClick={close}
        aria-hidden="true"
      />
      <aside className="relative w-full max-w-md h-full bg-surface shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-line-strong">
          <h2 className="text-base font-semibold text-ink">同步状态</h2>
          <button
            onClick={close}
            className="p-2 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded hover:bg-subtle"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          <PendingMutations />
          <div className="border-t border-line-strong" />
          <ConflictPanel />
        </div>
      </aside>
    </div>
  );
};
