// src/pages/Library.tsx
// Pixel-faithful port of the prototype `library()` markup (repo cards/rows,
// toolbar, tag strip, results line, bulk bar), driven by real data.

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
  Dialog,
  EmptyState,
  Input,
  Select,
  Textarea,
} from "../components/ui";
import { useToastStore } from "../store/useToastStore";

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

const CARD_TONES = ["sage", "lilac", "sand", "sky"] as const;
const TONE_CLS: Record<string, string> = {
  sage: "bg-brand-soft text-brand-text",
  lilac: "bg-ai-soft text-ai",
  sand: "bg-gold-soft text-gold",
  sky: "bg-info-soft text-info",
};

function repoEmblem(name: string) {
  const initials = name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2) || "??";
  const hash = Array.from(name).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const tone = CARD_TONES[hash % CARD_TONES.length];
  return { initials: initials.toLowerCase(), toneCls: TONE_CLS[tone] };
}

function FolderGlyphSmall() {
  return (
    <svg className="ico" style={{ width: 15, height: 15 }} viewBox="0 0 24 24">
      <path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </svg>
  );
}

function FileGlyph() {
  return (
    <svg className="ico" style={{ width: 15, height: 15 }} viewBox="0 0 24 24">
      <path d="M5 3h14a2 2 0 0 1 2 2v10l-6 6H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM15 21v-6h6M7 8h10M7 12h7" />
    </svg>
  );
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
  const [allItems, setAllItems] = useState<SavedRepository[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [filters, setFilters] = useState<LibraryFilters>(EMPTY_LIBRARY_FILTERS);
  // Honor the 默认浏览方式 preference saved in Settings (localStorage).
  const [view, setView] = useState<"grid" | "list">(() => {
    try {
      return localStorage.getItem("gitstars-default-view") === "list"
        ? "list"
        : "grid";
    } catch {
      return "grid";
    }
  });
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const isOnline = useSyncStatusStore((s) => s.isOnline);
  const isAiConfigured = useAiConfigStore((s) => s.isConfigured());
  const toggleSyncDrawer = useSyncDrawerStore((s) => s.toggle);
  const showToast = useToastStore((s) => s.showToast);
  const mountedRef = useRef(false);

  // List memberships
  const [lists, setLists] = useState<ListSummary[]>([]);
  const [memberships, setMemberships] = useState<Map<string, Set<string>>>(
    new Map(),
  );
  const [membershipFor, setMembershipFor] = useState<string[] | null>(null);
  const [membershipChecked, setMembershipChecked] = useState<Set<string>>(
    new Set(),
  );
  const [listToggleBusy, setListToggleBusy] = useState(false);

  // Batch AI
  const [batch, setBatch] = useState<BatchState | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
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

  const hydrateFromCache = useCallback(async () => {
    try {
      const cache = await readLibraryCache();
      setAllItems(cache.items);
      setItems(applyLibraryFilters(cache.items, filters));
      setTags(cache.tags);
    } catch {
      // server fetch path still applies
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
      setAllItems(lib);
      setItems(applyLibraryFilters(lib, filters));
      setTags(tg);
      setError("");
      setNotice("");
      try {
        await Promise.all([upsertLibraryPage(lib), upsertTags(tg)]);
      } catch {
        // best-effort
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

  const saveMembership = async () => {
    if (!membershipFor || listToggleBusy) return;
    setListToggleBusy(true);
    setError("");
    try {
      for (const list of lists) {
        const checked = membershipChecked.has(list.id);
        for (const savedId of membershipFor) {
          const member = memberships.get(savedId)?.has(list.id);
          if (checked === member) continue;
          await apiPut(
            `/api/lists/${list.id}/items`,
            member ? { remove: [savedId] } : { add: [savedId] },
          );
        }
      }
      await loadLists();
      showToast("列表归属已更新");
      setMembershipFor(null);
    } catch (e) {
      setError(
        e instanceof ApiError ? `${e.code}: ${e.message}` : "操作失败，请重试",
      );
    } finally {
      setListToggleBusy(false);
    }
  };

  // --- Batch AI summarize ---
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
      showToast("所有仓库都已有 AI 总结");
      return;
    }
    batchStopRef.current = false;
    setBatch({ mode, total: targets.length, done: 0, failed: 0, current: "" });
    setBatchOpen(false);
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
    showToast(
      batchStopRef.current
        ? `批量总结已暂停：完成 ${done}/${targets.length}`
        : `批量总结完成：${done - failed} 成功${failed ? `，${failed} 失败` : ""}`,
    );
    setTimeout(() => setBatch(null), 2000);
  };

  const stats = useMemo(() => computeLibraryStats(items), [items]);
  const aiTagOptions = useMemo(() => {
    const set = new Set<string>();
    for (const it of allItems) for (const t of it.aiTags) set.add(t);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [allItems]);
  const languages = useMemo(() => {
    const set = new Set<string>();
    for (const it of allItems)
      if (it.repository.primaryLanguage) set.add(it.repository.primaryLanguage);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [allItems]);
  const commonTags = aiTagOptions.slice(0, 5);

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
    if (!out.confirmed) showToast("备注已保存到本地，待同步");
    else showToast("备注已保存");
    await hydrateFromCache();
    return true;
  };

  const toggleSelect = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const offline = !isOnline;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">
            <h1>收藏库</h1>
            <Badge>{stats.total}</Badge>
          </div>
          <p>值得留住的代码，随时找到、整理和阅读。</p>
        </div>
        <div className="page-actions">
          <Button
            variant="ai"
            disabled={offline}
            onClick={() => setBatchOpen(true)}
          >
            <Sparkles className="ico" /> AI 摘要
          </Button>
          <Button
            variant="primary"
            disabled={offline}
            onClick={() => setDiscoverOpen(true)}
          >
            发现仓库
          </Button>
        </div>
      </div>

      {error && (
        <div className="notice error">
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
          <Button variant="ghost" size="sm" onClick={toggleSyncDrawer}>
            查看待同步项
          </Button>
        </div>
      )}

      {batch && (
        <div className="batch-progress" role="status">
          <div className="row between">
            <span className="row gap8">
              <Sparkles className="ico small" />
              {batch.current
                ? `正在生成摘要 · ${batch.current}`
                : "正在生成摘要"}{" "}
              · {batch.done}/{batch.total}
              {batch.failed ? ` · ${batch.failed} 失败` : ""}
            </span>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                batchStopRef.current = true;
              }}
            >
              暂停
            </Button>
          </div>
          <div
            className="progress"
            role="progressbar"
            aria-label="AI 摘要进度"
            aria-valuenow={batch.done}
            aria-valuemin={0}
            aria-valuemax={batch.total}
          >
            <span
              style={{
                width: `${batch.total ? (batch.done / batch.total) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Discover dialog */}
      <Dialog
        open={discoverOpen}
        onClose={() => setDiscoverOpen(false)}
        title="发现 GitHub 仓库"
        width="560px"
      >
        <p className="text-xs text-muted mb-4">
          这里搜索来源平台。收藏库顶部的搜索只检索已经保存的内容。
        </p>
        <div className="row">
          <Input
            placeholder="搜索关键词，如 backend"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void onSearch();
            }}
          />
          <Button variant="primary" onClick={() => void onSearch()}>
            搜索
          </Button>
        </div>
        <div className="mt-6">
          {results === null ? (
            <p className="muted small">先输入搜索词。</p>
          ) : results.length === 0 ? (
            <div className="compare-box">没有匹配的仓库。</div>
          ) : (
            <div className="stack">
              {results.map((r) => {
                const key = resultKey(r);
                const saved = savedKeys.has(key);
                const repositoryId = saveable.get(key);
                const emblem = repoEmblem(r.name);
                return (
                  <div key={key} className="dialog-item">
                    <span
                      className={`repo-emblem ${emblem.toneCls}`}
                      style={{ width: 29, fontSize: 11 }}
                    >
                      {emblem.initials}
                    </span>
                    <div className="grow">
                      <h3>
                        {r.namespacePath ? `${r.namespacePath}/` : ""}
                        {r.name}
                      </h3>
                      <p>{r.description}</p>
                    </div>
                    {saved ? (
                      <Badge tone="success">已收藏</Badge>
                    ) : (
                      <Button
                        size="sm"
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
                        onClick={() => void onSaveResult(r)}
                      >
                        收藏
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Dialog>

      {/* Membership dialog */}
      <Dialog
        open={membershipFor !== null}
        onClose={() => setMembershipFor(null)}
        title={
          membershipFor && membershipFor.length > 1
            ? `把 ${membershipFor.length} 个仓库加入列表`
            : "加入列表"
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setMembershipFor(null)}>
              取消
            </Button>
            <Button
              onClick={() => void saveMembership()}
              disabled={listToggleBusy}
            >
              保存
            </Button>
          </>
        }
      >
        <p className="text-xs text-muted mb-4">
          一个仓库可以属于多个列表。这里的快捷加入操作需要联网。
        </p>
        <div className="check-list">
          {lists.map((l) => {
            const allIn =
              membershipFor?.length &&
              membershipFor.every((id) => memberships.get(id)?.has(l.id));
            const checked = membershipChecked.has(l.id) ?? !!allIn;
            return (
              <label key={l.id}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    setMembershipChecked((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(l.id);
                      else next.delete(l.id);
                      return next;
                    });
                  }}
                />
                <span>{l.name}</span>
                <span className="muted tiny number">{l.itemCount}</span>
              </label>
            );
          })}
          {lists.length === 0 && (
            <p className="muted small">
              还没有列表，先到「我的列表」创建一个。
            </p>
          )}
        </div>
      </Dialog>

      {/* Note dialog */}
      <Dialog
        open={noteFor !== null}
        onClose={() => setNoteFor(null)}
        title={noteFor ? `个人备注 · ${noteFor.repository.name}` : "个人备注"}
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
              保存备注
            </Button>
          </>
        }
      >
        {noteFor && (
          <>
            <p className="text-xs text-muted mb-4">
              {noteFor.repository.namespacePath
                ? `${noteFor.repository.namespacePath}/`
                : ""}
              {noteFor.repository.name} · 只有自己可见
            </p>
            <Textarea
              id="note-dialog-input"
              defaultValue={noteFor.note ?? ""}
              placeholder="记录你的使用场景、待验证问题…"
            />
          </>
        )}
      </Dialog>

      {/* Batch AI dialog */}
      <Dialog
        open={batchOpen}
        onClose={() => setBatchOpen(false)}
        title="批量生成 AI 摘要"
      >
        <div className="stack">
          <Button
            variant="ai"
            onClick={() => void startBatchSummarize("missing")}
          >
            补充缺失摘要 · {items.filter((i) => !i.aiSummary).length} 项
          </Button>
          <Button onClick={() => void startBatchSummarize("all")}>
            重新生成全部 · {items.length} 项
          </Button>
          <p className="tiny mt8">
            范围为当前筛选结果。重新生成会覆盖现有摘要与 AI 标签。
          </p>
        </div>
      </Dialog>

      {/* Toolbar */}
      <div className="toolbar">
        <div className="search-field">
          <Search className="ico" />
          <Input
            placeholder="搜索名称、描述、摘要与备注"
            aria-label="搜索收藏库"
            value={filters.search}
            onChange={(e) => setFilter({ search: e.target.value })}
          />
          <kbd>/</kbd>
        </div>
        <div className="segmented" role="group" aria-label="收藏类型">
          {[
            ["", "全部"],
            ["star", "Star"],
            ["fork", "Fork"],
          ].map(([v, l]) => (
            <button
              key={v}
              type="button"
              className={filters.kind === v ? "active" : ""}
              aria-pressed={filters.kind === v}
              onClick={() => setFilter({ kind: v })}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="filter-wrap">
          <Button
            onClick={() => setFilterOpen((v) => !v)}
            aria-expanded={filterOpen}
            aria-controls="filter-panel"
          >
            筛选{filterCount ? ` · ${filterCount}` : ""}
          </Button>
          {filterOpen && (
            <div
              className="filter-pop"
              id="filter-panel"
              aria-label="筛选收藏库"
            >
              <div className="row between">
                <h3>筛选收藏库</h3>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="关闭筛选"
                  onClick={() => setFilterOpen(false)}
                >
                  <X className="ico small" />
                </Button>
              </div>
              <label className="field-label">
                来源平台
                <Select
                  value={filters.provider}
                  onChange={(e) => setFilter({ provider: e.target.value })}
                >
                  <option value="">全部平台</option>
                  <option value="github">GitHub</option>
                </Select>
              </label>
              <label className="field-label">
                语言
                <Select
                  value={filters.language}
                  onChange={(e) => setFilter({ language: e.target.value })}
                >
                  <option value="">全部语言</option>
                  {languages.map((lang) => (
                    <option key={lang} value={lang}>
                      {lang}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="field-label">
                手动标签
                <Select
                  value={filters.tag}
                  onChange={(e) => setFilter({ tag: e.target.value })}
                >
                  <option value="">全部手动标签</option>
                  {tags.map((t) => (
                    <option key={t.id} value={t.name}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </label>
              <div className="small muted mt16 mb16">
                AI 标签 · 需包含全部选中标签
              </div>
              <div className="row wrap" style={{ gap: 6 }}>
                {aiTagOptions.map((tag) => {
                  const on = filters.aiTags.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      className={`chip ${on ? "active" : ""}`}
                      aria-pressed={on}
                      onClick={() =>
                        setFilter({
                          aiTags: on
                            ? filters.aiTags.filter((t) => t !== tag)
                            : [...filters.aiTags, tag],
                        })
                      }
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
              <div className="row between mt24">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setFilters({ ...EMPTY_LIBRARY_FILTERS, sort: filters.sort })
                  }
                >
                  清除条件
                </Button>
                <Button size="sm" onClick={() => setFilterOpen(false)}>
                  完成
                </Button>
              </div>
            </div>
          )}
        </div>
        <Select
          aria-label="收藏排序"
          value={filters.sort}
          onChange={(e) =>
            setFilter({ sort: e.target.value as LibraryFilters["sort"] })
          }
        >
          <option value="added_at">最近收藏</option>
          <option value="stars">Stars 最多</option>
          <option value="name">名称 A—Z</option>
        </Select>
        <div className="view-options" role="group" aria-label="显示方式">
          {(
            [
              { v: "grid", label: "卡片视图", grid: true },
              { v: "list", label: "紧凑列表", grid: false },
            ] as const
          ).map(({ v, label, grid }) => (
            <button
              key={v}
              type="button"
              aria-label={label}
              aria-pressed={view === v}
              className={view === v ? "active" : ""}
              onClick={() => setView(v)}
            >
              {grid ? (
                <svg className="ico" viewBox="0 0 24 24">
                  <rect x="3" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" />
                  <rect x="14" y="14" width="7" height="7" rx="1" />
                </svg>
              ) : (
                <svg className="ico" viewBox="0 0 24 24">
                  <path d="M8 6h13M8 12h13M8 18h13M3 6h.1M3 12h.1M3 18h.1" />
                </svg>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tag strip */}
      {aiTagOptions.length > 0 && (
        <div className="tag-strip">
          <span className="muted" style={{ marginRight: 3 }}>
            常用标签
          </span>
          {commonTags.map((t) => (
            <button
              key={t}
              type="button"
              className={`chip ${filters.aiTags.includes(t) ? "active" : ""}`}
              aria-pressed={filters.aiTags.includes(t)}
              onClick={() =>
                setFilter({
                  aiTags: filters.aiTags.includes(t)
                    ? filters.aiTags.filter((x) => x !== t)
                    : [...filters.aiTags, t],
                })
              }
            >
              {t}
            </button>
          ))}
          <Button variant="ghost" size="sm" onClick={() => setFilterOpen(true)}>
            全部标签
          </Button>
          {(filterCount > 0 || filters.search || filters.kind) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setFilters({ ...EMPTY_LIBRARY_FILTERS, sort: filters.sort })
              }
            >
              <X className="ico small" /> 清除筛选
            </Button>
          )}
        </div>
      )}

      {loading ? null : items.length === 0 ? (
        filters.search || filterCount > 0 ? (
          <EmptyState
            icon={<Search />}
            title="没有匹配的仓库"
            description="换个关键词，或清除语言与标签筛选。"
            action={
              <Button
                onClick={() =>
                  setFilters({ ...EMPTY_LIBRARY_FILTERS, sort: filters.sort })
                }
              >
                清除筛选
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<Bookmark />}
            title="收藏库从这里开始"
            description="同步你的 GitHub Stars 与 Forks，给值得留住的仓库加上标签、备注与清单。"
            action={
              <Button onClick={() => void syncNow()} disabled={busy}>
                <RefreshCw className={`ico ${busy ? "animate-spin" : ""}`} />
                同步 GitHub
              </Button>
            }
            secondary={
              <Link to="/hub" className="btn">
                浏览公开列表
              </Link>
            }
          />
        )
      ) : (
        <>
          <div className="results-line">
            <span>
              {items.length} 个仓库
              {items.length !== stats.total ? ` / 共 ${stats.total} 个` : ""}
              <span style={{ margin: "0 9px" }}>·</span>
              {lists.length} 个列表
            </span>
            <span>
              ★ {formatCount(stats.stars)} · {formatCount(stats.forks)} forks
            </span>
          </div>
          {view === "grid" ? (
            <div className="repo-grid">
              {items.map((it) => {
                const emblem = repoEmblem(it.repository.name);
                const memberLists = memberships.get(it.id);
                return (
                  <article
                    key={it.id}
                    className={`repo-card ${selected.has(it.id) ? "selected" : ""}`}
                  >
                    <label
                      className="repo-select"
                      title={`选择 ${it.repository.name}`}
                    >
                      <input
                        type="checkbox"
                        aria-label={`选择 ${it.repository.name}`}
                        checked={selected.has(it.id)}
                        onChange={(e) => toggleSelect(it.id, e.target.checked)}
                      />
                    </label>
                    <div className="repo-card-head">
                      <span className={`repo-emblem ${emblem.toneCls}`}>
                        {emblem.initials}
                      </span>
                      <div className="repo-name-wrap">
                        <Link
                          className="repo-title"
                          to={`/repository/${it.repository.id}`}
                        >
                          {it.repository.name}
                        </Link>
                        <div className="owner">
                          {it.repository.namespacePath}
                          {it.repository.visibility === "private" && (
                            <span className="text-gold">· 私有</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <p className="repo-desc">
                      {it.repository.description || it.aiSummary || ""}
                    </p>
                    <div className="repo-tags">
                      {it.aiTags.slice(0, 2).map((t) => (
                        <Badge key={`ai-${t}`} tone="ai">
                          <Sparkles
                            className="ico"
                            style={{ width: 10, height: 10 }}
                          />
                          {t}
                        </Badge>
                      ))}
                      {it.tags.slice(0, 1).map((t) => (
                        <Badge key={t.id} tone="success">
                          {t.name}
                        </Badge>
                      ))}
                    </div>
                    <div className="repo-meta">
                      <span className="row gap8">
                        <span
                          className="lang-dot"
                          style={{
                            background:
                              LANG_DOTS[it.repository.primaryLanguage ?? ""] ??
                              "var(--muted)",
                          }}
                        />
                        {it.repository.primaryLanguage || "—"}
                      </span>
                      <span className="row gap8 number">
                        <Star className="ico small" />
                        {formatCount(it.repository.starsCount)}
                      </span>
                      <span style={{ marginLeft: "auto", fontSize: 10 }}>
                        <ActivityBadge
                          owner={it.repository.namespacePath}
                          repo={it.repository.name}
                        />
                      </span>
                    </div>
                    <div className="repo-bottom">
                      <Button
                        variant="ghost"
                        size="xs"
                        disabled={offline}
                        title={
                          memberLists && memberLists.size > 0
                            ? `已在 ${memberLists.size} 个列表，点击管理`
                            : offline
                              ? "此操作需要联网"
                              : "加入列表"
                        }
                        onClick={() => {
                          setMembershipChecked(new Set());
                          setMembershipFor([it.id]);
                        }}
                      >
                        <FolderGlyphSmall />
                        {memberLists && memberLists.size > 0
                          ? `已在 ${memberLists.size} 个列表`
                          : "加入列表"}
                      </Button>
                      <div className="row" style={{ gap: 2 }}>
                        <Button
                          variant="ghost"
                          size="xs"
                          aria-label={it.note ? "编辑个人备注" : "添加个人备注"}
                          title={it.note ? "编辑个人备注" : "添加个人备注"}
                          onClick={() => setNoteFor(it)}
                        >
                          <FileGlyph />
                        </Button>
                        <Button
                          variant="ghost"
                          size="xs"
                          aria-label="移出收藏库"
                          title="移出收藏库"
                          onClick={() => {
                            if (!window.confirm("确定将该仓库从收藏移除？"))
                              return;
                            runMutation(() =>
                              unsaveRepository({
                                id: it.id,
                                version: it.version,
                              }),
                            );
                          }}
                        >
                          <X
                            className="ico"
                            style={{ width: 15, height: 15 }}
                          />
                        </Button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="repo-table">
              {items.map((it) => {
                const emblem = repoEmblem(it.repository.name);
                const memberLists = memberships.get(it.id);
                return (
                  <div key={it.id} className="repo-row">
                    <input
                      type="checkbox"
                      aria-label={`选择 ${it.repository.name}`}
                      checked={selected.has(it.id)}
                      onChange={(e) => toggleSelect(it.id, e.target.checked)}
                    />
                    <div className="row grow">
                      <span className={`repo-emblem ${emblem.toneCls}`}>
                        {emblem.initials}
                      </span>
                      <div className="grow">
                        <Link
                          className="repo-title"
                          to={`/repository/${it.repository.id}`}
                        >
                          {it.repository.namespacePath
                            ? `${it.repository.namespacePath}/`
                            : ""}
                          {it.repository.name}
                        </Link>
                        <p className="repo-desc">
                          {it.repository.description || it.aiSummary || ""}
                        </p>
                      </div>
                    </div>
                    <div className="repo-tags tag-cell">
                      {it.aiTags.slice(0, 2).map((t) => (
                        <Badge key={`ai-${t}`} tone="ai">
                          {t}
                        </Badge>
                      ))}
                    </div>
                    <span className="meta-cell number">
                      <Star
                        className="ico small"
                        style={{ display: "inline" }}
                      />{" "}
                      {formatCount(it.repository.starsCount)}
                    </span>
                    <span className="meta-cell">
                      {it.repository.primaryLanguage || "—"}
                    </span>
                    <div className="row gap8">
                      <ActivityBadge
                        owner={it.repository.namespacePath}
                        repo={it.repository.name}
                      />
                      <Button
                        variant="ghost"
                        size="xs"
                        aria-label="加入列表"
                        disabled={offline}
                        onClick={() => {
                          setMembershipChecked(new Set());
                          setMembershipFor([it.id]);
                        }}
                      >
                        <FolderGlyphSmall />
                        {memberLists?.size ?? 0}
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        aria-label="编辑备注"
                        onClick={() => setNoteFor(it)}
                      >
                        <FileGlyph />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {selected.size > 0 && (
        <div className="bulkbar" role="region" aria-label="批量操作">
          <span className="number">已选 {selected.size} 项</span>
          <Button
            variant="ghost"
            size="sm"
            disabled={offline}
            onClick={() => {
              setMembershipChecked(new Set());
              setMembershipFor(Array.from(selected));
            }}
          >
            加入列表
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelected(new Set())}
          >
            <X className="ico small" /> 取消选择
          </Button>
        </div>
      )}

      <div className="footer-note">
        <span>GitStars · 让收藏成为可用的知识</span>
      </div>
    </div>
  );
};
