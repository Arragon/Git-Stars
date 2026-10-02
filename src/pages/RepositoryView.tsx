// src/pages/RepositoryView.tsx
// Pixel-faithful port of the prototype `reader()` (reader-head, reader-tabs,
// reader-layout with readme/files/releases main pane and the reader-aside:
// AI summary, personal note, manual tags, repo facts). All behaviors preserved:
// capability gating, lazy per-tab loading, asset downloads, save/unsave,
// note + tag mutations via offline helpers, AI summary regeneration.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  Bookmark,
  BookmarkCheck,
  Check,
  ChevronRight,
  Code,
  Download,
  ExternalLink,
  FileText,
  Folder,
  Plus,
  RotateCw,
  Sparkles,
  Tag as TagIcon,
  WifiOff,
  X,
} from "lucide-react";
import {
  assetDownloadUrl,
  createTag,
  getFile,
  getReadme,
  getReleases,
  getRepository,
  getTree,
  listTags,
  updateSaved,
  type ReleaseView,
  type RepositoryDetailView,
  type Tag,
  type TreeEntryView,
} from "../utils/gitstarsApi";
import { renderMarkdownSafe } from "../lib/markdown";
import { summarizeProject } from "../utils/ai";
import { formatCount } from "../utils/libraryFilters";
import { ApiError } from "../utils/api";
import {
  attachTagToSaved,
  detachTagFromSaved,
  outcomeErrorLabel,
  readRepositorySavedCache,
  saveRepositoryFromLibrary,
  unsaveRepository,
  updateSavedFields,
  upsertRepositoryDetail,
  type MutationOutcome,
} from "../data/offlineMutations";
import { useSyncStatusStore } from "../store/useSyncStatusStore";
import { useToastStore } from "../store/useToastStore";
import { ActivityBadge } from "../components/ActivityBadge";
import { Dialog, EmptyState, SkeletonCard } from "../components/ui";
import { repoEmblem } from "../lib/utils";

type Tab = "readme" | "files" | "releases";

const TAB_ORDER: Tab[] = ["readme", "files", "releases"];

const TAB_DEFS: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
  { id: "readme", label: "README", icon: <BookOpen className="ico" /> },
  { id: "files", label: "文件", icon: <Code className="ico" /> },
  { id: "releases", label: "Releases", icon: <TagIcon className="ico" /> },
];

const friendly = (e: unknown, fallback: string): string =>
  e instanceof ApiError ? e.message : fallback;

