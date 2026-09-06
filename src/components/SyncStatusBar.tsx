// src/components/SyncStatusBar.tsx
// Compact sync status indicator.

import React from "react";
import { useSyncStatusStore } from "../store/useSyncStatusStore";
import { Loader2 } from "lucide-react";

export const SyncStatusBar: React.FC = () => {
  const {
    isOnline,
    pullStatus,
    pushStatus,
    pendingMutationCount,
    unresolvedConflictCount,
    pullError,
  } = useSyncStatusStore();

  // Determine display state (priority order)
  let dotColor: string;
  let label: string;
  let icon: React.ReactNode = null;

  if (!isOnline) {
    dotColor = "bg-gray-400";
    label = "Offline — changes saved locally";
  } else if (unresolvedConflictCount > 0) {
    dotColor = "bg-red-500";
    label = `${unresolvedConflictCount} conflict${unresolvedConflictCount > 1 ? "s" : ""} need attention`;
  } else if (pullStatus === "pulling") {
    dotColor = "bg-blue-500";
    label = "Syncing...";
    icon = <Loader2 className="w-3 h-3 animate-spin text-blue-600" />;
  } else if (pushStatus === "pushing") {
    dotColor = "bg-blue-500";
    label = "Pushing changes...";
    icon = <Loader2 className="w-3 h-3 animate-spin text-blue-600" />;
  } else if (pendingMutationCount > 0) {
    dotColor = "bg-orange-500";
    label = `${pendingMutationCount} change${pendingMutationCount > 1 ? "s" : ""} pending`;
  } else if (pullStatus === "error" || pushStatus === "error") {
    dotColor = "bg-red-500";
    label = pullError || "Sync error";
  } else if (pushStatus === "paused") {
    dotColor = "bg-orange-400";
    label = "Sync paused";
  } else {
    dotColor = "bg-green-500";
    label = "Synced";
  }

  return (
    <div
      className="flex items-center gap-1.5 text-xs text-gray-300"
      role="status"
      aria-live="polite"
      title={label}
    >
      {!icon && (
        <span
          className={`inline-block w-2 h-2 rounded-full ${dotColor}`}
          aria-hidden="true"
        />
      )}
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </div>
  );
};
