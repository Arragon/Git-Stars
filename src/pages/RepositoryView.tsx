import React, { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  Sparkles,
  Star,
  Bookmark,
  BookmarkCheck,
  Download,
  FileText,
  Folder,
  RotateCw,
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
import { ActivityBadge } from "../components/ActivityBadge";
import { Badge, Button, Notice, Textarea } from "../components/ui";

type Tab = "readme" | "files" | "releases";

const friendly = (e: unknown, fallback: string): string =>
  e instanceof ApiError ? e.message : fallback;

export const RepositoryView: React.FC = () => {
  const { id = "" } = useParams<{ id: string }>();
  const [repo, setRepo] = useState<RepositoryDetailView | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [tab, setTab] = useState<Tab>("readme");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
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

  if (!repo) {
    if (error) {
      return (
        <div className="max-w-4xl mx-auto p-4 sm:p-6">
          <div className="bg-surface rounded-lg border border-line p-8 text-center space-y-3">
            <AlertCircle className="h-10 w-10 text-red-400 mx-auto" />
            <h2 className="text-base font-semibold text-ink">无法加载仓库</h2>
            <p className="text-sm text-muted">{error}</p>
            <Button
              onClick={() => {
                setError("");
                void load();
              }}
            >
              <RotateCw className="h-4 w-4" /> 重试
            </Button>
          </div>
        </div>
      );
    }
    return <div className="max-w-4xl mx-auto p-6 text-muted">加载中...</div>;
  }

  const caps = repo.capabilities;
  const fullName = repo.namespacePath
    ? `${repo.namespacePath}/${repo.name}`
    : repo.name;

  return (
    <div className="max-w-[1240px] mx-auto p-4 sm:p-6 space-y-4 text-ink">
      <Link
        to="/library"
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-gray-800 dark:hover:text-gray-200"
      >
        <ArrowLeft className="h-4 w-4" /> Library
      </Link>

      {error && <Notice tone="error">{error}</Notice>}
      {notice && <Notice tone="info">{notice}</Notice>}

      <div className="bg-surface rounded-lg border border-line p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold truncate">{fullName}</h1>
            <div className="text-xs text-muted mt-1 flex items-center gap-3">
              <span className="uppercase">{repo.providerType}</span>
              <span className="inline-flex items-center gap-1">
                <Star className="h-3 w-3" />
                {repo.starsCount}
              </span>
              <span>forks {repo.forksCount}</span>
              {repo.primaryLanguage && <span>{repo.primaryLanguage}</span>}
              <ActivityBadge owner={repo.namespacePath} repo={repo.name} />
              {repo.visibility === "private" && (
                <span className="text-amber-600 dark:text-amber-400">
                  private
                </span>
              )}
            </div>
            {repo.description && (
              <p className="text-sm text-muted mt-2">{repo.description}</p>
            )}
            <a
              href={repo.webUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline mt-1 inline-block"
            >
              {repo.webUrl}
            </a>
          </div>
          {repo.saved ? (
            <Button
              variant="secondary"
              size="sm"
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
              disabled={busy}
              className="shrink-0 !bg-brand-50 dark:!bg-brand-500/10 !text-brand-700 dark:!text-brand-300 !border-brand-200 dark:!border-brand-500/30"
              title="已收藏，点击移除"
            >
              <BookmarkCheck className="h-4 w-4" /> Saved
            </Button>
          ) : (
            <Button
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
              disabled={busy || !isOnline}
              title={isOnline ? "收藏到我的库" : "离线状态暂不支持收藏"}
              className="shrink-0"
              size="sm"
            >
              <Bookmark className="h-4 w-4" /> Save
            </Button>
          )}
        </div>
      </div>

      {/* Reader layout: main content + organize aside */}
      <div className="grid grid-cols-1 min-[1051px]:grid-cols-[minmax(0,1fr)_282px] gap-6 items-start">
        <div className="min-w-0">
          <div className="flex gap-[25px] border-b border-line text-sm mb-[23px]">
            {caps?.readme && (
              <TabButton
                active={tab === "readme"}
                onClick={() => setTab("readme")}
                icon={<FileText className="h-4 w-4" />}
                label="README"
              />
            )}
            {caps?.tree && (
              <TabButton
                active={tab === "files"}
                onClick={() => setTab("files")}
                icon={<Folder className="h-4 w-4" />}
                label="Files"
              />
            )}
            {caps?.releases && (
              <TabButton
                active={tab === "releases"}
                onClick={() => setTab("releases")}
                icon={<Download className="h-4 w-4" />}
                label="Releases"
              />
            )}
          </div>

          <div className="bg-surface rounded-lg border border-line p-4 min-h-[12rem]">
            {tab === "readme" &&
              (readme ? (
                <div
                  className="text-sm text-ink"
                  dangerouslySetInnerHTML={{
                    __html: renderMarkdownSafe(readme),
                  }}
                />
              ) : (
                <div className="text-sm text-muted">
                  {caps?.readme
                    ? "Loading README..."
                    : "README not available for this provider."}
                </div>
              ))}

            {tab === "files" && (
              <div className="text-sm">
                {file ? (
                  <div>
                    <button
                      onClick={() => setFile(null)}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline mb-2 inline-flex items-center gap-1"
                    >
                      <ArrowLeft className="h-3 w-3" /> Back to files
                    </button>
                    <pre className="bg-subtle border border-line-strong rounded p-3 overflow-auto text-xs whitespace-pre-wrap text-ink">
                      {file.content}
                    </pre>
                  </div>
                ) : entries ? (
                  <div>
                    {dirPath && (
                      <button
                        onClick={async () => {
                          const parent = dirPath
                            .split("/")
                            .slice(0, -1)
                            .join("/");
                          setDirPath(parent);
                          const t = await getTree(id, "", parent);
                          setEntries(t.entries);
                        }}
                        className="text-xs text-blue-600 dark:text-blue-400 hover:underline mb-2"
                      >
                        .. up
                      </button>
                    )}
                    <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                      {entries.map((e) => (
                        <li
                          key={e.path}
                          className="py-1.5 flex items-center gap-2"
                        >
                          {e.type === "dir" ? (
                            <Folder className="h-4 w-4 text-gray-400" />
                          ) : (
                            <FileText className="h-4 w-4 text-gray-400" />
                          )}
                          {e.type === "dir" ? (
                            <button
                              className="hover:underline"
                              onClick={async () => {
                                setDirPath(e.path);
                                const t = await getTree(id, "", e.path);
                                setEntries(t.entries);
                              }}
                            >
                              {e.path.split("/").pop()}
                            </button>
                          ) : (
                            <button
                              className="hover:underline"
                              onClick={() => openFile(e.path)}
                            >
                              {e.path.split("/").pop()}
                            </button>
                          )}
                          {typeof e.size === "number" && (
                            <span className="ml-auto text-xs text-muted">
                              {e.size} B
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="text-muted">
                    {caps?.tree
                      ? "Loading files..."
                      : "File browsing not available for this provider."}
                  </div>
                )}
              </div>
            )}

            {tab === "releases" && (
              <div className="text-sm space-y-3">
                {releases?.map((rel) => (
                  <div key={rel.id} className="border border-line rounded p-3">
                    <div className="font-medium">
                      {rel.name || rel.tagName}{" "}
                      <span className="text-muted font-normal">
                        {rel.tagName}
                      </span>
                    </div>
                    {rel.publishedAt && (
                      <div className="text-xs text-muted">
                        {new Date(rel.publishedAt).toLocaleDateString()}
                      </div>
                    )}
                    <ul className="mt-2 space-y-1">
                      {rel.assets.map((a) => (
                        <li
                          key={a.id}
                          className="flex items-center justify-between gap-2"
                        >
                          <span className="text-ink">
                            {a.name}{" "}
                            <span className="text-xs text-muted">
                              ({Math.max(1, Math.round(a.size / 1024))} KB)
                            </span>
                          </span>
                          <a
                            href={assetDownloadUrl(id, a.id)}
                            className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                          >
                            <Download className="h-3 w-3" /> Download
                          </a>
                        </li>
                      ))}
                      {rel.assets.length === 0 && (
                        <li className="text-xs text-muted">No assets</li>
                      )}
                    </ul>
                  </div>
                ))}
                {releases && releases.length === 0 && (
                  <div className="text-muted">No releases.</div>
                )}
                {!releases && (
                  <div className="text-muted">
                    {caps?.releases
                      ? "Loading releases..."
                      : "Releases not available for this provider."}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <aside className="grid gap-6 min-[1051px]:sticky min-[1051px]:top-[84px] min-[561px]:grid-cols-1 min-[1051px]:grid-cols-1 min-[1051px]:block">
          {repo.saved && (
            <>
              <div className="border border-line rounded-xl bg-surface p-5">
                <h3 className="text-xs font-semibold flex items-center gap-2 mb-3">
                  <Sparkles className="h-3.5 w-3.5 text-ai" /> AI 摘要
                </h3>
                {repo.saved.aiSummary ? (
                  <p className="text-xs leading-[1.9] text-muted">
                    {repo.saved.aiSummary}
                  </p>
                ) : (
                  <p className="text-xs text-muted mb-3">
                    尚未生成。AI 摘要与标签由设置中配置的厂商生成。
                  </p>
                )}
                <Button
                  variant="ai"
                  size="xs"
                  onClick={runAiSummary}
                  disabled={aiBusy}
                  className="mt-2"
                >
                  <Sparkles
                    className={`h-3.5 w-3.5 ${aiBusy ? "animate-pulse" : ""}`}
                  />
                  {aiBusy
                    ? "生成中…"
                    : repo.saved.aiSummary
                      ? "重新生成"
                      : "生成摘要与标签"}
                </Button>
                {(repo.saved.aiTags ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {(repo.saved.aiTags ?? []).map((name) => (
                      <Badge key={`ai-${name}`} tone="ai">
                        {name}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              <div className="border border-line rounded-xl bg-surface p-5">
                <h3 className="text-xs font-semibold flex items-center gap-2 mb-3">
                  <FileText className="h-3.5 w-3.5 text-muted" /> 个人备注
                </h3>
                <Textarea
                  className="min-h-[98px] text-xs"
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
                <p className="text-[10px] text-muted mt-2">
                  停止输入后自动保存；离线时保存在本地待同步。
                </p>
              </div>

              <div className="border border-line rounded-xl bg-surface p-5">
                <h3 className="text-xs font-semibold flex items-center gap-2 mb-3">
                  <Star className="h-3.5 w-3.5 text-muted" /> 手动标签
                </h3>
                <div className="flex flex-wrap items-center gap-1.5">
                  {repo.saved.tags.map((t) => (
                    <span
                      key={t.id}
                      className="inline-flex items-center gap-1 bg-subtle text-ink text-xs rounded px-2 py-0.5"
                    >
                      {t.name}
                      <button
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
                        className="text-muted hover:text-danger"
                        aria-label={`移除标签 ${t.name}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  <input
                    className="text-xs border border-dashed border-line-strong rounded px-2 py-0.5 w-28 bg-transparent text-ink placeholder-muted"
                    placeholder="+ 标签"
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      const name = (e.target as HTMLInputElement).value.trim();
                      if (!name) return;
                      (e.target as HTMLInputElement).value = "";
                      const existing = tags.find((t) => t.name === name);
                      if (!existing && !isOnline) {
                        setError("离线状态暂不支持新建标签，请联网后重试");
                        return;
                      }
                      void (async () => {
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
                                      tags: [
                                        ...repo.saved.tags,
                                        { id: tag.id, name: tag.name },
                                      ],
                                    }
                                  : repo.saved,
                              }),
                          );
                        } catch (err) {
                          setError(friendly(err, "操作失败，请重试"));
                        }
                      })();
                    }}
                  />
                </div>
              </div>

              <div className="border border-line rounded-xl bg-surface p-5 grid gap-3 text-xs text-muted">
                <h3 className="text-xs font-semibold text-ink">仓库资料</h3>
                <div className="flex justify-between gap-3">
                  <span>来源</span>
                  <span className="text-ink uppercase">
                    {repo.providerType}
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span>Stars</span>
                  <span className="text-ink">{repo.starsCount}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span>Forks</span>
                  <span className="text-ink">{repo.forksCount}</span>
                </div>
                {repo.primaryLanguage && (
                  <div className="flex justify-between gap-3">
                    <span>语言</span>
                    <span className="text-ink">{repo.primaryLanguage}</span>
                  </div>
                )}
                <div className="flex justify-between gap-3 items-center">
                  <span>活跃度</span>
                  <ActivityBadge owner={repo.namespacePath} repo={repo.name} />
                </div>
                <a
                  href={repo.webUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-info hover:underline break-all"
                >
                  在 GitHub 打开 ↗
                </a>
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
};

const TabButton: React.FC<{
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}> = ({ active, onClick, icon, label }) => (
  <button
    onClick={onClick}
    className={`inline-flex items-center gap-1 px-3 py-2 border-b-2 -mb-px ${active ? "border-brand text-ink font-semibold" : "border-transparent text-muted hover:text-ink"}`}
  >
    {icon} {label}
  </button>
);
