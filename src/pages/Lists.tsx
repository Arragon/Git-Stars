// src/pages/Lists.tsx
// Pixel-faithful port of the prototype `listsPage()` (list-workspace with the
// master directory + list detail) and its dialogs (`createListDialog`,
// `shareDialog`, add-to-list picker, smart-collect suggestions, import, list
// menu, delete confirm). All real data flows are preserved: offline-capable
// create/delete/membership mutations, publication management (publish / update
// / hub opt-in / two-step revoke), portable import (preview + commit) and
// export, reorder (online-only) and remove-with-undo.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowDown,
  ArrowUp,
  Download,
  Folder,
  Lock,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Share2,
  Sparkles,
  Trash2,
  Upload,
  WifiOff,
  X,
} from "lucide-react";
import {
  autoCollectForList,
  type AutoCollectMatch,
} from "../utils/autoCollect";
import { Dialog, EmptyState } from "../components/ui";
import { repoEmblem } from "../lib/utils";
import {
  exportList,
  getPublication,
  getList,
  updateList,
  updateListItems,
  importCommit,
  importPreview,
  listLibrary,
  listLists,
  publishList,
  revokePublication,
  setHubOptIn,
  type ImportPreview,
  type ListDetail,
  type ListSummary,
  type PublicationView,
  type SavedRepository,
} from "../utils/gitstarsApi";
import { ApiError, apiPut } from "../utils/api";
import {
  addListItemOffline,
  createListOffline,
  deleteListOffline,
  outcomeErrorLabel,
  readListDetailCache,
  readListsCache,
  removeListItemOffline,
  upsertLibraryPage,
  upsertListDetail,
  upsertListSummaries,
  type MutationOutcome,
} from "../data/offlineMutations";
import { useSyncStatusStore } from "../store/useSyncStatusStore";
import { useToastStore } from "../store/useToastStore";

const msg = (e: unknown): string =>
  e instanceof ApiError
    ? `${e.code}: ${e.message}`
    : e instanceof Error
      ? e.message
      : "Error";

const isOffline = (): boolean =>
  typeof navigator !== "undefined" && !navigator.onLine;

const isPublished = (p: PublicationView | null | undefined): boolean =>
  p?.status === "active";

