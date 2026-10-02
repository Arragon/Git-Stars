// src/components/CacheRecoveryScreen.tsx
// Local cache recovery path (INH-406): shown when the IndexedDB cache cannot be
// opened or migrated (corrupt schema, or a cache written by a newer app build).
// Pixel-faithful port of the prototype `recovery()`. Server-side data is
// unaffected; the recovery path makes that explicit and never silently deletes
// queued offline mutations — export is offered before reset.

import React, { useCallback, useEffect, useState } from "react";
import { Shield, Trash2 } from "lucide-react";
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
  const pendingLabel =
    pending === null ? "数量暂时无法确认" : `${pending.length} 条`;

  return (
    <div className="recovery-wrap">
      <section className="recovery">
        <span className="hub-mark sand">
          <Shield className="ico large" />
        </span>
        <h1>{unsupported ? "这份缓存来自更高版本" : "本地缓存暂时无法读取"}</h1>
        <p>
          {unsupported
            ? "建议先更新 GitStars。重置缓存前，可以尝试导出尚未同步的修改。"
            : "服务器上的数据不受影响。本地还有尚未同步的修改，请先导出备份，再决定是否重置缓存。"}
        </p>
        <div className="recovery-fact">
          <span className="muted">服务器数据</span>
          <span className="badge green">不会被重置</span>
        </div>
        <div className="recovery-fact">
          <span className="muted">未同步修改</span>
          <span className="number">{pendingLabel}</span>
        </div>
        <div className="stack">
          <button
            type="button"
            className="btn primary"
            onClick={() => void handleExport()}
          >
            导出待同步修改
          </button>
          <button
            type="button"
            className="btn danger"
            disabled={resetting}
            onClick={() => void handleReset()}
          >
            <Trash2 className="ico" />
            {resetting ? "正在重置…" : "重置本地缓存"}
          </button>
        </div>
        <p className="tiny" style={{ marginBottom: 0 }}>
          如果无法确定队列是否完整，请优先保留现有缓存。
        </p>
      </section>
    </div>
  );
};
