// src/components/CacheRecoveryScreen.tsx
// Local cache recovery path (INH-406): shown when the IndexedDB cache cannot be
// opened or migrated (corrupt schema, or a cache written by a newer app build).
// Server-side data is unaffected; the recovery path makes that explicit and never
// silently deletes queued offline mutations — export is offered before reset.

import React, { useCallback, useEffect, useState } from "react";
import { localStore } from "../data";
import { useSyncStatusStore } from "../store/useSyncStatusStore";

const CACHE_DB_NAME = "gitstars-client-cache";

// Best-effort dump of the durable offline mutation queue, read directly from
// IndexedDB without going through the schema layer that just failed.
async function readPendingMutations(): Promise<unknown[] | null> {
  if (typeof indexedDB === "undefined") return null;
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      // No version argument → never triggers an upgrade path.
      request = indexedDB.open(CACHE_DB_NAME);
    } catch {
      resolve(null);
      return;
    }
    request.onsuccess = () => {
      const db = request.result;
      try {
        if (!db.objectStoreNames.contains("mutationQueue")) {
          db.close();
          resolve(null);
          return;
        }
        const tx = db.transaction("mutationQueue", "readonly");
        const getAll = tx.objectStore("mutationQueue").getAll();
        getAll.onsuccess = () => {
          db.close();
          resolve(getAll.result as unknown[]);
        };
        getAll.onerror = () => {
          db.close();
          resolve(null);
        };
      } catch {
        try {
          db.close();
        } catch {
          // ignore
        }
        resolve(null);
      }
    };
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

export const CacheRecoveryScreen: React.FC = () => {
  const cacheError = useSyncStatusStore((s) => s.cacheError);
  const [pending, setPending] = useState<unknown[] | null>(null);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    void readPendingMutations().then(setPending);
  }, []);

  const handleExport = useCallback(async () => {
    const data = pending ?? (await readPendingMutations());
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "gitstars-pending-mutations.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [pending]);

  const handleReset = useCallback(async () => {
    const queued = pending?.length ?? 0;
    const detail =
      queued > 0
        ? `本地还有 ${queued} 条未同步的修改，重置会丢弃它们（可先导出备份）。`
        : "将删除本地缓存并重新同步，服务器上的数据不受影响。";
    if (!window.confirm(`确定重置本地缓存吗？${detail}`)) return;
    setResetting(true);
    try {
      await localStore.destroy();
      window.location.reload();
    } catch (err) {
      console.error("Cache reset failed", err);
      setResetting(false);
    }
  }, [pending]);

  const unsupported = cacheError === "unsupported";
  const pendingCount = pending?.length ?? 0;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6 dark:bg-gray-950">
      <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {unsupported ? "本地缓存版本过新" : "本地缓存出现问题"}
        </h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          {unsupported
            ? "本地缓存由更新版本的 GitStars 写入，当前应用无法读取。请升级应用，或重置本地缓存。"
            : "本地缓存无法读取或已损坏，需要重置后重新同步。"}{" "}
          你的服务器数据不受影响。
        </p>

        {pending !== null && (
          <div className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            {pendingCount > 0
              ? `检测到 ${pendingCount} 条离线期间保存的修改尚未同步。重置缓存会丢弃它们；建议先导出备份。`
              : "没有检测到未同步的离线修改，可以放心重置。"}
          </div>
        )}

        <div className="mt-5 flex flex-col gap-2">
          {pendingCount > 0 && (
            <button
              type="button"
              onClick={() => void handleExport()}
              className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              导出未同步的修改（JSON）
            </button>
          )}
          <button
            type="button"
            disabled={resetting}
            onClick={() => void handleReset()}
            className="w-full rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
          >
            {resetting ? "正在重置…" : "重置本地缓存"}
          </button>
        </div>
      </div>
    </div>
  );
};
