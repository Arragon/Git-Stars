// src/components/PendingMutations.tsx
// Panel showing pending mutations with retry/cancel actions.

import React, { useEffect, useState, useCallback } from "react";
import type { QueuedMutation } from "../data/types";
import { mutationQueue, pushReplay } from "../sync/syncClient";
import { RefreshCw, XCircle, Loader2 } from "lucide-react";

const entityLabel = (entity: string): string => {
  switch (entity) {
    case "saved_repository": return "Repository";
    case "list": return "List";
    case "list_item": return "List Item";
    case "tag": return "Tag";
    case "repository_tag": return "Tag Link";
    case "preference": return "Preference";
    default: return entity;
  }
};

const opLabel = (op: string): string => {
  switch (op) {
    case "create": return "Create";
    case "update": return "Update";
    case "delete": return "Delete";
    default: return op;
  }
};

export const PendingMutations: React.FC = () => {
  const [mutations, setMutations] = useState<QueuedMutation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyAll, setBusyAll] = useState(false);

  const reload = useCallback(async () => {
    try {
      const pending = await mutationQueue.getPending();
      setMutations(pending);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleRetry = async (id: string) => {
    setBusyId(id);
    try {
      await pushReplay.replayOne(id);
      await reload();
    } finally {
      setBusyId(null);
    }
  };

  const handleCancel = async (id: string) => {
    setBusyId(id);
    try {
      await mutationQueue.quarantine(id, "Cancelled by user");
      await reload();
    } finally {
      setBusyId(null);
    }
  };

  const handleRetryAll = async () => {
    setBusyAll(true);
    try {
      await pushReplay.replayAll();
      await reload();
    } finally {
      setBusyAll(false);
    }
  };

  if (loading) {
    return <div className="text-sm text-gray-500 p-4">Loading...</div>;
  }

  if (mutations.length === 0) {
    return <div className="text-sm text-gray-500 p-4">No pending changes.</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">
          Pending Changes ({mutations.length})
        </h3>
        <button
          onClick={handleRetryAll}
          disabled={busyAll}
          className="inline-flex items-center gap-1 text-xs bg-gray-900 text-white px-2.5 py-1.5 rounded hover:bg-gray-700 disabled:opacity-50"
        >
          {busyAll ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <RefreshCw className="w-3 h-3" />
          )}
          Retry All
        </button>
      </div>

      <ul className="space-y-1.5">
        {mutations.map((m) => (
          <li
            key={m.id}
            className="flex items-center justify-between gap-2 bg-white rounded border border-gray-200 px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-gray-800 truncate">
                {entityLabel(m.entity)} · {opLabel(m.operation)}
              </div>
              <div className="text-xs text-gray-500 truncate">
                {m.entityId} · {new Date(m.createdAt).toLocaleString()}
                {m.lastError && (
                  <span className="text-red-500 ml-1">· {m.lastError}</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={() => handleRetry(m.id)}
                disabled={busyId === m.id}
                className="text-gray-500 hover:text-blue-600 p-1 rounded hover:bg-blue-50"
                title="Retry"
              >
                {busyId === m.id ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
              </button>
              <button
                onClick={() => handleCancel(m.id)}
                disabled={busyId === m.id}
                className="text-gray-500 hover:text-red-600 p-1 rounded hover:bg-red-50"
                title="Cancel"
              >
                <XCircle className="w-3.5 h-3.5" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};