export const Lists: React.FC = () => {
  const [lists, setLists] = useState<ListSummary[]>([]);
  const [selected, setSelected] = useState<ListDetail | null>(null);
  const [library, setLibrary] = useState<SavedRepository[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loadingLists, setLoadingLists] = useState(true);
  const [importText, setImportText] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [masterQuery, setMasterQuery] = useState("");
  const [listQuery, setListQuery] = useState("");
  const isOnline = useSyncStatusStore((s) => s.isOnline);
  const showToast = useToastStore((s) => s.showToast);
  const mountedRef = useRef(false);
  const autoSelectedRef = useRef(false);
  const [searchParams, setSearchParams] = useSearchParams();

  // Share / publication management (M5)
  const [shareTarget, setShareTarget] = useState<ListSummary | null>(null);
  const [publication, setPublication] = useState<PublicationView | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState("");
  const [shareNotice, setShareNotice] = useState("");
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  // Per-list publication status for the master directory + detail badge.
  const [pubs, setPubs] = useState<Map<string, PublicationView | null>>(
    new Map(),
  );

  // Create / edit dialog (prototype `createListDialog`)
  const [listForm, setListForm] = useState<{
    id: string;
    name: string;
    description: string;
    version: number;
  } | null>(null);
  const [listFormError, setListFormError] = useState("");

  // Delete confirmation (prototype `delete-list`)
  const [deleteTarget, setDeleteTarget] = useState<ListSummary | null>(null);

  // List actions menu (prototype `list-menu`)
  const [menuOpen, setMenuOpen] = useState(false);

  // Add-to-list picker (prototype `add-to-list`)
  const [addOpen, setAddOpen] = useState(false);
  const [addQuery, setAddQuery] = useState("");
  const [addChecked, setAddChecked] = useState<Set<string>>(new Set());

  // Smart-collect suggestions (prototype `auto-collect`)
  const [autoCollectBusy, setAutoCollectBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<AutoCollectMatch[] | null>(
    null,
  );
  const [suggestChecked, setSuggestChecked] = useState<Set<string>>(new Set());

  const libById = useMemo(
    () => new Map(library.map((s) => [s.id, s])),
    [library],
  );

  /** Reflect the local cache into the list view (optimistic/offline state). */
  const hydrateFromCache = useCallback(async () => {
    try {
      setLists(await readListsCache());
    } catch {
      // cache unavailable — server path still applies
    }
  }, []);

  const loadPublications = useCallback(async (all: ListSummary[]) => {
    const entries = await Promise.all(
      all.map(async (l) => {
        try {
          return [l.id, await getPublication(l.id)] as const;
        } catch {
          return [l.id, null] as const;
        }
      }),
    );
    setPubs(new Map(entries));
  }, []);

  const reloadLists = useCallback(async (): Promise<ListSummary[]> => {
    try {
      const fresh = await listLists();
      setLists(fresh);
      await upsertListSummaries(fresh);
      void loadPublications(fresh);
      return fresh;
    } catch (e) {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        setNotice("离线：正在显示本地缓存");
        const cached = await readListsCache().catch(() => []);
        setLists(cached);
        return cached;
      }
      setError(msg(e));
      return [];
    } finally {
      setLoadingLists(false);
    }
  }, [loadPublications]);

  // Stale-while-revalidate: paint the cached view immediately on first mount.
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    void hydrateFromCache();
  }, [hydrateFromCache]);

  const hydrateSelectedFromCache = useCallback(async (listId: string) => {
    try {
      const cached = await readListDetailCache(listId);
      if (cached) setSelected(cached);
    } catch {
      /* ignore */
    }
  }, []);

  const openList = useCallback(
    async (id: string) => {
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
    },
    [hydrateSelectedFromCache],
  );

  // Sidebar shortcuts link to /lists?list=<id> — open that list directly.
  useEffect(() => {
    const target = searchParams.get("list");
    if (target && !loadingLists) {
      void openList(target);
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, loadingLists, openList]);

  // Initial load: fetch lists + library, then auto-select the first list
  // (prototype behavior: the detail pane is always showing a list).
  useEffect(() => {
    void (async () => {
      const all = await reloadLists();
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
      if (!autoSelectedRef.current && all.length > 0) {
        autoSelectedRef.current = true;
        void openList(all[0].id);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadLists]);

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

  const onCreateOrSave = async () => {
    if (!listForm) return;
    const name = listForm.name.trim();
    if (!name) {
      setListFormError("请填写列表名称。");
      return;
    }
    if (listForm.id) {
      // Rename / describe (server-side, version-guarded; online only).
      if (isOffline()) {
        setListFormError("离线状态暂不支持编辑列表，请联网后重试");
        return;
      }
      try {
        await updateList(
          { id: listForm.id, version: listForm.version },
          { name, description: listForm.description.trim() },
        );
        setListForm(null);
        setListFormError("");
        await reloadLists();
        await openList(listForm.id);
        showToast("列表信息已保存");
      } catch (e) {
        setListFormError(msg(e));
      }
      return;
    }
    // Create (offline-capable; description included).
    setListForm(null);
    setListFormError("");
    const out = await runMutate(() =>
      createListOffline(name, listForm.description.trim()),
    );
    await reloadLists();
    if (out.confirmed && out.response) {
      await openList(out.response.id);
    } else {
      await hydrateSelectedFromCache(out.entityId);
    }
    showToast("列表已创建");
  };

  const onDelete = async (list: ListSummary) => {
    const out = await runMutate(() =>
      deleteListOffline({ id: list.id, version: list.version }),
    );
    setDeleteTarget(null);
    if (!out.error) {
      if (selected?.id === list.id) setSelected(null);
      await reloadLists();
      showToast("列表已删除，收藏库内容保留");
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
    let lastResponse: ListDetail | null = null;
    try {
      for (const savedId of payload.add ?? []) {
        touched = true;
        const out = await runMutate(() =>
          addListItemOffline(selected.id, savedId),
        );
        if (out.confirmed && out.response) {
          setSelected(out.response);
          lastResponse = out.response;
        }
        if (!out.confirmed) allConfirmed = false;
      }
      for (const savedId of payload.remove ?? []) {
        touched = true;
        const out = await runMutate(() =>
          removeListItemOffline(selected.id, savedId),
        );
        if (out.confirmed && out.response) {
          setSelected(out.response);
          lastResponse = out.response;
        }
        if (!out.confirmed) allConfirmed = false;
      }
      await reloadLists();
      if (touched && !allConfirmed) {
        // Reflect the optimistic add/remove from the cache.
        await hydrateSelectedFromCache(selected.id);
      }
      return lastResponse;
    } catch (e) {
      setError(msg(e));
      return lastResponse;
    }
  };

  /** Remove one item with an undo toast (undo re-adds via apiPut). */
  const removeItem = async (savedId: string) => {
    if (!selected) return;
    const listId = selected.id;
    const out = await runMutate(() => removeListItemOffline(listId, savedId));
    if (out.error) return;
    if (out.confirmed && out.response) setSelected(out.response);
    else await hydrateSelectedFromCache(listId);
    await reloadLists();
    showToast("已移出当前列表，收藏库仍然保留", () => {
      void (async () => {
        try {
          await apiPut(`/api/lists/${listId}/items`, { add: [savedId] });
          await openList(listId);
          await reloadLists();
          showToast("已撤销");
        } catch {
          showToast("撤销失败，请手动重新加入");
        }
      })();
    });
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
      showToast("已导出列表文件");
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
      const res = await importCommit(importText, preview?.title);
      setImportText("");
      setPreview(null);
      setImportOpen(false);
      await reloadLists();
      if (res.listId) await openList(res.listId);
      showToast("清单已导入");
    } catch (e) {
      setError(msg(e));
    }
  };

  const addable = useMemo(
    () =>
      library.filter(
        (s) =>
          selected && !selected.items.some((i) => i.savedRepositoryId === s.id),
      ),
    [library, selected],
  );

  const filteredAddable = useMemo(() => {
    const q = addQuery.trim().toLowerCase();
    if (!q) return addable;
    return addable.filter((s) =>
      `${s.repository.namespacePath ?? ""}${s.repository.name} ${s.repository.description ?? ""}`
        .toLowerCase()
        .includes(q),
    );
  }, [addable, addQuery]);

  // --- 智能归类（Auto Collect）：按列表描述匹配 AI 摘要/标签自动加入 ---
  const runAutoCollect = () => {
    if (!selected || autoCollectBusy) return;
    if (!selected.description.trim()) {
      setNotice("请先为列表填写描述（智能归类依据描述与 AI 摘要/标签匹配）。");
      setListForm({
        id: selected.id,
        name: selected.name,
        description: "",
        version: selected.version,
      });
      setListFormError("");
      return;
    }
    const matches = autoCollectForList(addable, selected);
    if (matches.length === 0) {
      setNotice(
        "没有新匹配的仓库：智能归类依据列表描述与各仓库的 AI 摘要/标签进行匹配。",
      );
      return;
    }
    setSuggestions(matches);
    setSuggestChecked(new Set(matches.map((m) => m.item.id)));
  };

  const commitSuggestions = async () => {
    if (!suggestions) return;
    setAutoCollectBusy(true);
    try {
      await mutateItems({ add: Array.from(suggestChecked) });
      setSuggestions(null);
      showToast(
        suggestChecked.size
          ? `已加入 ${suggestChecked.size} 个仓库`
          : "未选择仓库",
      );
    } finally {
      setAutoCollectBusy(false);
    }
  };

  // --- Share (publication) management -------------------------------------
  const openShare = async (list: ListSummary) => {
    setShareTarget(list);
    setShareError("");
    setShareNotice("");
    setConfirmRevoke(false);
    setShareLoading(true);
    setPublication(null);
    try {
      const pub = await getPublication(list.id);
      setPublication(pub);
      setPubs((prev) => new Map(prev).set(list.id, pub));
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) {
        setShareError(msg(e));
      }
      setPubs((prev) => new Map(prev).set(list.id, null));
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
      setPubs((prev) => new Map(prev).set(shareTarget.id, pub));
      setShareNotice(
        pub.snapshotVersion > 1 ? "分享快照已更新" : "公开快照已生成",
      );
      showToast("公开快照已生成，Hub 展示保持独立选择");
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
      showToast(optIn ? "快照已加入 Hub 广场" : "快照已从 Hub 隐藏");
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
      setPubs((prev) => new Map(prev).set(shareTarget.id, null));
      setConfirmRevoke(false);
      setShareNotice("分享已取消");
      showToast("分享已取消");
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
      showToast("分享链接已复制");
    } catch {
      setShareError("复制失败，请手动复制: " + url);
    }
  };

  const offline = !isOnline;
  const publishedSelected = selected
    ? isPublished(pubs.get(selected.id))
    : false;

  // Share draft summary (prototype `draft-summary`): public vs private items,
  // derived from the library visibility data we already have client-side.
  const shareDetail =
    selected && shareTarget && selected.id === shareTarget.id ? selected : null;
  const sharePublicCount = shareDetail
    ? shareDetail.items.filter(
        (i) =>
          libById.get(i.savedRepositoryId)?.repository.visibility !== "private",
      ).length
    : (publication?.repositoryCount ?? 0);
  const shareTotalCount = shareDetail
    ? shareDetail.items.length
    : (publication?.repositoryCount ?? 0);

  const visibleLists = masterQuery.trim()
    ? lists.filter((l) => l.name.includes(masterQuery.trim()))
    : lists;

  const detailItems =
    selected && listQuery.trim()
      ? selected.items.filter((i) =>
          `${i.repository.namespacePath ?? ""}${i.repository.name} ${
            libById.get(i.savedRepositoryId)?.repository.description ?? ""
          }`
            .toLowerCase()
            .includes(listQuery.trim().toLowerCase()),
        )
      : (selected?.items ?? []);

  const openCreateDialog = () => {
    setListForm({ id: "", name: "", description: "", version: 0 });
    setListFormError("");
  };

  const openEditDialog = (l: {
    id: string;
    name: string;
    description: string;
    version: number;
  }) => {
    setListForm({ ...l });
    setListFormError("");
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">
            <h1>我的列表</h1>
            <span className="badge">{lists.length}</span>
          </div>
          <p>按主题组织收藏，按需导出与分享。</p>
        </div>
        <div className="page-actions">
          <button
            type="button"
            className="btn"
            disabled={offline}
            title={offline ? "此操作需要联网" : undefined}
            onClick={() => {
              setImportText("");
              setPreview(null);
              setImportOpen(true);
            }}
          >
            <Upload className="ico" /> 导入列表
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={openCreateDialog}
          >
            <Plus className="ico" /> 新建列表
          </button>
        </div>
      </div>

      {error && (
        <div className="notice error" role="alert">
          <span className="grow">{error}</span>
        </div>
      )}
      {notice && (
        <div className="notice">
          <span className="grow">{notice}</span>
        </div>
      )}
      {offline && (
        <div className="notice warning">
          <WifiOff className="ico" />
          <span className="grow">
            正在查看本地缓存。备注与标签的更改会在联网后同步。
          </span>
        </div>
      )}

      {lists.length === 0 && !loadingLists ? (
        <EmptyState
          icon={<Folder className="ico large" />}
          title="给收藏一个清晰的主题"
          description="创建一个列表，加入已经收藏的仓库。你也可以导入别人整理好的清单。"
          action={
            <button
              type="button"
              className="btn primary"
              onClick={openCreateDialog}
            >
              <Plus className="ico" /> 新建第一个列表
            </button>
          }
          secondary={
            <button
              type="button"
              className="btn"
              disabled={offline}
              onClick={() => {
                setImportText("");
                setPreview(null);
                setImportOpen(true);
              }}
            >
              <Upload className="ico" /> 导入列表
            </button>
          }
        />
      ) : (
        <div className="list-workspace">
          {/* master: list directory */}
          <aside className="list-master" aria-label="选择列表">
            <div className="search-field">
              <Search className="ico" />
              <input
                className="field"
                aria-label="搜索我的列表"
                placeholder="查找列表"
                value={masterQuery}
                onChange={(e) => setMasterQuery(e.target.value)}
              />
            </div>
            {loadingLists && lists.length === 0 ? (
              <div aria-hidden="true">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="collection-row">
                    <Folder className="ico folder-icon" />
                    <div className="grow">
                      <h3>…</h3>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              visibleLists.map((l) => {
                const active = selected?.id === l.id;
                return (
                  <button
                    key={l.id}
                    type="button"
                    className={`collection-row ${active ? "active" : ""}`}
                    aria-current={active ? "true" : undefined}
                    onClick={() => void openList(l.id)}
                  >
                    <Folder className="ico folder-icon" />
                    <div className="grow">
                      <h3>{l.name}</h3>
                      <p>
                        {isPublished(pubs.get(l.id))
                          ? "分享快照已发布"
                          : "私有列表"}
                      </p>
                    </div>
                    <span className="count number">{l.itemCount ?? 0}</span>
                  </button>
                );
              })
            )}
            <p className="small muted mt24" style={{ padding: "0 10px" }}>
              新列表默认仅自己可见。
            </p>
          </aside>

          {/* detail */}
          <section className="list-detail" aria-label="列表内容">
            {selected ? (
              <>
                <div className="row between">
                  <div className="row gap8">
                    {publishedSelected ? (
                      <span className="badge green">
                        <Share2 className="ico small" /> 已分享
                      </span>
                    ) : (
                      <span className="badge">
                        <Lock className="ico small" /> 私有
                      </span>
                    )}
                    <span className="muted tiny number">
                      {selected.items.length} 个仓库
                    </span>
                  </div>
                  <div className="row" style={{ gap: 2 }}>
                    <button
                      type="button"
                      className="btn icon ghost sm"
                      aria-label="导出列表"
                      title="导出列表"
                      disabled={offline}
                      onClick={() => void onExport(selected)}
                    >
                      <Download className="ico small" />
                    </button>
                    <button
                      type="button"
                      className="btn icon ghost sm"
                      aria-label="列表操作"
                      title="列表操作"
                      onClick={() => setMenuOpen(true)}
                    >
                      <MoreHorizontal className="ico small" />
                    </button>
                  </div>
                </div>
                <h2 className="list-detail-title">
                  {selected.name}
                  <button
                    type="button"
                    className="btn icon ghost sm"
                    aria-label="修改名称与描述"
                    title="修改名称与描述"
                    onClick={() =>
                      openEditDialog({
                        id: selected.id,
                        name: selected.name,
                        description: selected.description,
                        version: selected.version,
                      })
                    }
                  >
                    <Pencil className="ico small" />
                  </button>
                </h2>
                <p className="list-detail-desc">
                  {selected.description ||
                    "为这个列表填写描述，智能归类会根据描述寻找合适的仓库。"}
                </p>
                <div className="list-tools">
                  <div className="search-field grow">
                    <Search className="ico" />
                    <input
                      className="field"
                      aria-label="搜索当前列表"
                      placeholder="在这个列表中搜索"
                      value={listQuery}
                      onChange={(e) => setListQuery(e.target.value)}
                    />
                  </div>
                  <div className="row gap8">
                    <button
                      type="button"
                      className="btn ghost ai sm"
                      disabled={autoCollectBusy}
                      title="依据列表描述与 AI 摘要/标签，把收藏库中的匹配仓库自动加入此列表"
                      onClick={runAutoCollect}
                    >
                      <Sparkles
                        className={`ico small ${autoCollectBusy ? "animate-pulse" : ""}`}
                      />
                      智能归类
                    </button>
                    <button
                      type="button"
                      className="btn sm"
                      disabled={offline}
                      title={offline ? "此操作需要联网" : undefined}
                      onClick={() => void openShare(selected)}
                    >
                      <Share2 className="ico small" /> 分享
                    </button>
                    <button
                      type="button"
                      className="btn primary sm"
                      onClick={() => {
                        setAddQuery("");
                        setAddChecked(new Set());
                        setAddOpen(true);
                      }}
                    >
                      <Plus className="ico small" /> 添加仓库
                    </button>
                  </div>
                </div>
                {detailItems.length === 0 ? (
                  <EmptyState
                    icon={<Folder className="ico large" />}
                    title={
                      listQuery
                        ? "当前列表没有匹配项"
                        : "列表已经建好，加入几个仓库吧"
                    }
                    description={
                      listQuery
                        ? "试试更短的关键词。"
                        : "从收藏库中选择仓库，或按列表描述查看匹配建议。"
                    }
                    action={
                      listQuery ? (
                        <button
                          type="button"
                          className="btn"
                          onClick={() => setListQuery("")}
                        >
                          清除搜索
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn primary"
                          onClick={() => {
                            setAddQuery("");
                            setAddChecked(new Set());
                            setAddOpen(true);
                          }}
                        >
                          <Plus className="ico" /> 添加仓库
                        </button>
                      )
                    }
                  />
                ) : (
                  detailItems.map((item, index) => {
                    const emblem = repoEmblem(item.repository.name);
                    const description =
                      libById.get(item.savedRepositoryId)?.repository
                        .description ??
                      item.note ??
                      item.repository.namespacePath ??
                      "";
                    return (
                      <div className="list-item" key={item.id}>
                        <span className="item-number number">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <span className={`repo-emblem ${emblem.toneCls}`}>
                          {emblem.initials}
                        </span>
                        <div className="grow">
                          <Link
                            className="repo-title"
                            to={`/repository/${item.repository.id}`}
                          >
                            {item.repository.namespacePath
                              ? `${item.repository.namespacePath}/`
                              : ""}
                            {item.repository.name}
                          </Link>
                          {description && <p>{description}</p>}
                        </div>
                        <div className="item-actions">
                          <button
                            type="button"
                            className="btn icon ghost"
                            aria-label="上移"
                            title="上移"
                            disabled={index === 0 || offline}
                            onClick={() => {
                              if (!selected) return;
                              const order = selected.items.map(
                                (i) => i.savedRepositoryId,
                              );
                              [order[index - 1], order[index]] = [
                                order[index],
                                order[index - 1],
                              ];
                              void mutateItems({ reorder: order });
                            }}
                          >
                            <ArrowUp className="ico small" />
                          </button>
                          <button
                            type="button"
                            className="btn icon ghost"
                            aria-label="下移"
                            title="下移"
                            disabled={
                              index === selected.items.length - 1 || offline
                            }
                            onClick={() => {
                              if (!selected) return;
                              const order = selected.items.map(
                                (i) => i.savedRepositoryId,
                              );
                              [order[index], order[index + 1]] = [
                                order[index + 1],
                                order[index],
                              ];
                              void mutateItems({ reorder: order });
                            }}
                          >
                            <ArrowDown className="ico small" />
                          </button>
                          <button
                            type="button"
                            className="btn icon ghost"
                            aria-label="移出当前列表"
                            title="移出当前列表"
                            onClick={() =>
                              void removeItem(item.savedRepositoryId)
                            }
                          >
                            <X className="ico small" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
                <div className="list-public-info">
                  {publishedSelected ? (
                    <Share2 className="ico small" />
                  ) : (
                    <Lock className="ico small" />
                  )}
                  <span>
                    {publishedSelected
                      ? "分享使用独立快照，修改列表后需手动更新快照。"
                      : "这个列表仅自己可见。分享时会自动排除私有仓库。"}
                  </span>
                </div>
              </>
            ) : (
              <div className="muted small" style={{ padding: "40px 0" }}>
                {loadingLists ? "正在加载列表…" : "从左侧选择一个列表查看内容"}
              </div>
            )}
          </section>
        </div>
      )}

      {/* Create / edit dialog (prototype `createListDialog`) */}
      <Dialog
        open={listForm !== null}
        onClose={() => setListForm(null)}
        title={listForm?.id ? "修改列表" : "新建列表"}
        footer={
          <>
            <button
              type="button"
              className="btn"
              onClick={() => setListForm(null)}
            >
              取消
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={() => void onCreateOrSave()}
            >
              {listForm?.id ? "保存修改" : "创建列表"}
            </button>
          </>
        }
      >
        {listForm && (
          <>
            <p>
              {listForm.id
                ? "清晰的名称和描述有助于查找与智能归类。"
                : "给同一主题的仓库一个位置。新列表默认仅自己可见。"}
            </p>
            <label className="field-label mt16">
              列表名称
              <input
                className="field"
                value={listForm.name}
                maxLength={100}
                placeholder="例如：Agent 工具箱"
                autoFocus
                onChange={(e) =>
                  setListForm({ ...listForm, name: e.target.value })
                }
              />
            </label>
            <label className="field-label mt16">
              描述
              <textarea
                className="field"
                placeholder="这个列表会收录什么？"
                value={listForm.description}
                onChange={(e) =>
                  setListForm({ ...listForm, description: e.target.value })
                }
              />
              <span className="hint">智能归类会参考这段描述。</span>
            </label>
            {listFormError && (
              <p
                className="small mt8"
                role="status"
                style={{ color: "var(--red)" }}
              >
                {listFormError}
              </p>
            )}
          </>
        )}
      </Dialog>

      {/* Delete confirm (prototype `delete-list`) */}
      <Dialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="删除列表"
        footer={
          <>
            <button
              type="button"
              className="btn"
              onClick={() => setDeleteTarget(null)}
            >
              取消
            </button>
            <button
              type="button"
              className="btn danger-solid"
              onClick={() => void onDelete(deleteTarget!)}
            >
              <Trash2 className="ico" /> 删除列表
            </button>
          </>
        }
      >
        <p>
          将删除「{deleteTarget?.name}
          」和这个列表中的条目。收藏库中的仓库仍然保留。
        </p>
      </Dialog>

      {/* List actions menu (prototype `list-menu`) */}
      <Dialog
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={selected ? selected.name : "列表操作"}
      >
        <div className="stack">
          <button
            type="button"
            className="btn"
            disabled={!selected}
            onClick={() => {
              setMenuOpen(false);
              if (selected)
                openEditDialog({
                  id: selected.id,
                  name: selected.name,
                  description: selected.description,
                  version: selected.version,
                });
            }}
          >
            <Pencil className="ico" /> 修改名称与描述
          </button>
          <button
            type="button"
            className="btn"
            disabled={!selected || offline}
            onClick={() => {
              setMenuOpen(false);
              if (selected) void onExport(selected);
            }}
          >
            <Download className="ico" /> 导出便携清单
          </button>
          <button
            type="button"
            className="btn"
            disabled={!selected || offline}
            onClick={() => {
              setMenuOpen(false);
              if (selected) void openShare(selected);
            }}
          >
            <Share2 className="ico" /> 管理分享快照
          </button>
          <button
            type="button"
            className="btn danger"
            disabled={!selected}
            onClick={() => {
              if (!selected) return;
              setMenuOpen(false);
              setDeleteTarget(selected);
            }}
          >
            <Trash2 className="ico" /> 删除「{selected?.name ?? ""}」
          </button>
        </div>
      </Dialog>

      {/* Add-to-list picker (prototype `add-to-list`) */}
      <Dialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title={selected ? `添加到「${selected.name}」` : "添加仓库"}
        footer={
          <>
            <button
              type="button"
              className="btn"
              onClick={() => setAddOpen(false)}
            >
              取消
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={addChecked.size === 0}
              onClick={() => {
                const ids = Array.from(addChecked);
                setAddOpen(false);
                void mutateItems({ add: ids }).then(() =>
                  showToast(`已加入 ${ids.length} 个仓库`),
                );
              }}
            >
              <Plus className="ico" /> 加入选中仓库
            </button>
          </>
        }
      >
        <p>选择收藏库里的仓库。勾选后可以一起加入这个列表。</p>
        <div className="search-field mt16">
          <Search className="ico" />
          <input
            className="field"
            placeholder="搜索仓库"
            aria-label="搜索可加入的仓库"
            value={addQuery}
            onChange={(e) => setAddQuery(e.target.value)}
          />
        </div>
        <div className="check-list mt16">
          {filteredAddable.length === 0 ? (
            <p className="muted small">
              {addable.length === 0
                ? "收藏库里的仓库都已经加入。"
                : "没有匹配的仓库。"}
            </p>
          ) : (
            filteredAddable.map((s) => {
              const emblem = repoEmblem(s.repository.name);
              return (
                <label key={s.id}>
                  <input
                    type="checkbox"
                    checked={addChecked.has(s.id)}
                    onChange={(e) => {
                      setAddChecked((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(s.id);
                        else next.delete(s.id);
                        return next;
                      });
                    }}
                  />
                  <span className={`repo-emblem ${emblem.toneCls}`}>
                    {emblem.initials}
                  </span>
                  <span>
                    {s.repository.namespacePath
                      ? `${s.repository.namespacePath}/`
                      : ""}
                    {s.repository.name}
                  </span>
                </label>
              );
            })
          )}
        </div>
      </Dialog>

      {/* Smart-collect suggestions (prototype `auto-collect`) */}
      <Dialog
        open={suggestions !== null}
        onClose={() => setSuggestions(null)}
        title="智能归类建议"
        footer={
          <>
            <button
              type="button"
              className="btn"
              onClick={() => setSuggestions(null)}
            >
              取消
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={suggestChecked.size === 0 || autoCollectBusy}
              onClick={() => void commitSuggestions()}
            >
              <Plus className="ico" /> 加入选中建议
            </button>
          </>
        }
      >
        <p>根据列表描述与仓库已有摘要、标签匹配。这一步不调用新的 AI 服务。</p>
        <div className="check-list mt16">
          {(suggestions ?? []).map((m) => {
            const emblem = repoEmblem(m.item.repository.name);
            return (
              <label key={m.item.id}>
                <input
                  type="checkbox"
                  checked={suggestChecked.has(m.item.id)}
                  onChange={(e) => {
                    setSuggestChecked((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(m.item.id);
                      else next.delete(m.item.id);
                      return next;
                    });
                  }}
                />
                <span className={`repo-emblem ${emblem.toneCls}`}>
                  {emblem.initials}
                </span>
                <span>
                  {m.item.repository.namespacePath
                    ? `${m.item.repository.namespacePath}/`
                    : ""}
                  {m.item.repository.name}
                  <small className="muted" style={{ display: "block" }}>
                    {m.item.aiTags.join(" · ") || m.reason}
                  </small>
                </span>
              </label>
            );
          })}
        </div>
      </Dialog>

      {/* Import dialog (preview + commit) */}
      <Dialog
        open={importOpen}
        onClose={() => {
          setImportOpen(false);
          setPreview(null);
        }}
        title="导入列表"
        footer={
          preview ? (
            <>
              <button
                type="button"
                className="btn"
                onClick={() => setPreview(null)}
              >
                返回编辑
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={offline}
                onClick={() => void onCommit()}
              >
                确认导入
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn"
                onClick={() => setImportOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={!importText.trim() || offline}
                onClick={() => void onPreview()}
              >
                预览导入
              </button>
            </>
          )
        }
      >
        <p>
          先预览，再确认导入。支持 .gitstars-list.json 文件或粘贴便携清单内容。
        </p>
        <label className="field-label mt16">
          选择文件
          <input
            className="field"
            type="file"
            accept=".json,application/json"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              if (f.size > 2 * 1024 * 1024) {
                showToast("文件请控制在 2MB 以内");
                return;
              }
              setImportText(await f.text());
            }}
          />
        </label>
        <label className="field-label mt16">
          或粘贴 JSON
          <textarea
            className="field mono"
            style={{ minHeight: 170 }}
            placeholder={'{ "format": "gitstars-list", ... }'}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
          />
        </label>
        <div className="mt16" aria-live="polite">
          {preview && (
            <>
              <h3>{preview.title}</h3>
              <div className="draft-summary">
                <span>{preview.summary.new} 项可加入</span>
                <span>{preview.summary.existing} 项已存在</span>
                <span>{preview.summary.unresolved} 项未解析</span>
              </div>
            </>
          )}
        </div>
      </Dialog>

      {/* Share (publication) dialog — prototype `shareDialog` */}
      <Dialog
        open={shareTarget !== null}
        onClose={closeShare}
        title={shareTarget ? `分享「${shareTarget.name}」` : "分享"}
        footer={
          publication && publication.status === "active" ? (
            <>
              <button
                type="button"
                className="btn danger"
                disabled={shareBusy}
                onClick={() => setConfirmRevoke(true)}
              >
                <Trash2 className="ico" /> 取消分享
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={shareBusy}
                onClick={() => void onPublish()}
              >
                更新快照
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn" onClick={closeShare}>
                取消
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={shareLoading || shareBusy || offline}
                onClick={() => void onPublish()}
              >
                {shareLoading
                  ? "读取中…"
                  : publication
                    ? "重新发布"
                    : "生成公开快照"}
              </button>
            </>
          )
        }
      >
        <p>分享会生成一个独立的公开快照。列表后续变化不会自动更新到分享页。</p>
        {shareError && (
          <div className="notice error" role="alert">
            <span className="grow">{shareError}</span>
          </div>
        )}
        {shareNotice && (
          <div className="notice success">
            <span className="grow">{shareNotice}</span>
          </div>
        )}
        <div className="draft-summary">
          <span>可公开 {sharePublicCount} 项</span>
          <span>
            排除私有 {Math.max(0, shareTotalCount - sharePublicCount)} 项
          </span>
        </div>
        <div className="notice">
          <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
            <path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6ZM8 12l3 3 5-6" />
          </svg>
          <span>
            快照只含公开仓库资料。个人备注、AI 摘要和 AI 标签不会公开。
          </span>
        </div>
        {shareLoading && !publication ? (
          <p className="muted small">正在读取分享状态…</p>
        ) : publication && publication.status === "active" ? (
          <>
            <label className="field-label">
              分享链接
              <span className="key-wrap">
                <input
                  className="field"
                  readOnly
                  value={`${window.location.origin}${publication.shareUrl}`}
                />
                <button
                  type="button"
                  className="btn icon"
                  aria-label="复制分享链接"
                  title="复制分享链接"
                  onClick={() => void copyShareLink()}
                >
                  <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="8" y="8" width="13" height="13" rx="2" />
                    <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
                  </svg>
                </button>
              </span>
            </label>
            <a
              className="btn sm mt16"
              href={publication.shareUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              预览公开快照
            </a>
            <div className="setting-row mt16">
              <div>
                <h3>显示到 Hub 广场</h3>
                <p>让这份公开快照出现在 Hub 中。默认关闭。</p>
              </div>
              <button
                type="button"
                className={`switch ${publication.hubOptIn ? "on" : ""}`}
                role="switch"
                aria-checked={publication.hubOptIn}
                aria-label="将快照显示到 Hub"
                disabled={shareBusy}
                onClick={() => void onHubToggle(!publication.hubOptIn)}
              />
            </div>
            <p className="tiny muted mt16">
              快照 v{publication.snapshotVersion} · 需要手动更新
            </p>
            {confirmRevoke && (
              <div className="compare-box">
                <h3>确定取消分享？</h3>
                <p className="muted mt8">
                  取消后，当前链接将无法访问。你的私有列表和收藏仍然保留。
                </p>
                <div className="row mt8" style={{ justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => setConfirmRevoke(false)}
                  >
                    返回
                  </button>
                  <button
                    type="button"
                    className="btn danger-solid sm"
                    disabled={shareBusy}
                    onClick={() => void onRevoke()}
                  >
                    取消分享
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="compare-box">
            <h3>{publication ? "分享已取消" : "尚未发布"}</h3>
            <p className="muted mt8">
              只有生成公开快照后，其他人才能通过链接查看。加入 Hub
              是单独的选择。
            </p>
          </div>
        )}
      </Dialog>
    </div>
  );
};
