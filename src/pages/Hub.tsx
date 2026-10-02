// src/pages/Hub.tsx
// Public Hub catalog browser (/hub, INH-435). Anonymous-friendly: search,
// sort and keyset-paginated cards over active + hub-opted-in publications.
// Pixel-faithful port of the prototype `hub()` markup, driven by real data.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Folder, Globe, Plus, Search, WifiOff } from "lucide-react";
import {
  fetchHubLists,
  importPublicList,
  type HubCatalogEntry,
} from "../utils/gitstarsApi";
import { ApiError } from "../utils/api";
import { useAuthStore } from "../store/useAuthStore";
import { useSyncStatusStore } from "../store/useSyncStatusStore";
import { useToastStore } from "../store/useToastStore";
import { EmptyState, SkeletonCard } from "../components/ui";
import { repoEmblem } from "../lib/utils";

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
  const isOnline = useSyncStatusStore((s) => s.isOnline);
  const showToast = useToastStore((s) => s.showToast);

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
      showToast(`已复制「${entry.title}」到我的列表`);
      setTimeout(() => navigate("/lists"), 700);
    } catch (e) {
      setError(msg(e));
    } finally {
      setImporting(null);
    }
  };

  const retry = (
    <button
      type="button"
      className="btn primary"
      onClick={() => void load({ q: query.trim() || undefined, sort })}
    >
      重新加载
    </button>
  );

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">
            <h1>Hub 广场</h1>
          </div>
          <p>发现他人公开分享的开源清单，整理成自己的工具箱。</p>
        </div>
      </div>

      <div className="toolbar mb16">
        <div className="search-field">
          <Search className="ico" />
          <input
            className="field"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索公开列表"
            aria-label="搜索公开列表"
          />
        </div>
        <select
          className="field"
          aria-label="公开列表排序"
          value={sort}
          onChange={(e) => setSort(e.target.value as "recent" | "title")}
          style={{ width: "auto", minWidth: 130, minHeight: 36 }}
        >
          <option value="recent">最近更新</option>
          <option value="title">名称排序</option>
        </select>
      </div>

      {error && (
        <div className="notice error" role="alert">
          <span className="grow">{error}</span>
        </div>
      )}

      {!isOnline ? (
        <EmptyState
          icon={<WifiOff className="ico large" />}
          title="公开列表需要联网查看"
          description="收藏库中的本地内容仍然可以访问。恢复连接后再来发现新的清单。"
          action={
            <Link to="/library" className="btn primary">
              返回收藏库
            </Link>
          }
        />
      ) : loading ? (
        <div className="hub-grid" role="status" aria-label="正在加载">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : items.length === 0 ? (
        query ? (
          <EmptyState
            icon={<Search className="ico large" />}
            title="没有找到这个主题"
            description="换一个关键词，或查看全部公开列表。"
            action={
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  setQuery("");
                  setSort("recent");
                }}
              >
                清除搜索
              </button>
            }
          />
        ) : (
          <EmptyState
            icon={<Globe className="ico large" />}
            title="这里还没有公开列表"
            description="你可以先整理自己的列表。发布分享快照后，再选择是否展示到 Hub。"
            action={
              user ? (
                <Link to="/lists" className="btn primary">
                  整理我的列表
                </Link>
              ) : (
                <Link to="/" className="btn primary">
                  使用 GitHub 登录
                </Link>
              )
            }
          />
        )
      ) : (
        <>
          <div className="results-line">
            <span>{items.length} 个公开列表</span>
            <span>仅包含主动公开到 Hub 的快照</span>
          </div>
          <div className="hub-grid">
            {items.map((entry) => {
              const emblem = repoEmblem(entry.title);
              return (
                <article className="hub-card" key={entry.shareId}>
                  <div className="hub-card-top">
                    <span className={`hub-mark ${emblem.tone}`}>
                      <Folder className="ico large" />
                    </span>
                    <span className="badge">
                      <Globe className="ico small" />
                      公开
                    </span>
                  </div>
                  <h2>
                    <Link to={`/s/${entry.shareId}`}>{entry.title}</Link>
                  </h2>
                  <p>{entry.description || "（无描述）"}</p>
                  <div className="hub-meta">
                    <span className="number">
                      {entry.repositoryCount} 个仓库
                    </span>
                    <span>
                      {new Date(entry.updatedAt).toLocaleDateString()} 更新
                    </span>
                  </div>
                  <div className="hub-actions">
                    <Link
                      to={`/s/${entry.shareId}`}
                      className="row gap8"
                      style={{ color: "inherit" }}
                    >
                      查看清单 <ArrowRight className="ico small" />
                    </Link>
                    <button
                      type="button"
                      className="btn ghost sm"
                      disabled={importing === entry.shareId}
                      title="复制到我的列表"
                      onClick={() => void onImport(entry)}
                    >
                      <Plus className="ico small" />
                      {importing === entry.shareId
                        ? "复制中…"
                        : copied === entry.shareId
                          ? "已复制"
                          : "复制到我的列表"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
          {hasMore && nextCursor && (
            <div className="mt16" style={{ textAlign: "center" }}>
              <button
                type="button"
                className="btn"
                disabled={loadingMore}
                onClick={() =>
                  void load({
                    q: query.trim() || undefined,
                    sort,
                    append: true,
                    cursor: nextCursor,
                  })
                }
              >
                {loadingMore ? "加载中…" : "加载更多"}
              </button>
            </div>
          )}
          {!user && (
            <div className="footer-note">
              <span>复制公开列表需要先登录</span>
            </div>
          )}
        </>
      )}
      {error && !loading && items.length > 0 && retry}
    </div>
  );
};
