import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import {
  Bookmark,
  Check,
  Compass,
  ExternalLink,
  Folder,
  MoreHorizontal,
  FileText,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  WifiOff,
  X,
} from "lucide-react";
import {
  getList,
  listLibrary,
  listLists,
  listTags,
  searchRepositories,
  syncProvider,
  updateSaved,
  type ListSummary,
  type SavedRepository,
  type SearchItemView,
  type Tag,
} from "../utils/gitstarsApi";
import { ApiError, apiPut } from "../utils/api";
import { summarizeProject } from "../utils/ai";
import { useAiConfigStore } from "../store/useAiConfigStore";
import {
  matchCachedRepository,
  outcomeErrorLabel,
  readLibraryCache,
  saveRepositoryFromLibrary,
  unsaveRepository,
  updateSavedFields,
  upsertLibraryPage,
  upsertTags,
  type MutationOutcome,
} from "../data/offlineMutations";
import {
  applyLibraryFilters,
  collectAiTags,
  collectLanguages,
  computeLibraryStats,
  EMPTY_LIBRARY_FILTERS,
  formatCount,
  type LibraryFilters,
} from "../utils/libraryFilters";
import { useSyncStatusStore } from "../store/useSyncStatusStore";
import { useSyncDrawerStore } from "../store/useSyncDrawerStore";
import { ActivityBadge } from "../components/ActivityBadge";
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Input,
  Notice,
  PageHeader,
  Select,
  SkeletonCard,
  Textarea,
} from "../components/ui";

const resultKey = (r: SearchItemView): string =>
  `${r.identity.providerType}:${r.identity.remoteId}`;

const LANG_DOTS: Record<string, string> = {
  TypeScript: "#3178a9",
  JavaScript: "#b59438",
  Python: "#b59438",
  Rust: "#b46f52",
  Go: "#32829a",
  Java: "#9763a7",
  "C++": "#9763a7",
  C: "#6b7781",
  PHP: "#8188b5",
  Shell: "#6b7781",
  HTML: "#c0653a",
  CSS: "#5a7fa8",
  Vue: "#4d9565",
  MATLAB: "#c0653a",
};

const CARD_TONES = ["brand", "ai", "gold", "info"] as const;

function repoEmblem(name: string) {
  const initials = name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2) || "??";
  const hash = Array.from(name).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const tone = CARD_TONES[hash % CARD_TONES.length];
  const toneCls = {
    brand: "bg-brand-soft text-brand-text",
    ai: "bg-ai-soft text-ai",
    gold: "bg-gold-soft text-gold",
    info: "bg-info-soft text-info",
  }[tone];
  return { initials: initials.toLowerCase(), toneCls };
}

interface BatchState {
  mode: "missing" | "all";
  total: number;
  done: number;
  failed: number;
  current: string;
}

