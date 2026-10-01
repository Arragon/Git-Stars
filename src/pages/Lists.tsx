import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDown,
  ArrowUp,
  Download,
  Pencil,
  Plus,
  Share2,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  exportList,
  getPublication,
  getList,
  importCommit,
  importPreview,
  listLibrary,
  listLists,
  publishList,
  revokePublication,
  setHubOptIn,
  updateListItems,
  type ImportPreview,
  type ListDetail,
  type ListSummary,
  type PublicationView,
  type SavedRepository,
} from "../utils/gitstarsApi";
import { ApiError } from "../utils/api";
import {
  addListItemOffline,
  createListOffline,
  deleteListOffline,
  outcomeErrorLabel,
  readListDetailCache,
  readListsCache,
  removeListItemOffline,
  renameList,
  upsertLibraryPage,
  upsertListDetail,
  upsertListSummaries,
  type MutationOutcome,
} from "../data/offlineMutations";
import { useSyncStatusStore } from "../store/useSyncStatusStore";

const msg = (e: unknown): string =>
  e instanceof ApiError
    ? `${e.code}: ${e.message}`
    : e instanceof Error
      ? e.message
      : "Error";

const isOffline = (): boolean =>
  typeof navigator !== "undefined" && !navigator.onLine;

export const Lists: React.FC = () => {
  const [lists, setLists] = useState<ListSummary[]>([]);
  const [selected, setSelected] = useState<ListDetail | null>(null);
  const [library, setLibrary] = useState<SavedRepository[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loadingLists, setLoadingLists] = useState(true);
  const [importText, setImportText] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const isOnline = useSyncStatusStore((s) => s.isOnline);
  const mountedRef = useRef(false);

  // Share / publication management (M5)
  const [shareTarget, setShareTarget] = useState<ListSummary | null>(null);
  const [publication, setPublication] = useState<PublicationView | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState("");
  const [shareNotice, setShareNotice] = useState("");
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [copied, setCopied] = useState(false);

  /** Reflect the local cache into the list view (optimistic/offline state). */
  const hydrateFromCache = useCallback(async () => {
    try {
      setLists(await readListsCache());
    } catch {
      // cache unavailable — server path still applies
    }
  }, []);

  const reloadLists = useCallback(async () => {
    try {
      const fresh = await listLists();
      setLists(fresh);
      await upsertListSummaries(fresh);
    } catch (e) {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        setNotice("离线：正在显示本地缓存");
        await hydrateFromCache();
      } else {
        setError(msg(e));
      }
    } finally {
      setLoadingLists(false);
    }
  }, [hydrateFromCache]);

  // Stale-while-revalidate: paint the cached view immediately on first mount.
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    void hydrateFromCache();
  }, [hydrateFromCache]);

  useEffect(() => {
    reloadLists();
    listLibrary()
      .then(async (lib) => {
        setLibrary(lib);
        try {
          await upsertLibraryPage(lib);
        } catch {
          /* best-effort cache write */
        }
      })
      .catch((e) => {
        if (!isOffline()) setError(msg(e));
      });
  }, [reloadLists]);

  const hydrateSelectedFromCache = useCallback(async (listId: string) => {
    try {
      const cached = await readListDetailCache(listId);
      if (cached) setSelected(cached);
    } catch {
      /* ignore */
    }
  }, []);

  const openList = async (id: string) => {
    try {
      const detail = await getList(id);
      setSelected(detail);
      setError("");
      await upsertListDetail(detail);
    } catch (e) {
      if (isOffline()) {
        await hydrateSelectedFromCache(id);
      } else {
        setError(msg(e));
      }
    }
  };

  /** Run an offline-capable mutation: refresh after confirm, hydrate otherwise. */
  const runMutate = async <T,>(
    fn: () => Promise<MutationOutcome<T>>,
  ): Promise<MutationOutcome<T>> => {
    setError("");
    setNotice("");
    const out = await fn();
    if (out.error) setError(outcomeErrorLabel(out));
    else if (!out.confirmed)
      setNotice("离线：更改已保存到本地，联网后自动同步");
    return out;
  };

  const onCreate = async () => {
    if (!name.trim()) {
      nameInputRef.current?.focus();
      return;
    }
    const listName = name.trim();
    setName("");
    const out = await runMutate(() => createListOffline(listName));
    await reloadLists();
    if (out.confirmed && out.response) {
      await openList(out.response.id);
    } else {
      await hydrateSelectedFromCache(out.entityId);
    }
  };

  const onRename = async (list: ListSummary) => {
    const next = window.prompt("重命名列表", list.name)?.trim();
    if (!next || next === list.name) return;
    await runMutate(() =>
      renameList({ id: list.id, version: list.version }, next),
    );
    await reloadLists();
    if (selected?.id === list.id) await hydrateSelectedFromCache(list.id);
  };

  const onDelete = async (list: ListSummary) => {
    if (
      !window.confirm(
        `确定删除列表「${list.name}」？列表内的条目也会一并移除。`,
      )
    ) {
      return;
    }
    const out = await runMutate(() =>
      deleteListOffline({ id: list.id, version: list.version }),
    );
    if (!out.error) {
      if (selected?.id === list.id) setSelected(null);
      await reloadLists();
    }
  };

  const mutateItems = async (payload: {
    add?: string[];
    remove?: string[];
    reorder?: string[];
  }) => {
    if (!selected) return;
    // Reorder is the only membership edit that cannot be expressed by the
    // offline queue's replay encoding — keep it online-only.
    if (payload.reorder) {
      if (!isOnline) {
        setError("离线状态暂不支持调整排序，请联网后重试");
        return;
      }
      try {
        const updated = await updateListItems(selected.id, payload);
        setSelected(updated);
        await upsertListDetail(updated);
        await reloadLists();
      } catch (e) {
        setError(msg(e));
      }
      return;
    }

    let touched = false;
    let allConfirmed = true;
    try {
      for (const savedId of payload.add ?? []) {
        touched = true;
        const out = await runMutate(() =>
          addListItemOffline(selected.id, savedId),
        );
        if (out.confirmed && out.response) setSelected(out.response);
        if (!out.confirmed) allConfirmed = false;
      }
      for (const savedId of payload.remove ?? []) {
        touched = true;
        const out = await runMutate(() =>
          removeListItemOffline(selected.id, savedId),
        );
        if (out.confirmed && out.response) setSelected(out.response);
        if (!out.confirmed) allConfirmed = false;
      }
      await reloadLists();
      if (touched && !allConfirmed) {
        // Reflect the optimistic add/remove from the cache.
        await hydrateSelectedFromCache(selected.id);
      }
    } catch (e) {
      setError(msg(e));
    }
  };

  const move = (index: number, dir: -1 | 1) => {
    if (!selected) return;
    const order = selected.items.map((i) => i.savedRepositoryId);
    const target = index + dir;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    void mutateItems({ reorder: order });
  };

  const onExport = async (list: ListSummary) => {
    try {
      const doc = await exportList(list.id);
      const blob = new Blob([JSON.stringify(doc, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${list.name.replace(/\s+/g, "-").toLowerCase()}.gitstars-list.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(msg(e));
    }
  };

  const onPreview = async () => {
    try {
      setPreview(await importPreview(importText));
      setError("");
    } catch (e) {
      setError(msg(e));
      setPreview(null);
    }
  };
  const onCommit = async () => {
    try {
      await importCommit(importText, preview?.title);
      setImportText("");
      setPreview(null);
      await reloadLists();
    } catch (e) {
      setError(msg(e));
    }
  };

  const addable = library.filter(
    (s) =>
      selected && !selected.items.some((i) => i.savedRepositoryId === s.id),
  );

  // --- Share (publication) management -------------------------------------
  const openShare = async (list: ListSummary) => {
    setShareTarget(list);
    setShareError("");
    setShareNotice("");
    setConfirmRevoke(false);
    setCopied(false);
    setShareLoading(true);
    setPublication(null);
    try {
      setPublication(await getPublication(list.id));
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) {
        setShareError(msg(e));
      }
      // 404 = never published: keep publication null (unpublished state).
    } finally {
      setShareLoading(false);
    }
  };

  const closeShare = () => {
    setShareTarget(null);
    setPublication(null);
    setShareNotice("");
    setShareError("");
    setConfirmRevoke(false);
  };

  const onPublish = async () => {
    if (!shareTarget || shareBusy) return;
    setShareBusy(true);
    setShareError("");
    setShareNotice("");
    try {
      const pub = await publishList(shareTarget.id);
      setPublication(pub);
      setShareNotice(
        pub.snapshotVersion > 1 ? "分享快照已更新" : "分享链接已生成",
      );
    } catch (e) {
      setShareError(msg(e));
    } finally {
      setShareBusy(false);
    }
  };

  const onHubToggle = async (optIn: boolean) => {
    if (!shareTarget || shareBusy || !publication) return;
    setShareBusy(true);
    setShareError("");
    try {
      await setHubOptIn(shareTarget.id, optIn);
      setPublication({ ...publication, hubOptIn: optIn });
    } catch (e) {
      setShareError(msg(e));
    } finally {
      setShareBusy(false);
    }
  };

  const onRevoke = async () => {
    if (!shareTarget || shareBusy) return;
    setShareBusy(true);
    setShareError("");
    try {
      await revokePublication(shareTarget.id);
      setPublication(null);
      setConfirmRevoke(false);
      setShareNotice("分享已取消");
    } catch (e) {
      setShareError(msg(e));
    } finally {
      setShareBusy(false);
    }
  };

  const copyShareLink = async () => {
    if (!publication) return;
    const url = `${window.location.origin}${publication.shareUrl}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setShareError("复制失败，请手动复制: " + url);
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6 text-gray-900 dark:text-gray-100">
      <h1 className="text-2xl font-bold">Lists</h1>
      {error && (
        <div className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 rounded px-3 py-2">
          {error}
        </div>
      )}
      {notice && (
        <div className="text-sm text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-900 rounded px-3 py-2">
          {notice}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              ref={nameInputRef}
              className="flex-1 text-sm border border-gray-200 dark:border-gray-700 rounded px-3 py-2 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 placeholder-gray-400"
              placeholder="New list name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void onCreate();
              }}
            />
            <button
              onClick={() => void onCreate()}
              className="inline-flex items-center gap-1 bg-gray-900 dark:bg-gray-100 dark:text-gray-900 text-white px-3 py-2 rounded text-sm"
            >
              <Plus className="h-4 w-4" /> Create
            </button>
          </div>
          {loadingLists && lists.length === 0 ? (
            <ul className="space-y-2" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <li
                  key={i}
                  className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-3 animate-pulse"
                >
                  <div className="h-4 w-1/3 bg-gray-200 dark:bg-gray-700 rounded mb-2" />
                  <div className="h-3 w-1/4 bg-gray-100 dark:bg-gray-800 rounded" />
                </li>
              ))}
            </ul>
          ) : (
            <ul className="space-y-2">
              {lists.map((l) => (
                <li
                  key={l.id}
                  className={`bg-white dark:bg-gray-900 rounded-lg border p-3 flex items-center gap-2 ${selected?.id === l.id ? "border-gray-900 dark:border-gray-100" : "border-gray-200 dark:border-gray-800"}`}
                >
                  <button
                    onClick={() => void openList(l.id)}
                    className="flex-1 text-left min-w-0"
                  >
                    <div className="text-sm font-medium truncate">{l.name}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {l.itemCount ?? 0} items
                    </div>
                  </button>
                  <button
                    onClick={() => void onRename(l)}
                    className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 h-10 w-10 inline-flex items-center justify-center shrink-0"
                    title="重命名"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => void openShare(l)}
                    className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 h-10 w-10 inline-flex items-center justify-center shrink-0"
                    title="分享"
                  >
                    <Share2 className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => onExport(l)}
                    className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 h-10 w-10 inline-flex items-center justify-center shrink-0"
                    title="Export"
                  >
                    <Download className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => void onDelete(l)}
                    className="text-gray-400 hover:text-red-600 dark:hover:text-red-400 h-10 w-10 inline-flex items-center justify-center shrink-0"
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
              {lists.length === 0 && !loadingLists && (
                <li className="text-sm text-gray-500 dark:text-gray-400 py-6 text-center">
                  还没有列表。
                  <button
                    onClick={() => void onCreate()}
                    className="ml-1 text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    新建列表
                  </button>
                </li>
              )}
            </ul>
          )}

          <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-3 space-y-2">
            <div className="text-sm font-medium text-gray-700 dark:text-gray-200 inline-flex items-center gap-1">
              <Upload className="h-4 w-4" /> Import a List
            </div>
            <textarea
              className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded p-2 font-mono bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 placeholder-gray-400"
              rows={4}
              placeholder="Paste a .gitstars-list JSON..."
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
            />
            <div className="flex gap-2">
              <button
                onClick={onPreview}
                className="text-sm bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 px-3 py-1.5 rounded"
              >
                Preview
              </button>
              {preview && (
                <button
                  onClick={onCommit}
                  className="text-sm bg-gray-900 dark:bg-gray-100 dark:text-gray-900 text-white px-3 py-1.5 rounded"
                >
                  Confirm import
                </button>
              )}
            </div>
            {preview && (
              <div className="text-xs text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 rounded p-2">
                <div className="font-medium">
                  “{preview.title}” — {preview.summary.total} items
                </div>
                <div>
                  new: {preview.summary.new} · existing:{" "}
                  {preview.summary.existing} · unresolved:{" "}
                  {preview.summary.unresolved}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4">
          {selected ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">{selected.name}</h2>
                <button
                  onClick={() => setSelected(null)}
                  className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 h-10 w-10 inline-flex items-center justify-center"
                  aria-label="关闭"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <ul className="space-y-1">
                {selected.items.map((item, index) => (
                  <li
                    key={item.id}
                    className="flex items-center gap-1 border border-gray-100 dark:border-gray-800 rounded px-2 py-1"
                  >
                    <span className="text-xs text-gray-400 dark:text-gray-500 w-4">
                      {index + 1}
                    </span>
                    <Link
                      to={`/repository/${item.repository.id}`}
                      className="flex-1 text-sm hover:underline truncate min-w-0 py-2"
                    >
                      {item.repository.name}
                    </Link>
                    <button
                      onClick={() => move(index, -1)}
                      className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 h-10 w-10 inline-flex items-center justify-center shrink-0 disabled:opacity-30"
                      aria-label="Move up"
                      disabled={index === 0}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => move(index, 1)}
                      className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 h-10 w-10 inline-flex items-center justify-center shrink-0 disabled:opacity-30"
                      aria-label="Move down"
                      disabled={index === selected.items.length - 1}
                    >
                      <ArrowDown className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() =>
                        mutateItems({ remove: [item.savedRepositoryId] })
                      }
                      className="text-gray-400 hover:text-red-600 dark:hover:text-red-400 h-10 w-10 inline-flex items-center justify-center shrink-0"
                      aria-label="Remove from list"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
                {selected.items.length === 0 && (
                  <li className="text-sm text-gray-500 dark:text-gray-400">
                    Empty list.
                  </li>
                )}
              </ul>
              <div className="border-t border-gray-100 dark:border-gray-800 pt-3">
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                  Add from library
                </div>
                <select
                  className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded px-2 py-2 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100"
                  defaultValue=""
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v) {
                      void mutateItems({ add: [v] });
                      e.target.value = "";
                    }
                  }}
                >
                  <option value="" disabled>
                    Select a saved repository...
                  </option>
                  {addable.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.repository.namespacePath
                        ? `${s.repository.namespacePath}/`
                        : ""}
                      {s.repository.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <div className="text-sm text-gray-500 dark:text-gray-400 py-12 text-center">
              Select a list to view and edit its items.
            </div>
          )}
        </div>
      </div>

      {shareTarget && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4"
          onClick={closeShare}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 w-full max-w-md p-4 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">
                分享「{shareTarget.name}」
              </h3>
              <button
                onClick={closeShare}
                className="text-gray-400 hover:text-gray-700"
                aria-label="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {shareError && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
                {shareError}
              </div>
            )}
            {shareNotice && (
              <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">
                {shareNotice}
              </div>
            )}

            {shareLoading ? (
              <div className="text-sm text-gray-500 py-4 text-center">
                加载中...
              </div>
            ) : publication ? (
              <div className="space-y-3">
                <div className="text-xs text-gray-500">
                  状态：
                  {publication.status === "active"
                    ? "公开分享中"
                    : publication.status === "revoked"
                      ? "已取消分享"
                      : "已下架"}
                  {" · "}快照 v{publication.snapshotVersion} ·{" "}
                  {publication.repositoryCount} 个仓库
                </div>
                {publication.status === "active" && (
                  <div className="flex gap-2">
                    <input
                      readOnly
                      value={`${window.location.origin}${publication.shareUrl}`}
                      className="flex-1 text-xs border border-gray-200 rounded px-2 py-1.5 bg-gray-50 text-gray-600"
                    />
                    <button
                      onClick={copyShareLink}
                      className="text-sm bg-gray-900 text-white px-3 py-1.5 rounded whitespace-nowrap"
                    >
                      {copied ? "已复制" : "复制"}
                    </button>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={onPublish}
                    disabled={shareBusy}
                    className="text-sm bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded disabled:opacity-60"
                  >
                    更新快照
                  </button>
                  <button
                    onClick={() => void onHubToggle(!publication.hubOptIn)}
                    disabled={shareBusy || publication.status !== "active"}
                    className={`text-sm px-3 py-1.5 rounded border disabled:opacity-60 ${
                      publication.hubOptIn
                        ? "bg-gray-900 text-white border-gray-900"
                        : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
                    }`}
                    title={
                      publication.status !== "active"
                        ? "需要公开分享中的发布"
                        : undefined
                    }
                  >
                    Hub 公开：{publication.hubOptIn ? "开" : "关"}
                  </button>
                  {publication.status !== "takedown" &&
                    (confirmRevoke ? (
                      <>
                        <button
                          onClick={onRevoke}
                          disabled={shareBusy}
                          className="text-sm bg-red-600 text-white px-3 py-1.5 rounded disabled:opacity-60"
                        >
                          确认取消分享
                        </button>
                        <button
                          onClick={() => setConfirmRevoke(false)}
                          className="text-sm bg-gray-100 px-3 py-1.5 rounded"
                        >
                          保留
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => setConfirmRevoke(true)}
                        disabled={shareBusy}
                        className="text-sm text-red-600 border border-red-200 hover:bg-red-50 px-3 py-1.5 rounded disabled:opacity-60"
                      >
                        取消分享
                      </button>
                    ))}
                </div>
                <p className="text-xs text-gray-400">
                  任何人都可以通过分享链接查看此列表的公开快照（不含私有仓库、备注与标签）。
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-xs text-gray-500">
                  尚未发布。发布后会生成一个公开分享链接，快照仅包含公开仓库的基本信息。
                </div>
                <button
                  onClick={onPublish}
                  disabled={shareBusy}
                  className="text-sm bg-gray-900 text-white px-3 py-1.5 rounded disabled:opacity-60"
                >
                  {shareBusy ? "发布中..." : "发布分享链接"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
