import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Copy, Search, Star } from "lucide-react";
import {
  fetchHubLists,
  importPublicList,
  type HubCatalogEntry,
} from "../utils/gitstarsApi";
import { ApiError } from "../utils/api";
import { useAuthStore } from "../store/useAuthStore";

// Public Hub catalog browser (/hub, INH-435). Anonymous-friendly: search,
// sort and keyset-paginated cards over active + hub-opted-in publications.
// Detail view is the same public snapshot as /s/:shareId (single domain).

const msg = (e: unknown): string =>
  e instanceof ApiError
    ? `${e.code}: ${e.message}`
    : e instanceof Error
      ? e.message
      : "Error";

const PAGE_SIZE = 20;

export const Hub: React.FC = () => {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"recent" | "title">("recent");
  const [items, setItems] = useState<HubCatalogEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    async (opts: {
      q?: string;
      sort?: "recent" | "title";
      append?: boolean;
      cursor?: string;
    }) => {
      if (opts.append) setLoadingMore(true);
      else setLoading(true);
      setError("");
      try {
        const page = await fetchHubLists({
          q: opts.q,
          sort: opts.sort,
          cursor: opts.cursor,
          limit: PAGE_SIZE,
        });
        setItems((prev) =>
          opts.append ? [...prev, ...page.items] : page.items,
        );
        setNextCursor(page.nextCursor);
        setHasMore(page.hasMore);
      } catch (e) {
        setError(msg(e));
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [],
  );

  // Debounced search + sort changes reload from the first page.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(
      () => {
        void load({ q: query.trim() || undefined, sort });
      },
      query ? 300 : 0,
    );
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, sort, load]);

  const onImport = async (entry: HubCatalogEntry) => {
    if (importing) return;
    if (!user) {
      navigate(`/?redirect=/s/${entry.shareId}`);
      return;
    }
    setImporting(entry.shareId);
    setError("");
    try {
      await importPublicList(entry.shareId);
      setCopied(entry.shareId);
      setTimeout(() => navigate("/lists"), 700);
    } catch (e) {
      setError(msg(e));
    } finally {
      setImporting(null);
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
          Hub
        </h1>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as "recent" | "title")}
          className="text-sm border border-gray-200 rounded px-2 py-2 bg-white"
          aria-label="排序方式"
        >
          <option value="recent">最近更新</option>
          <option value="title">标题</option>
        </select>
      </div>

      <div className="relative">
        <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索公开 Lists..."
          className="w-full text-sm border border-gray-200 rounded px-9 py-2 bg-white"
        />
      </div>

      {error && (
        <div className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 rounded px-3 py-2">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-28 bg-white border border-gray-200 rounded-lg animate-pulse"
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg p-10 text-center text-sm text-gray-500">
          {query ? "没有匹配的公开 Lists。" : "Hub 还没有任何公开 Lists。"}
        </div>
      ) : (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {items.map((entry) => (
              <div
                key={entry.shareId}
                className="bg-white border border-gray-200 rounded-lg p-4 flex flex-col gap-2 hover:border-gray-400 transition-colors"
              >
                <button
                  onClick={() => navigate(`/s/${entry.shareId}`)}
                  className="text-left flex-1"
                >
                  <div className="text-sm font-semibold text-gray-900 line-clamp-1">
                    {entry.title}
                  </div>
                  <div className="text-xs text-gray-500 line-clamp-2 mt-0.5 min-h-[2rem]">
                    {entry.description || "（无描述）"}
                  </div>
                </button>
                <div className="flex items-center justify-between">
                  <div className="text-xs text-gray-400 inline-flex items-center gap-1">
                    <Star className="h-3 w-3" />
                    {entry.repositoryCount} 个仓库 ·{" "}
                    {new Date(entry.updatedAt).toLocaleDateString()}
                  </div>
                  <button
                    onClick={() => onImport(entry)}
                    disabled={importing === entry.shareId}
                    title="复制到我的 Lists"
                    className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900 border border-gray-200 rounded px-2 py-1 disabled:opacity-60"
                  >
                    <Copy className="h-3 w-3" />
                    {importing === entry.shareId
                      ? "复制中..."
                      : copied === entry.shareId
                        ? "已复制"
                        : "复制到我的 Lists"}
                  </button>
                </div>
              </div>
            ))}
          </div>
          {hasMore && nextCursor && (
            <div className="text-center pt-2">
              <button
                onClick={() =>
                  void load({
                    q: query.trim() || undefined,
                    sort,
                    append: true,
                    cursor: nextCursor,
                  })
                }
                disabled={loadingMore}
                className="text-sm bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded disabled:opacity-60"
              >
                {loadingMore ? "加载中..." : "加载更多"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};
