import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowDown,
  ArrowUp,
  Download,
  Pencil,
  Plus,
  Share2,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { autoCollectForList } from "../utils/autoCollect";
import {
  Badge,
  Button,
  Dialog,
  Input,
  Notice,
  PageHeader,
  Textarea,
} from "../components/ui";
import {
  exportList,
  getPublication,
  getList,
  updateList,
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
  const [searchParams, setSearchParams] = useSearchParams();

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

  // Sidebar shortcuts link to /lists?list=<id> — open that list directly.
  useEffect(() => {
    const target = searchParams.get("list");
    if (target && !loadingLists) {
      void openList(target);
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, loadingLists]);

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

  // --- 智能归类（Auto Collect）：按列表描述匹配 AI 摘要/标签自动加入 ---
  const [autoCollectBusy, setAutoCollectBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<{
    id: string;
    name: string;
    description: string;
    version: number;
  } | null>(null);
  const runAutoCollect = async () => {
    if (!selected || autoCollectBusy) return;
    if (!selected.description.trim()) {
      setNotice("请先为列表填写描述（智能归类依据描述与 AI 摘要/标签匹配）。");
      return;
    }
    const matches = autoCollectForList(addable, selected);
    if (matches.length === 0) {
      setNotice(
        "没有新匹配的仓库：智能归类依据列表描述与各仓库的 AI 摘要/标签进行匹配。",
      );
      return;
    }
    if (
      !window.confirm(
        `依据列表描述与 AI 摘要/标签，匹配到 ${matches.length} 个仓库。加入「${selected.name}」？`,
      )
    ) {
      return;
    }
    setAutoCollectBusy(true);
    try {
      await mutateItems({ add: matches.map((m) => m.item.id) });
    } finally {
      setAutoCollectBusy(false);
    }
  };

  const onEditSave = async () => {
    if (!editTarget) return;
    const name = editTarget.name.trim();
    if (!name) {
      setError("列表名称不能为空");
      return;
    }
    if (isOffline()) {
      setError("离线状态暂不支持编辑列表，请联网后重试");
      return;
    }
    try {
      const updated = await updateList(editTarget, {
        name,
        description: editTarget.description,
      });
      setEditTarget(null);
      await reloadLists();
      if (selected?.id === updated.id) {
        setSelected(await getList(updated.id));
      }
    } catch (e) {
      setError(msg(e));
    }
  };

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
    <div className="space-y-4">
      <PageHeader
        title="Lists"
        description="用列表组织收藏，支持导出、导入与公开分享"
      >
        <Button onClick={() => setImportOpen(true)}>
          <Upload className="h-4 w-4" /> 导入列表
        </Button>
      </PageHeader>
      {error && <Notice tone="error">{error}</Notice>}
      {notice && <Notice tone="info">{notice}</Notice>}

      <div className="grid grid-cols-1 min-[721px]:grid-cols-[205px_minmax(0,1fr)] min-[901px]:grid-cols-[242px_minmax(0,1fr)] bg-surface border border-line rounded-xl overflow-hidden min-h-[630px]">
        {/* master: list directory */}
        <div className="border-b min-[721px]:border-b-0 min-[721px]:border-r border-line p-3 bg-canvas">
          <div className="flex gap-1.5 mb-2">
            <Input
              ref={nameInputRef}
              placeholder="新列表名称"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void onCreate();
              }}
            />
            <Button
              size="icon"
              aria-label="新建列表"
              onClick={() => void onCreate()}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          {loadingLists && lists.length === 0 ? (
            <div className="grid gap-2 px-1" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="rounded-lg border border-line p-3 animate-pulse"
                >
                  <div className="h-3.5 w-1/2 bg-subtle rounded mb-2" />
                  <div className="h-3 w-1/3 bg-subtle rounded" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid gap-1">
              {lists.map((l) => {
                const active = selected?.id === l.id;
                return (
                  <div
                    key={l.id}
                    className={`group flex items-center gap-2.5 px-2.5 py-3 rounded-lg transition-colors ${
                      active ? "bg-brand-soft" : "hover:bg-subtle"
                    }`}
                  >
                    <button
                      onClick={() => void openList(l.id)}
                      className="flex-1 text-left min-w-0"
                    >
                      <div
                        className={`text-[13px] break-all ${active ? "text-brand-text font-semibold" : ""}`}
                      >
                        {l.name}
                      </div>
                      <div className="text-[10px] text-muted mt-1">
                        {l.itemCount ?? 0} 个仓库
                      </div>
                    </button>
                    <div className="hidden group-hover:flex items-center gap-0.5">
                      <Button
                        variant="ghost"
                        size="xs"
                        aria-label="编辑"
                        title="编辑名称与描述"
                        onClick={() =>
                          setEditTarget({
                            id: l.id,
                            name: l.name,
                            description:
                              lists.find((x) => x.id === l.id)?.description ??
                              "",
                            version: l.version,
                          })
                        }
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        aria-label="分享"
                        title="分享"
                        onClick={() => void openShare(l)}
                      >
                        <Share2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        aria-label="导出"
                        title="导出"
                        onClick={() => onExport(l)}
                      >
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        aria-label="删除"
                        title="删除"
                        onClick={() => void onDelete(l)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-danger" />
                      </Button>
                    </div>
                  </div>
                );
              })}
              {lists.length === 0 && !loadingLists && (
                <div className="px-2 py-4 text-xs text-muted">
                  还没有列表。在上方输入名称创建第一个。
                </div>
              )}
            </div>
          )}
        </div>

        {/* detail */}
        <div className="p-6 min-w-0">
          {selected ? (
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-[23px] font-[650] tracking-[-0.018em] break-all">
                    {selected.name}
                  </h2>
                  {selected.description ? (
                    <p className="text-xs text-muted mt-1.5 max-w-[660px] leading-[1.8]">
                      {selected.description}
                    </p>
                  ) : (
                    <p className="text-xs text-muted mt-1.5">
                      尚无描述 — 编辑列表补充描述后可启用智能归类。
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    variant="ai"
                    size="sm"
                    onClick={() => void runAutoCollect()}
                    disabled={autoCollectBusy}
                    title="依据列表描述与 AI 摘要/标签，把收藏库中的匹配仓库自动加入此列表"
                  >
                    <Sparkles
                      className={`h-3.5 w-3.5 ${autoCollectBusy ? "animate-pulse" : ""}`}
                    />
                    {autoCollectBusy ? "归类中..." : "智能归类"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="关闭"
                    onClick={() => setSelected(null)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <ul className="space-y-1">
                {selected.items.map((item, index) => (
                  <li
                    key={item.id}
                    className="flex items-center gap-3 py-3.5 border-b border-line last:border-b-0"
                  >
                    <span className="text-[10px] text-muted w-[17px] shrink-0">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <Link
                        to={`/repository/${item.repository.id}`}
                        className="text-[13px] font-[650] hover:text-brand-text block truncate"
                      >
                        {item.repository.name}
                      </Link>
                      <p className="text-[11px] text-muted truncate">
                        {item.repository.namespacePath ?? ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <Button
                        variant="ghost"
                        size="xs"
                        aria-label="上移"
                        disabled={index === 0 || isOffline()}
                        onClick={() => {
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
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        aria-label="下移"
                        disabled={
                          index === selected.items.length - 1 || isOffline()
                        }
                        onClick={() => {
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
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        aria-label="移出列表"
                        onClick={() =>
                          void mutateItems({ remove: [item.savedRepositoryId] })
                        }
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </li>
                ))}
                {selected.items.length === 0 && (
                  <li className="text-sm text-muted py-6 text-center">
                    空列表 — 从上方「智能归类」或 Library 卡片加入仓库。
                  </li>
                )}
              </ul>
            </div>
          ) : (
            <div className="h-full grid place-items-center py-20 text-sm text-muted">
              从左侧选择一个列表查看内容
            </div>
          )}
        </div>
      </div>

      {/* Import dialog */}
      <Dialog
        open={importOpen}
        onClose={() => {
          setImportOpen(false);
          setPreview(null);
        }}
        title="导入列表"
        footer={
          <>
            {preview && (
              <Button size="sm" onClick={onCommit}>
                确认导入
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={onPreview}
              disabled={!importText.trim()}
            >
              预览
            </Button>
          </>
        }
      >
        <p className="text-xs text-muted mb-4">
          粘贴 gitstars-list v0 格式的
          JSON。预览通过后才会创建；未知平台的条目会保留为未解析记录。
        </p>
        <Textarea
          rows={6}
          className="font-mono text-xs"
          placeholder='{"format":"gitstars-list","schemaVersion":0,...}'
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
        />
        {preview && (
          <div className="bg-canvas border border-line rounded-lg p-3.5 text-xs mt-4 leading-[1.8]">
            <div className="font-medium">
              “{preview.title}” — 共 {preview.summary.total} 项
            </div>
            <div className="text-muted">
              新增 {preview.summary.new} · 已存在 {preview.summary.existing} ·
              未解析 {preview.summary.unresolved}
            </div>
          </div>
        )}
      </Dialog>

      {/* Share (publication) dialog */}
      <Dialog
        open={shareTarget !== null}
        onClose={closeShare}
        title={shareTarget ? `分享 · ${shareTarget.name}` : "分享"}
        footer={
          publication ? (
            <>
              {publication.hubOptIn ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={shareBusy}
                  onClick={() => void onHubToggle(false)}
                >
                  从 Hub 移除
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={shareBusy}
                  onClick={() => void onHubToggle(true)}
                >
                  公开到 Hub
                </Button>
              )}
              {publication.status === "active" ? (
                <Button
                  variant="danger"
                  size="sm"
                  disabled={shareBusy}
                  onClick={() => setConfirmRevoke(true)}
                >
                  取消分享
                </Button>
              ) : (
                <Button
                  size="sm"
                  disabled={shareBusy}
                  onClick={() => void onPublish()}
                >
                  重新发布
                </Button>
              )}
            </>
          ) : (
            <Button
              variant="ai"
              disabled={shareLoading || shareBusy}
              onClick={() => void onPublish()}
            >
              {shareLoading ? "生成中…" : "生成分享链接"}
            </Button>
          )
        }
      >
        {shareError && <Notice tone="error">{shareError}</Notice>}
        {shareNotice && <Notice tone="success">{shareNotice}</Notice>}
        {shareLoading && !publication ? (
          <p className="text-xs text-muted">正在读取分享状态…</p>
        ) : publication ? (
          <div className="grid gap-4">
            <div>
              <div className="text-xs font-semibold mb-1.5">公开范围</div>
              <p className="text-xs text-muted leading-[1.8]">
                分享是当前内容的独立快照：包含列表名称、描述与公开仓库的名称和地址。个人备注、手动标签、AI
                摘要/标签与私有仓库不会包含。修改列表后需在此手动更新快照，公开页才会变化。
              </p>
            </div>
            <div className="bg-canvas border border-line rounded-lg p-3.5 text-xs break-all">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="font-semibold">分享链接</span>
                <span className="text-muted">
                  快照 v{publication.snapshotVersion}
                </span>
              </div>
              <code className="text-info">
                {window.location.origin}
                {publication.shareUrl}
              </code>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => void copyShareLink()}>
                {copied ? "已复制" : "复制链接"}
              </Button>
              <a
                href={publication.shareUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-info hover:underline"
              >
                打开公开页
              </a>
              <Badge tone={publication.hubOptIn ? "success" : "neutral"}>
                {publication.hubOptIn ? "已加入 Hub" : "未加入 Hub"}
              </Badge>
            </div>
            {confirmRevoke && (
              <div className="bg-danger-soft text-danger border border-line rounded-lg p-3 text-xs">
                取消分享后，公开链接将立即失效，Hub
                展示同步移除；你的私有列表不受影响。确定取消？
                <div className="flex gap-2 mt-2">
                  <Button size="xs" onClick={() => setConfirmRevoke(false)}>
                    先不取消
                  </Button>
                  <Button
                    variant="danger-solid"
                    size="xs"
                    disabled={shareBusy}
                    onClick={() => void onRevoke()}
                  >
                    确认取消分享
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted leading-[1.8]">
            生成分享链接会创建当前列表的公开快照：包含列表名称、描述与公开仓库的名称和地址；个人备注、标签与私有仓库不会包含。生成后可选择是否公开到
            Hub 广场。
          </p>
        )}
      </Dialog>

      {/* Edit list dialog */}
      <Dialog
        open={editTarget !== null}
        onClose={() => setEditTarget(null)}
        title="编辑列表"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditTarget(null)}>
              取消
            </Button>
            <Button onClick={() => void onEditSave()}>保存</Button>
          </>
        }
      >
        {editTarget && (
          <div className="grid gap-4">
            <label className="flex flex-col gap-1.5 text-xs font-semibold">
              名称
              <Input
                value={editTarget.name}
                onChange={(e) =>
                  setEditTarget({ ...editTarget, name: e.target.value })
                }
              />
            </label>
            <label className="flex flex-col gap-1.5 text-xs font-semibold">
              描述
              <span className="font-normal text-muted">
                描述用于智能归类匹配，写得越具体效果越好。
              </span>
              <Textarea
                className="min-h-[80px]"
                value={editTarget.description}
                onChange={(e) =>
                  setEditTarget({ ...editTarget, description: e.target.value })
                }
              />
            </label>
          </div>
        )}
      </Dialog>
    </div>
  );
};