export const RepositoryView: React.FC = () => {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const showToast = useToastStore((s) => s.showToast);
  const [repo, setRepo] = useState<RepositoryDetailView | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [tab, setTab] = useState<Tab>("readme");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [tagName, setTagName] = useState("");
  const tagInputRef = useRef<HTMLInputElement>(null);
  const isOnline = useSyncStatusStore((s) => s.isOnline);

  const [readme, setReadme] = useState<string | null>(null);
  const [entries, setEntries] = useState<TreeEntryView[] | null>(null);
  const [dirPath, setDirPath] = useState("");
  const [file, setFile] = useState<{ path: string; content: string } | null>(
    null,
  );
  const [releases, setReleases] = useState<ReleaseView[] | null>(null);

  /** Cache-first hydration of the saved/note/tags state (INH-406). */
  const hydrate = useCallback(async () => {
    try {
      const cached = await readRepositorySavedCache(id);
      setTags(cached.tags);
      if (!cached.repo) return;
      setRepo((current) => {
        if (current) return current; // server data wins once loaded
        return {
          ...cached.repo!,
          capabilities: null,
          saved: cached.saved
            ? {
                id: cached.saved.id,
                status: cached.saved.status,
                note: cached.saved.note,
                version: cached.saved.version,
                addedAt: cached.saved.addedAt,
                tags: cached.saved.tags,
              }
            : null,
        };
      });
    } catch {
      // cache unavailable — the API fetch still applies
    }
  }, [id]);

  const load = useCallback(async () => {
    try {
      const [r, tg] = await Promise.all([getRepository(id), listTags()]);
      setRepo(r);
      setTags(tg);
      setError("");
      try {
        await upsertRepositoryDetail(r);
      } catch {
        // best-effort cache write
      }
    } catch (e) {
      setError(friendly(e, "网络错误或服务暂不可用，请稍后重试"));
    }
  }, [id]);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Generate summary + tags via the configured AI vendor, then persist. */
  const runAiSummary = () => {
    const saved = repo?.saved;
    if (!saved || aiBusy) return;
    if (!isOnline) {
      setError("AI 总结需要联网后使用");
      return;
    }
    setAiBusy(true);
    setError("");
    void (async () => {
      try {
        const result = await summarizeProject(
          repo!.name,
          repo!.description ?? "",
          repo!.primaryLanguage ?? "",
          saved.tags.map((t) => t.name),
        );
        const res = await updateSaved(
          saved.id,
          { aiSummary: result.summary, aiTags: result.tags },
          `${saved.id}:${saved.version}`,
        );
        setRepo((current) =>
          current && current.saved
            ? {
                ...current,
                saved: {
                  ...current.saved,
                  aiSummary: result.summary,
                  aiTags: result.tags,
                  version: res.version,
                },
              }
            : current,
        );
        showToast("AI 摘要已更新");
      } catch (err) {
        setError(
          friendly(
            err,
            "AI 总结失败：请确认已在 设置 → AI 设置 中选择厂商并填写 API Key",
          ),
        );
      } finally {
        setAiBusy(false);
      }
    })();
  };

  // Load tab data on demand, gated by provider capabilities (ADR-0002 D4).
  useEffect(() => {
    const caps = repo?.capabilities;
    if (!caps) return;
    let cancelled = false;
    const run = async () => {
      try {
        if (tab === "readme" && caps.readme && readme === null) {
          const r = await getReadme(id);
          if (!cancelled) setReadme(r.content);
        } else if (tab === "files" && caps.tree && entries === null) {
          const t = await getTree(id, "", "");
          if (!cancelled) setEntries(t.entries);
        } else if (tab === "releases" && caps.releases && releases === null) {
          const rel = await getReleases(id);
          if (!cancelled) setReleases(rel.items);
        }
      } catch (e) {
        if (!cancelled) setError(friendly(e, "内容加载失败，请稍后重试"));
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [tab, repo, id, readme, entries, releases]);

  /** Run an offline-capable mutation with an immediate optimistic UI patch. */
  const act = async (
    fn: () => Promise<MutationOutcome<unknown>>,
    onApplied?: () => void,
  ) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const out = await fn();
      if (out.error) {
        setError(outcomeErrorLabel(out));
      } else if (!out.confirmed) {
        setNotice("离线：更改已保存到本地，联网后自动同步");
      }
      onApplied?.();
      if (out.confirmed) await load();
      else if (!out.error) await hydrate();
    } finally {
      setBusy(false);
    }
  };

  const openFile = async (path: string) => {
    try {
      const f = await getFile(id, "", path);
      setFile({ path: f.path, content: f.content });
    } catch (e) {
      setError(friendly(e, "文件打开失败，请稍后重试"));
    }
  };

  /** Prototype reader-tab arrow-key navigation (available tabs only). */
  const availableTabs = TAB_ORDER.filter((t) => {
    if (!repo?.capabilities) return false;
    if (t === "readme") return repo.capabilities.readme;
    if (t === "files") return repo.capabilities.tree;
    return repo.capabilities.releases;
  });

  const onTablistKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const i = availableTabs.indexOf(tab);
    if (i < 0) return;
    const next =
      availableTabs[
        (i + (e.key === "ArrowRight" ? 1 : availableTabs.length - 1)) %
          availableTabs.length
      ];
    setTab(next);
    document.getElementById(`tab-${next}`)?.focus();
  };

  const commitTag = async () => {
    const name = tagName.trim();
    if (!name || !repo?.saved) return;
    const existing = tags.find((t) => t.name === name);
    if (!existing && !isOnline) {
      setError("离线状态暂不支持新建标签，请联网后重试");
      return;
    }
    try {
      const tag = existing ?? (await createTag(name));
      await act(
        () => attachTagToSaved(repo.saved!.id, tag.id),
        () =>
          setRepo({
            ...repo,
            saved: repo.saved
              ? {
                  ...repo.saved,
                  tags: [...repo.saved.tags, { id: tag.id, name: tag.name }],
                }
              : repo.saved,
          }),
      );
      setTagDialogOpen(false);
      setTagName("");
      showToast("手动标签已添加");
    } catch (err) {
      setError(friendly(err, "操作失败，请重试"));
    }
  };

  if (!repo) {
    if (error) {
      return (
        <EmptyState
          icon={<AlertCircle className="ico large" />}
          title="无法加载仓库"
          description={error}
          action={
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                setError("");
                void load();
              }}
            >
              <RotateCw className="ico" /> 重试
            </button>
          }
        />
      );
    }
    return (
      <div role="status" aria-label="正在加载">
        <SkeletonCard />
      </div>
    );
  }

  const caps = repo.capabilities;
  const emblem = repoEmblem(repo.name);
  const offline = !isOnline;

  return (
    <div>
      <div className="reader-head">
        <span className={`repo-emblem ${emblem.toneCls}`}>
          {emblem.initials}
        </span>
        <div className="grow">
          <div className="muted tiny">
            {repo.namespacePath ? `${repo.namespacePath} /` : ""}
          </div>
          <h1>{repo.name}</h1>
        </div>
        <div className="page-actions">
          {repo.saved ? (
            <button
              type="button"
              className="btn"
              disabled={busy}
              title="已收藏，点击移除"
              onClick={() => {
                if (!window.confirm("确定将该仓库从收藏移除？")) return;
                void act(
                  () =>
                    unsaveRepository({
                      id: repo.saved!.id,
                      version: repo.saved!.version,
                    }),
                  () => setRepo({ ...repo, saved: null }),
                );
              }}
            >
              <BookmarkCheck className="ico" /> 已收藏
            </button>
          ) : (
            <button
              type="button"
              className="btn primary"
              disabled={busy || offline}
              title={offline ? "离线状态暂不支持收藏" : "收藏到我的库"}
              onClick={() =>
                void act(
                  () => saveRepositoryFromLibrary(repo.id),
                  () =>
                    setRepo({
                      ...repo,
                      saved: {
                        id: "pending",
                        status: "saved",
                        version: 1,
                        addedAt: new Date().toISOString(),
                        tags: [],
                      },
                    }),
                )
              }
            >
              <Bookmark className="ico" /> 收藏到库
            </button>
          )}
          <a
            className="btn"
            href={repo.webUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink className="ico" />
            来源仓库
          </a>
        </div>
      </div>

      {offline && (
        <div className="notice warning">
          <WifiOff className="ico" />
          <span className="grow">
            正在查看本地缓存。备注与标签的更改会在联网后同步。
          </span>
        </div>
      )}
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

      <div
        className="reader-tabs"
        role="tablist"
        aria-label="仓库内容"
        onKeyDown={onTablistKeyDown}
      >
        {TAB_DEFS.filter((t) =>
          t.id === "readme"
            ? caps?.readme
            : t.id === "files"
              ? caps?.tree
              : caps?.releases,
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            aria-selected={tab === t.id}
            aria-controls="reader-content"
            className={tab === t.id ? "active" : ""}
            onClick={() => setTab(t.id)}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      <div className="reader-layout">
        <section
          id="reader-content"
          role="tabpanel"
          aria-labelledby={`tab-${tab}`}
          tabIndex={0}
        >
          {offline ? (
            <EmptyState
              icon={<WifiOff className="ico large" />}
              title="这部分内容尚未缓存"
              description="离线时可查看已缓存的仓库资料、摘要、标签与备注。README、文件和发布资料需要联网获取。"
              action={
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => navigate("/library")}
                >
                  <ArrowLeft className="ico" /> 返回收藏库
                </button>
              }
            />
          ) : tab === "readme" ? (
            <article className="readme">
              <div className="doc-label">
                <span className="row gap8">
                  <BookOpen className="ico small" />
                  README.md
                </span>
              </div>
              {readme ? (
                <div
                  dangerouslySetInnerHTML={{
                    __html: renderMarkdownSafe(readme),
                  }}
                />
              ) : (
                <p className="muted small">
                  {caps?.readme
                    ? "正在加载 README…"
                    : "该平台暂不支持 README。"}
                </p>
              )}
            </article>
          ) : tab === "files" ? (
            <div className="files-layout">
              <div className="file-line">
                <span className="mono">
                  {file ? file.path : dirPath ? `${dirPath} /` : "main /"}
                </span>
                {(file || dirPath) && (
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={() => {
                      if (file) {
                        setFile(null);
                        return;
                      }
                      const parent = dirPath.split("/").slice(0, -1).join("/");
                      setDirPath(parent);
                      void getTree(id, "", parent).then((t) =>
                        setEntries(t.entries),
                      );
                    }}
                  >
                    <ArrowLeft className="ico small" /> 返回目录
                  </button>
                )}
                {!file && !dirPath && <span className="muted">仓库目录</span>}
              </div>
              {file ? (
                <pre className="file-code">{file.content}</pre>
              ) : entries ? (
                entries.map((e) => (
                  <button
                    key={e.path}
                    type="button"
                    className="file-line"
                    onClick={() => {
                      if (e.type === "dir") {
                        setDirPath(e.path);
                        void getTree(id, "", e.path).then((t) =>
                          setEntries(t.entries),
                        );
                      } else {
                        void openFile(e.path);
                      }
                    }}
                  >
                    {e.type === "dir" ? (
                      <Folder className="ico" />
                    ) : (
                      <FileText className="ico" />
                    )}
                    <span className="mono">{e.path.split("/").pop()}</span>
                    <span className="muted">
                      {e.type === "dir"
                        ? "打开目录"
                        : typeof e.size === "number"
                          ? `${e.size} B`
                          : "查看文件"}
                    </span>
                    <ChevronRight className="ico small" />
                  </button>
                ))
              ) : (
                <div className="file-line">
                  <span className="muted">
                    {caps?.tree ? "正在加载文件…" : "该平台暂不支持文件浏览。"}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <article className="readme">
              <div className="doc-label">
                <span>Releases</span>
                <a
                  href={`${repo.webUrl}/releases`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="row gap8"
                >
                  来源平台 <ExternalLink className="ico small" />
                </a>
              </div>
              {releases === null ? (
                <p className="muted small">
                  {caps?.releases
                    ? "正在加载发布版本…"
                    : "该平台暂不支持 Releases。"}
                </p>
              ) : releases.length === 0 ? (
                <p className="muted small">还没有发布版本。</p>
              ) : (
                releases.map((rel) => (
                  <section className="release" key={rel.id}>
                    <h2>
                      {rel.tagName}
                      {rel.name && rel.name !== rel.tagName && (
                        <span className="muted small">{rel.name}</span>
                      )}
                    </h2>
                    {rel.publishedAt && (
                      <p className="tiny">
                        {new Date(rel.publishedAt).toLocaleDateString()}
                      </p>
                    )}
                    {rel.assets.length > 0 && (
                      <div className="row wrap mt8">
                        {rel.assets.map((a) => (
                          <a
                            key={a.id}
                            className="btn sm"
                            href={assetDownloadUrl(id, a.id)}
                          >
                            <Download className="ico small" />
                            {a.name}（{Math.max(1, Math.round(a.size / 1024))}{" "}
                            KB）
                          </a>
                        ))}
                      </div>
                    )}
                    <p className="mt8">
                      <a
                        href={`${repo.webUrl}/releases`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        在来源平台查看发布说明{" "}
                        <ExternalLink className="ico small" />
                      </a>
                    </p>
                  </section>
                ))
              )}
            </article>
          )}
        </section>

        <aside className="reader-aside">
          {repo.saved && (
            <>
              <section className="aside-section">
                <div className="row between mb16">
                  <h3 style={{ margin: 0, color: "var(--violet)" }}>
                    <Sparkles className="ico small" />
                    AI 摘要
                  </h3>
                  <button
                    type="button"
                    className="btn icon ghost sm"
                    aria-label="重新生成摘要"
                    title="重新生成摘要"
                    disabled={aiBusy || offline}
                    onClick={runAiSummary}
                  >
                    <RotateCw
                      className={`ico small ${aiBusy ? "animate-spin" : ""}`}
                    />
                  </button>
                </div>
                <p className="ai-copy">
                  {repo.saved.aiSummary || "还没有摘要，可以按需生成。"}
                </p>
                {(repo.saved.aiTags ?? []).length > 0 && (
                  <div className="row wrap mt16">
                    {(repo.saved.aiTags ?? []).map((name) => (
                      <span className="badge violet" key={`ai-${name}`}>
                        {name}
                      </span>
                    ))}
                  </div>
                )}
              </section>

              <section className="aside-section">
                <h3>
                  <FileText className="ico small" />
                  个人备注
                </h3>
                <textarea
                  className="field"
                  aria-label="个人备注"
                  placeholder="记录你的使用场景、待验证问题…"
                  defaultValue={repo.saved.note ?? ""}
                  onBlur={(e) => {
                    const v = e.target.value;
                    if (v === (repo.saved?.note ?? "")) return;
                    void act(
                      () =>
                        updateSavedFields(
                          { id: repo.saved!.id, version: repo.saved!.version },
                          { note: v },
                        ),
                      () =>
                        setRepo({
                          ...repo,
                          saved: repo.saved
                            ? {
                                ...repo.saved,
                                note: v,
                                version: repo.saved.version + 1,
                              }
                            : repo.saved,
                        }),
                    );
                  }}
                />
                <div className="save-state">
                  <Check className="ico small" />
                  {offline
                    ? "编辑后保存在本地，等待同步"
                    : "停止输入后自动保存"}
                </div>
              </section>

              <section className="aside-section">
                <h3>
                  <TagIcon className="ico small" />
                  手动标签
                </h3>
                <div className="row wrap">
                  {repo.saved.tags.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className="chip active"
                      aria-label={`移除手动标签 ${t.name}`}
                      disabled={busy}
                      onClick={() =>
                        void act(
                          () => detachTagFromSaved(repo.saved!.id, t.id),
                          () =>
                            setRepo({
                              ...repo,
                              saved: repo.saved
                                ? {
                                    ...repo.saved,
                                    tags: repo.saved.tags.filter(
                                      (x) => x.id !== t.id,
                                    ),
                                  }
                                : repo.saved,
                            }),
                        )
                      }
                    >
                      {t.name}
                      <X className="ico small" />
                    </button>
                  ))}
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={() => {
                      setTagName("");
                      setTagDialogOpen(true);
                      setTimeout(() => tagInputRef.current?.focus(), 0);
                    }}
                  >
                    <Plus className="ico small" />
                    添加标签
                  </button>
                </div>
              </section>

              <section className="aside-section">
                <h3>仓库资料</h3>
                <div className="repo-facts">
                  <div>
                    <span>平台</span>
                    <span className="row gap8">
                      {repo.providerType === "github" ? (
                        <svg className="ico small" viewBox="0 0 24 24">
                          <path
                            d="M9 20c-5 1-5-2-7-3m14 5v-4a3.5 3.5 0 0 0-1-2.8c3.4-.4 7-1.7 7-7.3a5.5 5.5 0 0 0-1.5-3.8A5 5 0 0 0 20 0s-1.3-.4-4 1.5a13 13 0 0 0-8 0C5.3-.4 4 0 4 0a5 5 0 0 0-.5 3.1A5.5 5.5 0 0 0 2 6.9c0 5.6 3.6 6.9 7 7.3A3.5 3.5 0 0 0 8 17v5"
                            transform="translate(0 1) scale(.95)"
                          />
                        </svg>
                      ) : null}
                      {repo.providerType.toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <span>主要语言</span>
                    <span>{repo.primaryLanguage || "—"}</span>
                  </div>
                  <div>
                    <span>Stars</span>
                    <span className="number">
                      {formatCount(repo.starsCount)}
                    </span>
                  </div>
                  <div>
                    <span>Forks</span>
                    <span className="number">
                      {formatCount(repo.forksCount)}
                    </span>
                  </div>
                  <div>
                    <span>可见性</span>
                    <span>
                      {repo.visibility === "private" ? "私有" : "公开"}
                    </span>
                  </div>
                  <div>
                    <span>活跃度</span>
                    <ActivityBadge
                      owner={repo.namespacePath}
                      repo={repo.name}
                    />
                  </div>
                </div>
              </section>
            </>
          )}
          {!repo.saved && (
            <section className="aside-section">
              <h3>仓库资料</h3>
              <div className="repo-facts">
                <div>
                  <span>平台</span>
                  <span>{repo.providerType.toUpperCase()}</span>
                </div>
                <div>
                  <span>主要语言</span>
                  <span>{repo.primaryLanguage || "—"}</span>
                </div>
                <div>
                  <span>Stars</span>
                  <span className="number">{formatCount(repo.starsCount)}</span>
                </div>
                <div>
                  <span>Forks</span>
                  <span className="number">{formatCount(repo.forksCount)}</span>
                </div>
                <div>
                  <span>可见性</span>
                  <span>{repo.visibility === "private" ? "私有" : "公开"}</span>
                </div>
              </div>
              <p className="small muted mt16">
                收藏到库后，可以在这里记录备注、标签与 AI 摘要。
              </p>
            </section>
          )}
        </aside>
      </div>

      {/* Add-tag dialog (prototype `add-tag`) */}
      <Dialog
        open={tagDialogOpen}
        onClose={() => setTagDialogOpen(false)}
        title="添加手动标签"
        footer={
          <>
            <button
              type="button"
              className="btn"
              onClick={() => setTagDialogOpen(false)}
            >
              取消
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={!tagName.trim()}
              onClick={() => void commitTag()}
            >
              <Plus className="ico" />
              添加标签
            </button>
          </>
        }
      >
        <p>手动标签与 AI 标签分别显示，方便你保留自己的分类。</p>
        <label className="field-label mt16">
          标签名称
          <input
            ref={tagInputRef}
            className="field"
            value={tagName}
            maxLength={40}
            placeholder="例如：正在使用"
            onChange={(e) => setTagName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void commitTag();
              }
            }}
          />
        </label>
      </Dialog>
    </div>
  );
};
