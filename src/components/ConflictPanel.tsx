// src/components/ConflictPanel.tsx
// Panel showing unresolved sync conflicts with resolution actions.

import React, { useEffect, useState, useCallback } from "react";
import type { ConflictRecord } from "../sync/conflictLog";
import { conflictLog, mutationQueue, pushReplay } from "../sync/syncClient";
import { AlertTriangle, Check, X, Server, Loader2 } from "lucide-react";

export const ConflictPanel: React.FC = () => {
  const [conflicts, setConflicts] = useState<ConflictRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const unresolved = await conflictLog.getUnresolved();
      setConflicts(unresolved);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleKeepMine = async (conflict: ConflictRecord) => {
    setBusyId(conflict.id);
    try {
      // Re-enqueue mutation with higher base version (server version + 1)
      const pending = await mutationQueue.getPending();
      const existing = pending.find(
        (m) => m.entityId === conflict.entityId && m.entity === conflict.entityType,
      );
      if (existing) {
        await mutationQueue.updateMutation(existing.id, {
          baseVersion: conflict.serverVersion + 1,
        });
      }
      await conflictLog.markResolved(conflict.id, conflict.localPayload);
      // Trigger push to retry
      await pushReplay.replayAll();
      await reload();
    } finally {
      setBusyId(null);
    }
  };

  const handleUseServer = async (conflict: ConflictRecord) => {
    setBusyId(conflict.id);
    try {
      // Discard local mutation, accept server state
      const pending = await mutationQueue.getPending();
      const existing = pending.find(
        (m) => m.entityId === conflict.entityId && m.entity === conflict.entityType,
      );
      if (existing) {
        await mutationQueue.complete(existing.id);
      }
      await conflictLog.markResolved(conflict.id, conflict.serverSnapshot);
      await reload();
    } finally {
      setBusyId(null);
    }
  };

  const handleDiscard = async (conflict: ConflictRecord) => {
    setBusyId(conflict.id);
    try {
      const pending = await mutationQueue.getPending();
      const existing = pending.find(
        (m) => m.entityId === conflict.entityId && m.entity === conflict.entityType,
      );
      if (existing) {
        await mutationQueue.quarantine(existing.id, "Discarded by user");
      }
      await conflictLog.discard(conflict.id);
      await reload();
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return <div className="text-sm text-gray-500 p-4">Loading conflicts...</div>;
  }

  if (conflicts.length === 0) {
    return (
      <div className="text-sm text-gray-500 p-4">No unresolved conflicts.</div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-red-700 flex items-center gap-1.5">
        <AlertTriangle className="w-4 h-4" />
        Unresolved Conflicts ({conflicts.length})
      </h3>

      <ul className="space-y-2">
        {conflicts.map((c) => (
          <li
            key={c.id}
            className="bg-white rounded border border-red-200 p-3 space-y-2"
          >
            <div className="text-sm font-medium text-gray-800">
              {c.entityType} · {c.operation}
            </div>
            <div className="text-xs text-gray-500">
              Entity: {c.entityId}
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-blue-50 rounded p-2 border border-blue-100">
                <div className="font-medium text-blue-800 mb-1">
                  Your version (v{c.baseVersion})
                </div>
                <pre className="text-blue-700 whitespace-pre-wrap break-all font-mono text-[10px] max-h-20 overflow-auto">
                  {JSON.stringify(c.localPayload, null, 1)}
                </pre>
              </div>
              <div className="bg-green-50 rounded p-2 border border-green-100">
                <div className="font-medium text-green-800 mb-1">
                  Server version (v{c.serverVersion})
                </div>
                <pre className="text-green-700 whitespace-pre-wrap break-all font-mono text-[10px] max-h-20 overflow-auto">
                  {JSON.stringify(c.serverSnapshot, null, 1)}
                </pre>
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => handleKeepMine(c)}
                disabled={busyId === c.id}
                className="inline-flex items-center gap-1 text-xs bg-blue-600 text-white px-2.5 py-1.5 rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {busyId === c.id ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Check className="w-3 h-3" />
                )}
                Keep my version
              </button>
              <button
                onClick={() => handleUseServer(c)}
                disabled={busyId === c.id}
                className="inline-flex items-center gap-1 text-xs bg-green-600 text-white px-2.5 py-1.5 rounded hover:bg-green-700 disabled:opacity-50"
              >
                <Server className="w-3 h-3" />
                Use server version
              </button>
              <button
                onClick={() => handleDiscard(c)}
                disabled={busyId === c.id}
                className="inline-flex items-center gap-1 text-xs bg-gray-200 text-gray-700 px-2.5 py-1.5 rounded hover:bg-gray-300 disabled:opacity-50"
              >
                <X className="w-3 h-3" />
                Discard
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};
