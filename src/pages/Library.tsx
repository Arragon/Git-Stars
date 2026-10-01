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
  ExternalLink,
  ListChecks,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import {
  createTag,
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
  attachTagToSaved,
  detachTagFromSaved,
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
import { ActivityBadge } from "../components/ActivityBadge";

const resultKey = (r: SearchItemView): string =>
  `${r.identity.providerType}:${r.identity.remoteId}`;

const NoteEditor: React.FC<{
  initial?: string;
  onSave: (note: string) => void;
}> = ({ initial, onSave }) => {
  const [value, setValue] = useState(initial ?? "");
  useEffect(() => setValue(initial ?? ""), [initial]);
  return (
    <input
      className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded px-2 py-1 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
      placeholder="备注..."
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => value !== (initial ?? "") && onSave(value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
};

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
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchItemView[] | null>(null);
  const [saveable, setSaveable] = useState<Map<string, string>>(new Map());
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const isOnline = useSyncStatusStore((s) => s.isOnline);
  const isAiConfigured = useAiConfigStore((s) => s.isConfigured());
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
      // Keep the local cache coherent (stale-while-revalidate write-back).
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

  // Stale-while-revalidate: paint the cached view immediately on first mount.
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    void hydrateFromCache();
  }, [hydrateFromCache]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Lists + membership map (for the per-card quick add/remove).
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
      // best-effort: the quick-list UI hides when lists fail to load
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

  /** Run an offline-capable mutation: reload after confirm, hydrate otherwise. */
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
      // Resolve which results can be saved: the library API needs a local
      // repository id, which only synced repositories have.
      const map = new Map<string, string>();
      for (const item of r.items) {
        try {
          const cached = await matchCachedRepository(
            item.identity.providerType,
            item.identity.remoteId,
          );
          if (cached) map.set(resultKey(item), cached.id);
        } catch {
          /* cache unavailable — nothing saveable */
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

  // --- Quick list membership toggle (network-only: membership map is
  // server-derived; offline queuing would desync the read model) ---
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
    // Persist final AI state into the local cache (best-effort).
    try {
      await upsertLibraryPage(itemsRef.current);
    } catch {
      // cache write is best-effort
    }
    if (batchStopRef.current) {
      setNotice(
        `批量总结已暂停：完成 ${done}/${targets.length}` +
          (failed ? `，失败 ${failed}` : ""),
      );
    } else {
      setNotice(
        `批量总结完成：${done - failed} 成功` +
          (failed ? `，${failed} 失败` : ""),
      );
    }
    setTimeout(() => setBatch(null), 2500);
  };

  const languages = useMemo(() => collectLanguages(items), [items]);
  const aiTagOptions = useMemo(() => collectAiTags(items), [items]);
  const stats = useMemo(() => computeLibraryStats(items), [items]);
  const activeFilterCount =
    (filters.search ? 1 : 0) +
    (filters.kind ? 1 : 0) +
    (filters.language ? 1 : 0) +
    (filters.tag ? 1 : 0) +
    filters.aiTags.length;

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-5 text-gray-900 dark:text-gray-100">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Library</h1>
        <div className="flex items-center gap-2">
          {batch ? (
            <button
              type="button"
              onClick={() => {
                batchStopRef.current = true;
              }}
              className="inline-flex items-center gap-2 bg-red-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-red-700"
            >
              暂停批量总结（{batch.done}/{batch.total}）
            </button>
          ) : (
            <details className="relative">
              <summary className="inline-flex items-center gap-2 bg-purple-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-purple-700 cursor-pointer list-none">
                <Sparkles className="h-4 w-4" /> AI 批量总结
              </summary>
              <div className="absolute right-0 z-20 mt-1 w-56 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg py-1 text-sm">
                <button
                  type="button"
                  onClick={() =>
                    void startBatchSummarize("missing").then(() => {
                      const el = document.activeElement as HTMLElement | null;
                      el?.blur();
                    })
                  }
                  className="block w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  补充缺失总结
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void startBatchSummarize("all").then(() => {
                      const el = document.activeElement as HTMLElement | null;
                      el?.blur();
                    })
                  }
                  className="block w-full text-left px-3 py-2 text-red-600 dark:text-red-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  全部重新生成…
                </button>
              </div>
            </details>
          )}
          <button
            onClick={() => void syncNow()}
            disabled={busy}
            className="inline-flex items-center gap-2 bg-gray-900 dark:bg-gray-100 dark:text-gray-900 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-700 dark:hover:bg-gray-300 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />{" "}
            Sync GitHub
          </button>
        </div>
      </div>

      {batch && (
        <div className="bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-900 rounded px-3 py-2">
          <div className="flex items-center justify-between text-xs text-purple-900 dark:text-purple-200 mb-1">
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
          <div className="h-1.5 bg-purple-200 dark:bg-purple-900 rounded overflow-hidden">
            <div
              className="h-full bg-purple-600 transition-all"
              style={{
                width: `${batch.total ? (batch.done / batch.total) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      )}

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

      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-3">
        <div className="flex gap-2">
          <input
            className="flex-1 text-sm border border-gray-200 dark:border-gray-700 rounded px-3 py-2 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 placeholder-gray-400"
            placeholder="Discover repositories on GitHub..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void onSearch();
            }}
          />
          <button
            onClick={() => void onSearch()}
            className="inline-flex items-center gap-1 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 px-3 py-2 rounded text-sm"
          >
            <Search className="h-4 w-4" /> Search
          </button>
        </div>
        {results && (
          <ul className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
            {results.map((r) => {
              const key = resultKey(r);
              const saved = savedKeys.has(key);
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
                    <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {r.description}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {saved ? (
                      <span className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/50 border border-green-200 dark:border-green-900 rounded px-2 py-1">
                        <Check className="h-3 w-3" /> 已收藏
                      </span>
                    ) : (
                      <button
                        onClick={() => void onSaveResult(r)}
                        disabled={
                          !saveable.get(key) || !isOnline || savingKey === key
                        }
                        title={
                          !isOnline
                            ? "离线状态暂不支持收藏"
                            : !saveable.get(key)
                              ? "该仓库尚未同步到本地目录，暂不能收藏"
                              : "收藏到我的库"
                        }
                        className="inline-flex items-center gap-1 text-xs bg-gray-900 dark:bg-gray-100 dark:text-gray-900 text-white px-2 py-1 rounded disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Bookmark className="h-3 w-3" /> 收藏
                      </button>
                    )}
                    <a
                      href={r.webUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" /> Open
                    </a>
                  </div>
                </li>
              );
            })}
            {results.length === 0 && (
              <li className="py-2 text-sm text-gray-500 dark:text-gray-400">
                No results.
              </li>
            )}
          </ul>
        )}
      </div>

      {/* In-library filter bar */}
      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-3 space-y-3">
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[14rem]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded pl-8 pr-3 py-2 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 placeholder-gray-400"
              placeholder="在收藏库中搜索（名称 / 描述 / AI 摘要 / 备注）..."
              value={filters.search}
              onChange={(e) => setFilter({ search: e.target.value })}
            />
          </div>
          <div className="flex rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden text-sm">
            {[
              { value: "", label: "全部" },
              { value: "star", label: "Star" },
              { value: "fork", label: "Fork" },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => setFilter({ kind: opt.value })}
                className={`px-3 py-2 transition-colors ${
                  filters.kind === opt.value
                    ? "bg-gray-900 dark:bg-gray-100 dark:text-gray-900 text-white"
                    : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <select
            value={filters.provider}
            onChange={(e) => setFilter({ provider: e.target.value })}
            className="border border-gray-200 dark:border-gray-700 rounded px-2 py-2 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 text-sm"
          >
            <option value="">All providers</option>
            <option value="github">GitHub</option>
            <option value="gitlab">GitLab</option>
            <option value="gitee">Gitee</option>
          </select>
          <select
            value={filters.language}
            onChange={(e) => setFilter({ language: e.target.value })}
            className="border border-gray-200 dark:border-gray-700 rounded px-2 py-2 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 text-sm"
          >
            <option value="">All languages</option>
            {languages.map((lang) => (
              <option key={lang} value={lang}>
                {lang}
              </option>
            ))}
          </select>
          <select
            value={filters.tag}
            onChange={(e) => setFilter({ tag: e.target.value })}
            className="border border-gray-200 dark:border-gray-700 rounded px-2 py-2 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 text-sm"
          >
            <option value="">All tags</option>
            {tags.map((t) => (
              <option key={t.id} value={t.name}>
                {t.name}
              </option>
            ))}
          </select>
          <select
            value={filters.sort}
            onChange={(e) =>
              setFilter({ sort: e.target.value as LibraryFilters["sort"] })
            }
            className="border border-gray-200 dark:border-gray-700 rounded px-2 py-2 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 text-sm"
          >
            <option value="added_at">Sort: Recently added</option>
            <option value="stars">Sort: Stars</option>
            <option value="name">Sort: Name</option>
          </select>
        </div>

        {aiTagOptions.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-gray-500 dark:text-gray-400 inline-flex items-center gap-1">
              <Sparkles className="h-3 w-3" /> AI 标签：
            </span>
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
                  className={`inline-flex items-center px-2 py-0.5 rounded text-xs border transition-colors ${
                    selected
                      ? "bg-purple-600 border-purple-600 text-white"
                      : "bg-purple-50 dark:bg-purple-950/40 border-purple-200 dark:border-purple-900 text-purple-800 dark:text-purple-200 hover:border-purple-400"
                  }`}
                >
                  {tag}
                </button>
              );
            })}
            {activeFilterCount > 0 && (
              <button
                onClick={() =>
                  setFilters({ ...EMPTY_LIBRARY_FILTERS, sort: filters.sort })
                }
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
              >
                清除筛选（{activeFilterCount}）
              </button>
            )}
          </div>
        )}

        <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
          <span title="收藏仓库数">
            <strong className="text-gray-900 dark:text-gray-100">
              {stats.total}
            </strong>{" "}
            repos
          </span>
          <span title="Stars 总和">
            <Star className="h-3 w-3 inline mr-0.5 -mt-0.5" />
            <strong className="text-gray-900 dark:text-gray-100">
              {formatCount(stats.stars)}
            </strong>
          </span>
          <span title="Forks 总和">
            <strong className="text-gray-900 dark:text-gray-100">
              {formatCount(stats.forks)}
            </strong>{" "}
            forks
          </span>
          {lists.length > 0 && (
            <span className="ml-auto inline-flex items-center gap-1">
              <ListChecks className="h-3 w-3" /> {lists.length} 个列表
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 items-start">
        {items.map((it) => {
          const memberLists = memberships.get(it.id);
          return (
            <div
              key={it.id}
              className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-3 flex flex-col gap-2 hover:border-gray-300 dark:hover:border-gray-700 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link
                    to={`/repository/${it.repository.id}`}
                    className="text-sm font-semibold hover:underline block truncate"
                    title={`${it.repository.namespacePath ? `${it.repository.namespacePath}/` : ""}${it.repository.name}`}
                  >
                    {it.repository.namespacePath
                      ? `${it.repository.namespacePath}/`
                      : ""}
                    {it.repository.name}
                  </Link>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 flex items-center gap-2 flex-wrap">
                    <span className="uppercase">
                      {it.repository.providerType}
                    </span>
                    <span className="inline-flex items-center gap-0.5">
                      <Star className="h-3 w-3" />
                      {it.repository.starsCount}
                    </span>
                    {it.repository.primaryLanguage && (
                      <span className="truncate">
                        {it.repository.primaryLanguage}
                      </span>
                    )}
                    <ActivityBadge
                      owner={it.repository.namespacePath}
                      repo={it.repository.name}
                    />
                    {it.repository.visibility === "private" && (
                      <span className="text-amber-600 dark:text-amber-400">
                        private
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (!window.confirm("确定将该仓库从收藏移除？")) return;
                    runMutation(() =>
                      unsaveRepository({ id: it.id, version: it.version }),
                    );
                  }}
                  disabled={busy}
                  className="text-gray-400 hover:text-red-600 dark:hover:text-red-400 shrink-0 disabled:opacity-50"
                  title="Remove from library"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {it.repository.description && (
                <p className="text-xs text-gray-600 dark:text-gray-300 line-clamp-2">
                  {it.repository.description}
                </p>
              )}

              {it.aiSummary && (
                <div className="text-xs bg-purple-50 dark:bg-purple-950/40 border border-purple-100 dark:border-purple-900 rounded px-2 py-1.5 text-purple-900 dark:text-purple-200 line-clamp-3">
                  <Sparkles className="h-3 w-3 inline mr-1 -mt-0.5" />
                  {it.aiSummary}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-1.5">
                {it.aiTags.map((name) => (
                  <span
                    key={`ai-${name}`}
                    title="AI 标签（重新生成时更新）"
                    className="inline-flex items-center gap-0.5 bg-purple-100 dark:bg-purple-900/60 text-purple-800 dark:text-purple-200 text-xs rounded px-1.5 py-0.5"
                  >
                    <Sparkles className="h-3 w-3" />
                    {name}
                  </span>
                ))}
                {it.tags.map((t) => (
                  <span
                    key={t.id}
                    className="inline-flex items-center gap-1 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-xs rounded px-2 py-0.5"
                  >
                    {t.name}
                    <button
                      onClick={() =>
                        runMutation(() => detachTagFromSaved(it.id, t.id))
                      }
                      disabled={busy}
                      className="text-gray-400 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                <input
                  className="text-xs border border-dashed border-gray-300 dark:border-gray-600 rounded px-2 py-0.5 w-24 bg-transparent text-gray-800 dark:text-gray-100 placeholder-gray-400"
                  placeholder="+ tag"
                  disabled={busy}
                  onKeyDown={async (e) => {
                    if (e.key !== "Enter") return;
                    const name = (e.target as HTMLInputElement).value.trim();
                    if (!name) return;
                    (e.target as HTMLInputElement).value = "";
                    const existing = tags.find((t) => t.name === name);
                    if (!existing && !isOnline) {
                      setError("离线状态暂不支持新建标签，请联网后重试");
                      return;
                    }
                    setBusy(true);
                    try {
                      const tag = existing ?? (await createTag(name));
                      await mutate(() => attachTagToSaved(it.id, tag.id));
                    } catch (err) {
                      setError(
                        err instanceof ApiError
                          ? `${err.code}: ${err.message}`
                          : "操作失败，请重试",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
              </div>

              {lists.length > 0 && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() =>
                      setListMenuFor((cur) => (cur === it.id ? null : it.id))
                    }
                    className="inline-flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded px-2 py-1 hover:bg-gray-50 dark:hover:bg-gray-800"
                    title="加入 / 移出列表"
                  >
                    <ListChecks className="h-3.5 w-3.5" />
                    Lists
                    {memberLists && memberLists.size > 0 && (
                      <span className="bg-blue-600 text-white rounded-full text-[10px] px-1.5 leading-4">
                        {memberLists.size}
                      </span>
                    )}
                  </button>
                  {listMenuFor === it.id && (
                    <>
                      <div
                        className="fixed inset-0 z-10"
                        onClick={() => setListMenuFor(null)}
                      />
                      <div className="absolute left-0 top-full z-20 mt-1 w-56 max-h-64 overflow-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg py-1 text-sm">
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
                              className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 text-left"
                            >
                              <span className="truncate">{list.name}</span>
                              {member && (
                                <Check className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}

              <div className="mt-auto">
                <NoteEditor
                  initial={it.note}
                  onSave={(note) =>
                    runMutation(() =>
                      updateSavedFields(
                        { id: it.id, version: it.version },
                        { note },
                      ),
                    )
                  }
                />
              </div>
            </div>
          );
        })}
        {items.length === 0 && !loading && (
          <div className="md:col-span-2 xl:col-span-3 text-center py-12 bg-white dark:bg-gray-900 rounded-lg border border-dashed border-gray-300 dark:border-gray-700">
            <Star className="h-10 w-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-gray-600 dark:text-gray-300 text-sm mb-1">
              {activeFilterCount > 0
                ? "没有符合筛选条件的仓库"
                : "收藏库还是空的"}
            </p>
            <p className="text-gray-400 dark:text-gray-500 text-xs mb-4">
              {activeFilterCount > 0
                ? "试试清除筛选条件"
                : "同步你的 GitHub Stars 和 Forks，构建可离线使用的收藏库。"}
            </p>
            {activeFilterCount === 0 && (
              <button
                onClick={() => void syncNow()}
                disabled={busy}
                className="inline-flex items-center gap-2 bg-gray-900 dark:bg-gray-100 dark:text-gray-900 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-700 dark:hover:bg-gray-300 disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-4 w-4 ${busy ? "animate-spin" : ""}`}
                />
                同步 GitHub Stars
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