export const Library: React.FC = () => {
  const [items, setItems] = useState<SavedRepository[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [filters, setFilters] = useState<LibraryFilters>(EMPTY_LIBRARY_FILTERS);
  const [view, setView] = useState<"grid" | "row">("grid");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchItemView[] | null>(null);
  const [saveable, setSaveable] = useState<Map<string, string>>(new Map());
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [noteFor, setNoteFor] = useState<SavedRepository | null>(null);
  const isOnline = useSyncStatusStore((s) => s.isOnline);
  const isAiConfigured = useAiConfigStore((s) => s.isConfigured());
  const toggleSyncDrawer = useSyncDrawerStore((s) => s.toggle);
  const mountedRef = useRef(false);

  // --- List memberships (quick add/remove from cards) ---
  const [lists, setLists] = useState<ListSummary[]>([]);
  const [memberships, setMemberships] = useState<Map<string, Set<string>>>(
    new Map(),
  );
  const [listMenuFor, setListMenuFor] = useState<string | null>(null);
  const [listToggleBusy, setListToggleBusy] = useState<string | null>(null);

  // --- Batch AI summarize ---
  const [batch, setBatch] = useState<BatchState | null>(null);
  const batchStopRef = useRef(false);
  const itemsRef = useRef<SavedRepository[]>([]);
  itemsRef.current = items;

  const setFilter = (patch: Partial<LibraryFilters>) =>
    setFilters((f) => ({ ...f, ...patch }));

  const filterCount =
    (filters.language ? 1 : 0) +
    (filters.provider ? 1 : 0) +
    (filters.tag ? 1 : 0) +
    filters.aiTags.length;

  /** Reflect the local cache into the view (optimistic/offline state). */
  const hydrateFromCache = useCallback(async () => {
    try {
      const cache = await readLibraryCache();
      setItems(applyLibraryFilters(cache.items, filters));
      setTags(cache.tags);
    } catch {
      // cache unavailable — the server fetch path still applies
    }
  }, [filters]);

  const reload = useCallback(async () => {
    try {
      const [lib, tg] = await Promise.all([
        listLibrary({
          provider: filters.provider,
          tag: filters.tag,
          sort: filters.sort,
          order: "desc",
        }),
        listTags(),
      ]);
      setItems(applyLibraryFilters(lib, filters));
      setTags(tg);
      setError("");
      setNotice("");
      try {
        await Promise.all([upsertLibraryPage(lib), upsertTags(tg)]);
      } catch {
        // cache write is best-effort
      }
    } catch (e) {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        setNotice("离线：正在显示本地缓存");
        setError("");
        await hydrateFromCache();
      } else {
        setError(
          e instanceof ApiError ? e.message : "加载收藏库失败，请稍后重试",
        );
      }
    } finally {
      setLoading(false);
    }
  }, [filters, hydrateFromCache]);

  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    void hydrateFromCache();
  }, [hydrateFromCache]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const loadLists = useCallback(async () => {
    try {
      const summaries = await listLists();
      setLists(summaries);
      const details = await Promise.all(
        summaries.map((l) => getList(l.id).catch(() => null)),
      );
      const map = new Map<string, Set<string>>();
      for (const detail of details) {
        if (!detail) continue;
        for (const item of detail.items) {
          const set = map.get(item.savedRepositoryId) ?? new Set<string>();
          set.add(detail.id);
          map.set(item.savedRepositoryId, set);
        }
      }
      setMemberships(map);
    } catch {
      setLists([]);
    }
  }, []);

  useEffect(() => {
    void loadLists();
  }, [loadLists]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await reload();
    } catch (e) {
      setError(
        e instanceof ApiError ? `${e.code}: ${e.message}` : "操作失败，请重试",
      );
    } finally {
      setBusy(false);
    }
  };

  const syncNow = () => run(() => syncProvider("github"));

  const mutate = async (fn: () => Promise<MutationOutcome<unknown>>) => {
    setError("");
    setNotice("");
    const out = await fn();
    if (out.confirmed) {
      await reload();
      return true;
    }
    if (out.error) {
      setError(outcomeErrorLabel(out));
    } else {
      setNotice("离线：更改已保存到本地，联网后自动同步");
    }
    await hydrateFromCache();
    return !out.error;
  };

  const runMutation = (fn: () => Promise<MutationOutcome<unknown>>) => {
    setBusy(true);
    void mutate(fn).finally(() => setBusy(false));
  };

  const onSearch = async () => {
    if (!query.trim()) {
      setResults(null);
      setSaveable(new Map());
      return;
    }
    setBusy(true);
    try {
      const r = await searchRepositories(query.trim());
      setResults(r.items);
      const map = new Map<string, string>();
      for (const item of r.items) {
        try {
          const cached = await matchCachedRepository(
            item.identity.providerType,
            item.identity.remoteId,
          );
          if (cached) map.set(resultKey(item), cached.id);
        } catch {
          /* cache unavailable */
        }
      }
      setSaveable(map);
    } catch (e) {
      setError(
        e instanceof ApiError ? `${e.code}: ${e.message}` : "搜索失败，请重试",
      );
    } finally {
      setBusy(false);
    }
  };

  const onSaveResult = async (r: SearchItemView) => {
    const key = resultKey(r);
    const repositoryId = saveable.get(key);
    if (!repositoryId || savedKeys.has(key) || savingKey) return;
    setSavingKey(key);
    setError("");
    setNotice("");
    const out = await saveRepositoryFromLibrary(repositoryId);
    setSavedKeys((prev) => new Set(prev).add(key));
    if (out.error) setError(outcomeErrorLabel(out));
    else if (!out.confirmed)
      setNotice("离线：更改已保存到本地，联网后自动同步");
    else await reload();
    setSavingKey(null);
  };

  const toggleListMembership = async (savedId: string, listId: string) => {
    const member = memberships.get(savedId)?.has(listId);
    if (listToggleBusy) return;
    setListToggleBusy(`${savedId}:${listId}`);
    setError("");
    try {
      await apiPut(
        `/api/lists/${listId}/items`,
        member ? { remove: [savedId] } : { add: [savedId] },
      );
      setMemberships((prev) => {
        const next = new Map(prev);
        const set = new Set(next.get(savedId) ?? []);
        if (member) set.delete(listId);
        else set.add(listId);
        next.set(savedId, set);
        return next;
      });
    } catch (e) {
      setError(
        e instanceof ApiError ? `${e.code}: ${e.message}` : "操作失败，请重试",
      );
    } finally {
      setListToggleBusy(null);
    }
  };

  // --- Batch AI summarize (sequential, pausable) ---
  const startBatchSummarize = async (mode: "missing" | "all") => {
    if (batch) return;
    if (!isAiConfigured) {
      setError("请先在 设置 → AI 设置 中选择厂商并填写 API Key");
      return;
    }
    if (!isOnline) {
      setError("批量 AI 总结需要联网后使用");
      return;
    }
    const all = itemsRef.current;
    const targets = mode === "all" ? all : all.filter((it) => !it.aiSummary);
    if (targets.length === 0) {
      setNotice("所有仓库都已有 AI 总结");
      return;
    }
    const message =
      mode === "all"
        ? `将重新生成全部 ${targets.length} 个仓库的 AI 总结，会覆盖现有内容并消耗 API 额度。继续？`
        : `将为 ${targets.length} 个缺少总结的仓库生成 AI 总结。再次点击可暂停。`;
    if (!window.confirm(message)) return;

    batchStopRef.current = false;
    setBatch({ mode, total: targets.length, done: 0, failed: 0, current: "" });
    let done = 0;
    let failed = 0;

    for (const it of targets) {
      if (batchStopRef.current) break;
      setBatch((b) => (b ? { ...b, current: it.repository.name } : b));
      try {
        const result = await summarizeProject(
          it.repository.name,
          it.repository.description ?? "",
          it.repository.primaryLanguage ?? "",
          it.tags.map((t) => t.name),
        );
        const res = await updateSaved(
          it.id,
          { aiSummary: result.summary, aiTags: result.tags },
          `${it.id}:${it.version}`,
        );
        setItems((prev) =>
          prev.map((row) =>
            row.id === it.id
              ? {
                  ...row,
                  aiSummary: result.summary,
                  aiTags: result.tags,
                  version: res.version,
                }
              : row,
          ),
        );
      } catch {
        failed++;
      }
      done++;
      setBatch((b) => (b ? { ...b, done, failed } : b));
    }

    setBatch((b) => (b ? { ...b, current: "" } : b));
    try {
      await upsertLibraryPage(itemsRef.current);
    } catch {
      // best-effort
    }
    setNotice(
      batchStopRef.current
        ? `批量总结已暂停：完成 ${done}/${targets.length}` +
            (failed ? `，失败 ${failed}` : "")
        : `批量总结完成：${done - failed} 成功` +
            (failed ? `，${failed} 失败` : ""),
    );
    setTimeout(() => setBatch(null), 2500);
  };

  const languages = useMemo(() => collectLanguages(items), [items]);
  const aiTagOptions = useMemo(() => collectAiTags(items), [items]);
  const stats = useMemo(() => computeLibraryStats(items), [items]);

  const saveNote = async (saved: SavedRepository, note: string) => {
    setError("");
    const out = await updateSavedFields(
      { id: saved.id, version: saved.version },
      { note },
    );
    if (out.error) {
      setError(outcomeErrorLabel(out));
      return false;
    }
    if (!out.confirmed) setNotice("离线：更改已保存到本地，联网后自动同步");
    await hydrateFromCache();
    return true;
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="收藏库"
        badge={`${stats.total}`}
        description="快速找到之前收藏的仓库，判断用途，完成整理"
      >
        <Button variant="secondary" onClick={() => setDiscoverOpen((v) => !v)}>
          <Compass className="h-4 w-4" />
          发现仓库
        </Button>
        {batch ? (
          <Button
            variant="danger-solid"
            onClick={() => {
              batchStopRef.current = true;
            }}
          >
            暂停批量总结（{batch.done}/{batch.total}）
          </Button>
        ) : (
          <details className="relative">
            <summary className="inline-flex items-center gap-[7px] min-h-[36px] px-3 rounded-[7px] border border-transparent text-ai text-[13px] font-medium cursor-pointer list-none hover:bg-ai-soft">
              <Sparkles className="h-4 w-4" /> AI 摘要
            </summary>
            <div className="absolute right-0 z-20 mt-1 w-56 bg-surface border border-line rounded-lg shadow-[box-shadow] py-1 text-sm">
              <Button
                variant="ghost"
                className="w-full !justify-start"
                onClick={() => void startBatchSummarize("missing")}
              >
                补充缺失总结
              </Button>
              <Button
                variant="ghost"
                className="w-full !justify-start text-danger"
                onClick={() => void startBatchSummarize("all")}
              >
                全部重新生成…
              </Button>
            </div>
          </details>
        )}
      </PageHeader>

      {batch && (
        <div className="bg-ai-soft text-ai rounded-[9px] px-4 py-3 text-xs mb-4">
          <div className="flex items-center justify-between mb-2">
            <span>
              {batch.current
                ? `正在总结：${batch.current}`
                : batch.done >= batch.total
                  ? "结束"
                  : "准备中…"}
            </span>
            <span>
              {batch.done}/{batch.total}
              {batch.failed ? ` · 失败 ${batch.failed}` : ""}
            </span>
          </div>
          <div className="h-[5px] rounded-full bg-surface overflow-hidden">
            <div
              className="h-full bg-ai transition-[width] duration-200"
              style={{
                width: `${batch.total ? (batch.done / batch.total) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      )}

      {error && <Notice tone="error">{error}</Notice>}
      {notice && <Notice tone="info">{notice}</Notice>}
      {!isOnline && (
        <Notice tone="warning">
          <WifiOff className="h-4 w-4 shrink-0" />
          <span className="flex-1">
            正在查看本地缓存。备注与标签的更改会在联网后同步。
          </span>
          <Button variant="ghost" size="xs" onClick={toggleSyncDrawer}>
            查看待同步项
          </Button>
        </Notice>
      )}

      {/* Discover panel (source search, toggled from page header) */}
      {discoverOpen && (
        <Card className="p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-muted">
              来源发现 · 搜索 GitHub 仓库
            </span>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setDiscoverOpen(false)}
            >
              <X className="h-3.5 w-3.5" /> 收起
            </Button>
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="搜索 GitHub 仓库..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void onSearch();
              }}
            />
            <Button onClick={() => void onSearch()}>
              <Search className="h-4 w-4" /> Search
            </Button>
          </div>
          {results && (
            <ul className="mt-3 divide-y divide-line">
              {results.map((r) => {
                const key = resultKey(r);
                const saved = savedKeys.has(key);
                const repositoryId = saveable.get(key);
                return (
                  <li
                    key={key}
                    className="py-2 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">
                        {r.namespacePath ? `${r.namespacePath}/` : ""}
                        {r.name}
                      </div>
                      <div className="text-xs text-muted truncate">
                        {r.description}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {saved ? (
                        <Badge tone="success">
                          <Check className="h-3 w-3" /> 已收藏
                        </Badge>
                      ) : (
                        <Button
                          size="xs"
                          onClick={() => void onSaveResult(r)}
                          disabled={
                            !repositoryId || !isOnline || savingKey === key
                          }
                          title={
                            !isOnline
                              ? "离线状态暂不支持收藏"
                              : !repositoryId
                                ? "该仓库尚未同步到本地目录；先在 GitHub 收藏并同步后即可加入"
                                : "收藏到我的库"
                          }
                        >
                          <Bookmark className="h-3 w-3" /> 收藏
                        </Button>
                      )}
                      <a
                        href={r.webUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-info hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" /> Open
                      </a>
                    </div>
                  </li>
                );
              })}
              {results.length === 0 && (
                <li className="py-2 text-sm text-muted">No results.</li>
              )}
            </ul>
          )}
        </Card>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
          <Input
            className="pl-[38px]"
            placeholder="搜索收藏库…"
            value={filters.search}
            onChange={(e) => setFilter({ search: e.target.value })}
          />
        </div>
        <div className="inline-flex items-center bg-subtle p-[3px] rounded-[7px] gap-0.5">
          {[
            { value: "", label: "全部" },
            { value: "star", label: "Star" },
            { value: "fork", label: "Fork" },
          ].map((opt) => (
            <button
              key={opt.value}
              onClick={() => setFilter({ kind: opt.value })}
              className={`px-3 py-1 rounded-[5px] text-xs min-h-[30px] transition-colors ${
                filters.kind === opt.value
                  ? "bg-surface text-ink shadow-sm font-medium"
                  : "text-muted hover:text-ink"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="relative">
          <Button
            variant={filterCount > 0 ? "primary" : "secondary"}
            onClick={() => setFilterOpen((v) => !v)}
            aria-expanded={filterOpen}
          >
            筛选{filterCount > 0 ? ` · ${filterCount}` : ""}
          </Button>
          {filterOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setFilterOpen(false)}
              />
              <Card className="absolute right-0 top-11 z-30 w-[310px] p-[19px] shadow-[0_12px_40px_rgb(22_32_43/0.13)]">
                <div className="flex items-center justify-between mb-3.5">
                  <h3 className="text-[15px] font-semibold">筛选收藏库</h3>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => setFilterOpen(false)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <label className="flex flex-col gap-1.5 text-xs font-semibold my-3">
                  来源平台
                  <Select
                    value={filters.provider}
                    onChange={(e) => setFilter({ provider: e.target.value })}
                    className="w-full font-normal"
                  >
                    <option value="">全部平台</option>
                    <option value="github">GitHub</option>
                    <option value="gitlab">GitLab</option>
                    <option value="gitee">Gitee</option>
                  </Select>
                </label>
                <label className="flex flex-col gap-1.5 text-xs font-semibold my-3">
                  语言
                  <Select
                    value={filters.language}
                    onChange={(e) => setFilter({ language: e.target.value })}
                    className="w-full font-normal"
                  >
                    <option value="">全部语言</option>
                    {languages.map((lang) => (
                      <option key={lang} value={lang}>
                        {lang}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="flex flex-col gap-1.5 text-xs font-semibold my-3">
                  手动标签
                  <Select
                    value={filters.tag}
                    onChange={(e) => setFilter({ tag: e.target.value })}
                    className="w-full font-normal"
                  >
                    <option value="">全部手动标签</option>
                    {tags.map((t) => (
                      <option key={t.id} value={t.name}>
                        {t.name}
                      </option>
                    ))}
                  </Select>
                </label>
                <div className="text-xs text-muted mt-4 mb-2">
                  AI 标签 · 需包含全部选中标签
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {aiTagOptions.map((tag) => {
                    const selected = filters.aiTags.includes(tag);
                    return (
                      <button
                        key={tag}
                        onClick={() =>
                          setFilter({
                            aiTags: selected
                              ? filters.aiTags.filter((t) => t !== tag)
                              : [...filters.aiTags, tag],
                          })
                        }
                        aria-pressed={selected}
                        className={`inline-flex items-center gap-1 border rounded-[5px] px-2 py-1 text-[11px] transition-colors ${
                          selected
                            ? "bg-brand-soft text-brand-text border-brand"
                            : "bg-surface text-muted border-line hover:text-ink hover:border-line-strong"
                        }`}
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between mt-6">
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() =>
                      setFilters({
                        ...EMPTY_LIBRARY_FILTERS,
                        sort: filters.sort,
                      })
                    }
                  >
                    清除条件
                  </Button>
                  <Button size="sm" onClick={() => setFilterOpen(false)}>
                    完成
                  </Button>
                </div>
              </Card>
            </>
          )}
        </div>
        <Select
          value={filters.sort}
          onChange={(e) =>
            setFilter({ sort: e.target.value as LibraryFilters["sort"] })
          }
        >
          <option value="added_at">最近添加</option>
          <option value="stars">Star 最多</option>
          <option value="name">名称</option>
        </Select>
        <div className="flex border border-line rounded-[7px] p-[2px] bg-surface ml-auto">
          {(
            [
              { v: "grid", icon: <Compass className="h-4 w-4 rotate-45" /> },
              { v: "row", icon: <Folder className="h-4 w-4" /> },
            ] as const
          ).map(({ v }) => (
            <button
              key={v}
              aria-label={v === "grid" ? "卡片视图" : "列表视图"}
              onClick={() => setView(v)}
              className={`w-[31px] h-[30px] grid place-items-center rounded-[5px] transition-colors ${
                view === v ? "bg-subtle text-ink" : "text-muted hover:text-ink"
              }`}
            >
              {v === "grid" ? (
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.65"
                >
                  <rect x="3" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" />
                  <rect x="14" y="14" width="7" height="7" rx="1" />
                </svg>
              ) : (
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.65"
                >
                  <path d="M8 6h13M8 12h13M8 18h13M3 6h.1M3 12h.1M3 18h.1" />
                </svg>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* AI tag strip */}
      {aiTagOptions.length > 0 && (
        <div className="flex items-center gap-[7px] flex-wrap mb-4 text-[11px]">
          <span className="text-muted inline-flex items-center gap-1">
            <Sparkles className="h-3 w-3" /> AI 标签
          </span>
          {aiTagOptions.slice(0, 12).map((tag) => {
            const selected = filters.aiTags.includes(tag);
            return (
              <button
                key={tag}
                onClick={() =>
                  setFilter({
                    aiTags: selected
                      ? filters.aiTags.filter((t) => t !== tag)
                      : [...filters.aiTags, tag],
                  })
                }
                aria-pressed={selected}
                className={`inline-flex items-center gap-1 border rounded-[5px] px-2 py-1 transition-colors ${
                  selected
                    ? "bg-brand-soft text-brand-text border-brand"
                    : "bg-surface text-muted border-line hover:text-ink hover:border-line-strong"
                }`}
              >
                {tag}
              </button>
            );
          })}
          {aiTagOptions.length > 12 && (
            <button
              onClick={() => setFilterOpen(true)}
              className="inline-flex items-center border border-line rounded-[5px] px-2 py-1 text-muted bg-surface hover:text-ink"
            >
              等 {aiTagOptions.length} 个
            </button>
          )}
          {filterCount + (filters.search ? 1 : 0) > 0 && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() =>
                setFilters({ ...EMPTY_LIBRARY_FILTERS, sort: filters.sort })
              }
            >
              清除全部筛选
            </Button>
          )}
        </div>
      )}

      {/* Results line */}
      <div className="flex items-center justify-between border-t border-line pt-3 mb-4 text-[11px] text-muted">
        <span>
          {items.length} 个结果 · 库共 {stats.total} 个收藏 · ★{" "}
          {formatCount(stats.stars)} · {formatCount(stats.forks)} forks
        </span>
        {lists.length > 0 && <span>{lists.length} 个列表</span>}
      </div>

      {/* Content */}
      {loading ? (
        <div
          className={
            view === "grid"
              ? "grid grid-cols-1 min-[1251px]:grid-cols-2 min-[1701px]:grid-cols-3 gap-3.5"
              : "space-y-2"
          }
        >
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={filters.search || filterCount > 0 ? <Search /> : <Star />}
          title={
            filters.search || filterCount > 0
              ? "没有符合筛选条件的仓库"
              : "收藏库还是空的"
          }
          description={
            filters.search || filterCount > 0
              ? "试试调整搜索词或清除筛选条件。"
              : "同步你的 GitHub Stars 和 Forks，构建可离线使用的收藏库。"
          }
          action={
            filters.search || filterCount > 0 ? (
              <Button
                onClick={() =>
                  setFilters({ ...EMPTY_LIBRARY_FILTERS, sort: filters.sort })
                }
              >
                清除筛选
              </Button>
            ) : (
              <Button onClick={() => void syncNow()} disabled={busy}>
                <RefreshCw
                  className={`h-4 w-4 ${busy ? "animate-spin" : ""}`}
                />
                同步 GitHub Stars
              </Button>
            )
          }
        />
      ) : view === "grid" ? (
        <div className="grid grid-cols-1 min-[1251px]:grid-cols-2 min-[1701px]:grid-cols-3 gap-3.5">
          {items.map((it) => {
            const emblem = repoEmblem(it.repository.name);
            const memberLists = memberships.get(it.id);
            return (
              <Card
                key={it.id}
                hover
                className="p-[17px] pb-3 flex flex-col relative"
              >
                <div className="flex items-start gap-2.5 mb-3 min-w-0">
                  <span
                    className={`grid place-items-center w-[35px] h-[35px] shrink-0 rounded-[9px] text-[13px] font-[650] ${emblem.toneCls}`}
                  >
                    {emblem.initials}
                  </span>
                  <div className="flex-1 min-w-0 pr-5">
                    <Link
                      to={`/repository/${it.repository.id}`}
                      className="text-sm leading-[1.45] font-[650] tracking-[-0.01em] block break-all hover:text-brand-text"
                    >
                      {it.repository.name}
                    </Link>
                    <div className="text-[11px] text-muted mt-0.5 flex items-center gap-1 truncate">
                      {it.repository.namespacePath}
                      {it.repository.visibility === "private" && (
                        <span className="text-gold">· 私有</span>
                      )}
                    </div>
                  </div>
                </div>
                {it.repository.description && (
                  <p className="text-xs text-muted leading-[1.7] line-clamp-2 min-h-[41px] mb-3 break-all">
                    {it.repository.description}
                  </p>
                )}
                {it.aiSummary && (
                  <div className="text-xs bg-ai-soft text-ai rounded-md px-2 py-1.5 mb-3 line-clamp-2">
                    <Sparkles className="h-3 w-3 inline mr-1 -mt-0.5" />
                    {it.aiSummary}
                  </div>
                )}
                <div className="flex items-center gap-1.5 min-h-[23px] mb-3 overflow-hidden">
                  {it.aiTags.slice(0, 2).map((name) => (
                    <Badge key={`ai-${name}`} tone="ai">
                      {name}
                    </Badge>
                  ))}
                  {it.tags.slice(0, 1).map((t) => (
                    <Badge key={t.id}>{t.name}</Badge>
                  ))}
                </div>
                <div className="flex items-center gap-3 text-[11px] text-muted mt-auto pb-3">
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="w-[7px] h-[7px] rounded-full inline-block"
                      style={{
                        background:
                          LANG_DOTS[it.repository.primaryLanguage ?? ""] ??
                          "var(--c-muted)",
                      }}
                    />
                    {it.repository.primaryLanguage || "—"}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Star className="h-3 w-3" />
                    {formatCount(it.repository.starsCount)}
                  </span>
                  <ActivityBadge
                    owner={it.repository.namespacePath}
                    repo={it.repository.name}
                  />
                </div>
                <div className="border-t border-line pt-2 flex items-center justify-between gap-1">
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() =>
                      setListMenuFor((cur) => (cur === it.id ? null : it.id))
                    }
                  >
                    <Folder className="h-3.5 w-3.5" />
                    {memberLists && memberLists.size > 0
                      ? `已在 ${memberLists.size} 个列表`
                      : "加入列表"}
                  </Button>
                  <div className="flex items-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="xs"
                      aria-label="编辑备注"
                      title={it.note ? "编辑个人备注" : "添加个人备注"}
                      onClick={() => setNoteFor(it)}
                    >
                      <FileText className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      aria-label="更多操作"
                      title="移出收藏库"
                      onClick={() => {
                        if (!window.confirm("确定将该仓库从收藏移除？")) return;
                        runMutation(() =>
                          unsaveRepository({ id: it.id, version: it.version }),
                        );
                      }}
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {listMenuFor === it.id && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setListMenuFor(null)}
                    />
                    <div className="absolute left-3 bottom-12 z-20 w-56 max-h-64 overflow-auto bg-surface border border-line rounded-lg shadow-[0_12px_40px_rgb(22_32_43/0.13)] py-1 text-[13px]">
                      {lists.length === 0 && (
                        <div className="px-3 py-2 text-xs text-muted">
                          还没有列表，先到「我的列表」创建一个。
                        </div>
                      )}
                      {lists.map((list) => {
                        const member = memberLists?.has(list.id) ?? false;
                        return (
                          <button
                            key={list.id}
                            type="button"
                            disabled={
                              listToggleBusy === `${it.id}:${list.id}` ||
                              !isOnline
                            }
                            onClick={() =>
                              void toggleListMembership(it.id, list.id)
                            }
                            className="w-full flex items-center justify-between px-3 py-2 hover:bg-subtle disabled:opacity-50 text-left"
                          >
                            <span className="truncate">{list.name}</span>
                            {member && (
                              <Check className="h-4 w-4 text-brand-text shrink-0" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="overflow-hidden">
          {items.map((it) => {
            const emblem = repoEmblem(it.repository.name);
            const memberLists = memberships.get(it.id);
            return (
              <div
                key={it.id}
                className="grid grid-cols-[20px_minmax(0,1fr)_80px] sm:grid-cols-[20px_minmax(170px,1.6fr)_minmax(90px,0.6fr)_80px] items-center gap-3 min-h-[70px] px-4 py-3 border-b border-line last:border-b-0 hover:bg-canvas"
              >
                <input
                  type="checkbox"
                  aria-label={`选择 ${it.repository.name}`}
                  className="hidden sm:block"
                  onChange={() => undefined}
                />
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className={`hidden sm:grid place-items-center w-[31px] h-[31px] shrink-0 rounded-[9px] text-xs font-[650] ${emblem.toneCls}`}
                  >
                    {emblem.initials}
                  </span>
                  <div className="min-w-0">
                    <Link
                      to={`/repository/${it.repository.id}`}
                      className="text-[13px] font-[650] block truncate hover:text-brand-text"
                    >
                      {it.repository.name}
                    </Link>
                    <p className="text-[11px] text-muted truncate">
                      {it.repository.description ||
                        it.aiSummary ||
                        it.repository.namespacePath}
                    </p>
                  </div>
                </div>
                <span className="hidden sm:flex items-center gap-1.5 text-[11px] text-muted">
                  <span
                    className="w-[7px] h-[7px] rounded-full"
                    style={{
                      background:
                        LANG_DOTS[it.repository.primaryLanguage ?? ""] ??
                        "var(--c-muted)",
                    }}
                  />
                  {it.repository.primaryLanguage || "—"}
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] text-muted">
                  <Star className="h-3 w-3" />
                  {formatCount(it.repository.starsCount)}
                </span>
                <div className="flex items-center justify-end gap-1">
                  <ActivityBadge
                    owner={it.repository.namespacePath}
                    repo={it.repository.name}
                  />
                  <Button
                    variant="ghost"
                    size="xs"
                    aria-label="加入列表"
                    onClick={() =>
                      setListMenuFor((cur) => (cur === it.id ? null : it.id))
                    }
                  >
                    <Folder className="h-3.5 w-3.5" />
                    {memberLists?.size ?? 0}
                  </Button>
                </div>
              </div>
            );
          })}
        </Card>
      )}
      {listMenuFor && !items.some((i) => i.id === listMenuFor) && null}

      {/* Note dialog */}
      <Dialog
        open={noteFor !== null}
        onClose={() => setNoteFor(null)}
        title={noteFor ? `备注 · ${noteFor.repository.name}` : "备注"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setNoteFor(null)}>
              取消
            </Button>
            <Button
              onClick={async () => {
                if (!noteFor) return;
                const value =
                  (
                    document.getElementById(
                      "note-dialog-input",
                    ) as HTMLTextAreaElement | null
                  )?.value ?? "";
                const ok = await saveNote(noteFor, value);
                if (ok) setNoteFor(null);
              }}
            >
              保存
            </Button>
          </>
        }
      >
        {noteFor && (
          <>
            <p className="text-xs text-muted mb-4">
              备注属于个人数据，不会出现在公开分享中。离线时保存到本地，联网后自动同步。
            </p>
            <Textarea
              id="note-dialog-input"
              defaultValue={noteFor.note ?? ""}
              placeholder="记录这个仓库的用途、为什么收藏……"
            />
          </>
        )}
      </Dialog>
    </div>
  );
};
