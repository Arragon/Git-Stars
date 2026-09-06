// src/components/OfflineBanner.tsx
// Banner shown when user is offline.

import React, { useState, useEffect } from "react";
import { useSyncStatusStore } from "../store/useSyncStatusStore";
import { WifiOff, X } from "lucide-react";

export const OfflineBanner: React.FC = () => {
  const isOnline = useSyncStatusStore((s) => s.isOnline);
  const [dismissed, setDismissed] = useState(false);

  // Reset dismissed state when coming back online
  useEffect(() => {
    if (isOnline) setDismissed(false);
  }, [isOnline]);

  if (isOnline || dismissed) return null;

  return (
    <div
      className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center justify-between gap-3"
      role="alert"
    >
      <div className="flex items-center gap-2 text-sm text-amber-800">
        <WifiOff className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
        <span>
          You are offline. Changes are saved locally and will sync when
          reconnected.
        </span>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="text-amber-600 hover:text-amber-800 p-1 rounded hover:bg-amber-100"
        aria-label="Dismiss offline banner"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
