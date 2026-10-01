import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bookmark,
  Check,
  ExternalLink,
  RefreshCw,
  Search,
  Star,
  X,
} from "lucide-react";
import {
  createTag,
  listLibrary,
  listTags,
  searchRepositories,
  syncProvider,
  type SavedRepository,
  type SearchItemView,
  type Tag,
} from "../utils/gitstarsApi";
import { ApiError } from "../utils/api";
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
import { useSyncStatusStore } from "../store/useSyncStatusStore";

const resultKey = (r: SearchItemView): string =>
  `${r.identity.providerType}:${r.identity.remoteId}`;

/** Client-side filter/sort over the cached library view (offline fallback). */
function applyLocalFilters(
  items: SavedRepository[],
  provider: string,
  tagFilter: string,
  sort: string,
): SavedRepository[] {
  let out = items;
  if (provider) out = out.filter((i) => i.repository.providerType === provider);
  if (tagFilter)
    out = out.filter((i) => i.tags.some((t) => t.name === tagFilter));
  const sorted = [...out];
  if (sort === "stars") {
    sorted.sort((a, b) => b.repository.starsCount - a.repository.starsCount);
  } else if (sort === "name") {
    sorted.sort((a, b) => a.repository.name.localeCompare(b.repository.name));
  } else {
    sorted.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  }
  return sorted;
}

const NoteEditor: React.FC<{
  initial?: string;
  onSave: (note: string) => void;
}> = ({ initial, onSave }) => {
  const [value, setValue] = useState(initial ?? "");
  useEffect(() => setValue(initial ?? ""), [initial]);
  return (
    <input
      className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded px-2 py-1 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
      placeholder="Add a note..."
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => value !== (initial ?? "") && onSave(value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
};

export const Library: React.FC = () => {
  const [items, setItems] = useState<SavedRepository[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [provider, setProvider] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [sort, setSort] = useState("added_at");
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
  const mountedRef = useRef(false);

  /** Reflect the local cache into the view (optimistic/offline state). */
  const hydrateFromCache = useCallback(async () => {
    try {
      const cache = await readLibraryCache();
      setItems(applyLocalFilters(cache.items, provider, tagFilter, sort));
      setTags(cache.tags);
    } catch {
      // cache unavailable — the server fetch path still applies
    }
  }, [provider, tagFilter, sort]);

  const reload = useCallback(async () => {
    try {
      const [lib, tg] = await Promise.all([
        listLibrary({ provider, tag: tagFilter, sort, order: "desc" }),
        listTags(),
      ]);
      setItems(lib);
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
  }, [provider, tagFilter, sort, hydrateFromCache]);

  // Stale-while-revalidate: paint the cached view immediately on first mount.
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    void hydrateFromCache();
  }, [hydrateFromCache]);

  useEffect(() => {
    void reload();
  }, [reload]);

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

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6 text-gray-900 dark:text-gray-100">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Library</h1>
        <button
          onClick={() => void syncNow()}
          disabled={busy}
          className="inline-flex items-center gap-2 bg-gray-900 dark:bg-gray-100 dark:text-gray-900 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-700 dark:hover:bg-gray-300 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} /> Sync
          GitHub
        </button>
      </div>

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

      <div className="flex flex-wrap gap-2 text-sm">
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          className="border border-gray-200 dark:border-gray-700 rounded px-2 py-1 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100"
        >
          <option value="">All providers</option>
          <option value="github">GitHub</option>
          <option value="gitlab">GitLab</option>
          <option value="gitee">Gitee</option>
        </select>
        <select
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          className="border border-gray-200 dark:border-gray-700 rounded px-2 py-1 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100"
        >
          <option value="">All tags</option>
          {tags.map((t) => (
            <option key={t.id} value={t.name}>
              {t.name}
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="border border-gray-200 dark:border-gray-700 rounded px-2 py-1 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100"
        >
          <option value="added_at">Sort: Recently added</option>
          <option value="stars">Sort: Stars</option>
          <option value="name">Sort: Name</option>
        </select>
        <span className="ml-auto text-gray-500 dark:text-gray-400 self-center">
          {items.length} saved
        </span>
      </div>

      <div className="space-y-3">
        {items.map((it) => (
          <div
            key={it.id}
            className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link
                  to={`/repository/${it.repository.id}`}
                  className="text-base font-semibold hover:underline"
                >
                  {it.repository.namespacePath
                    ? `${it.repository.namespacePath}/`
                    : ""}
                  {it.repository.name}
                </Link>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 flex items-center gap-3">
                  <span className="uppercase">
                    {it.repository.providerType}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Star className="h-3 w-3" />
                    {it.repository.starsCount}
                  </span>
                  {it.repository.primaryLanguage && (
                    <span>{it.repository.primaryLanguage}</span>
                  )}
                  {it.repository.visibility === "private" && (
                    <span className="text-amber-600 dark:text-amber-400">
                      private
                    </span>
                  )}
                </div>
                {it.repository.description && (
                  <p className="text-sm text-gray-600 dark:text-gray-300 mt-1 line-clamp-2">
                    {it.repository.description}
                  </p>
                )}
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

            <div className="mt-3">
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

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
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
                className="text-xs border border-dashed border-gray-300 dark:border-gray-600 rounded px-2 py-0.5 w-28 bg-transparent text-gray-800 dark:text-gray-100 placeholder-gray-400"
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
          </div>
        ))}
        {items.length === 0 && !loading && (
          <div className="text-center py-12 bg-white dark:bg-gray-900 rounded-lg border border-dashed border-gray-300 dark:border-gray-700">
            <Star className="h-10 w-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-gray-600 dark:text-gray-300 text-sm mb-1">
              收藏库还是空的
            </p>
            <p className="text-gray-400 dark:text-gray-500 text-xs mb-4">
              同步你的 GitHub Stars 和 Forks，构建可离线使用的收藏库。
            </p>
            <button
              onClick={() => void syncNow()}
              disabled={busy}
              className="inline-flex items-center gap-2 bg-gray-900 dark:bg-gray-100 dark:text-gray-900 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-700 dark:hover:bg-gray-300 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
              同步 GitHub Stars
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
