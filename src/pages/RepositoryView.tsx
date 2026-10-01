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
          <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-8 text-center space-y-3">
            <AlertCircle className="h-10 w-10 text-red-400 mx-auto" />
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              无法加载仓库
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">{error}</p>
            <button
              onClick={() => {
                setError("");
                void load();
              }}
              className="inline-flex items-center gap-1.5 bg-gray-900 dark:bg-gray-100 dark:text-gray-900 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-700 dark:hover:bg-gray-300"
            >
              <RotateCw className="h-4 w-4" /> 重试
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="max-w-4xl mx-auto p-6 text-gray-500 dark:text-gray-400">
        加载中...
      </div>
    );
  }

  const caps = repo.capabilities;
  const fullName = repo.namespacePath
    ? `${repo.namespacePath}/${repo.name}`
    : repo.name;

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4 text-gray-900 dark:text-gray-100">
      <Link
        to="/library"
        className="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
      >
        <ArrowLeft className="h-4 w-4" /> Library
      </Link>

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

      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold truncate">{fullName}</h1>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 flex items-center gap-3">
              <span className="uppercase">{repo.providerType}</span>
              <span className="inline-flex items-center gap-1">
                <Star className="h-3 w-3" />
                {repo.starsCount}
              </span>
              <span>forks {repo.forksCount}</span>
              {repo.primaryLanguage && <span>{repo.primaryLanguage}</span>}
              {repo.visibility === "private" && (
                <span className="text-amber-600 dark:text-amber-400">
                  private
                </span>
              )}
            </div>
            {repo.description && (
              <p className="text-sm text-gray-600 dark:text-gray-300 mt-2">
                {repo.description}
              </p>
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
            <button
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
              className="inline-flex items-center gap-1 bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-900 px-3 py-1.5 rounded text-sm shrink-0 disabled:opacity-50"
            >
              <BookmarkCheck className="h-4 w-4" /> Saved
            </button>
          ) : (
            <button
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
              className="inline-flex items-center gap-1 bg-gray-900 dark:bg-gray-100 dark:text-gray-900 text-white px-3 py-1.5 rounded text-sm shrink-0 disabled:opacity-50"
            >
              <Bookmark className="h-4 w-4" /> Save
            </button>
          )}
        </div>

        {repo.saved && (
          <div className="mt-4 border-t border-gray-100 dark:border-gray-800 pt-3 space-y-2">
            <input
              className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded px-2 py-1 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 placeholder-gray-400"
              placeholder="Personal note..."
              defaultValue={repo.saved.note ?? ""}
              onBlur={(e) => {
                const v = e.target.value;
                if (v !== (repo.saved?.note ?? ""))
                  // Version-guarded write (ADR-0004 D4): the offline helper
                  // sends If-Match for the base version we saw, so a stale
                  // edit 409s instead of silently overwriting.
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
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={runAiSummary}
                disabled={aiBusy}
                className="inline-flex items-center gap-1 text-xs bg-purple-600 text-white px-2.5 py-1 rounded hover:bg-purple-700 disabled:opacity-50"
              >
                <Sparkles
                  className={`h-3.5 w-3.5 ${aiBusy ? "animate-pulse" : ""}`}
                />
                {aiBusy
                  ? "生成中..."
                  : repo.saved.aiSummary
                    ? "重新生成 AI 总结"
                    : "AI 总结"}
              </button>
              <span className="text-xs text-gray-400 dark:text-gray-500">
                摘要与标签由已配置的 AI 厂商生成（设置 → AI 设置）
              </span>
            </div>
            {repo.saved.aiSummary && (
              <div className="text-sm bg-purple-50 dark:bg-purple-950/40 border border-purple-100 dark:border-purple-900 rounded px-3 py-2 text-purple-900 dark:text-purple-200">
                {repo.saved.aiSummary}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
              {repo.saved.tags.map((t) => (
                <span
                  key={t.id}
                  className="inline-flex items-center gap-1 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-xs rounded px-2 py-0.5"
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
                    disabled={busy}
                    className="text-gray-400 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              {(repo.saved.aiTags ?? []).map((name) => (
                <span
                  key={`ai-${name}`}
                  className="inline-flex items-center gap-1 bg-purple-100 dark:bg-purple-900/60 text-purple-800 dark:text-purple-200 text-xs rounded px-2 py-0.5"
                >
                  <Sparkles className="h-3 w-3" /> {name}
                </span>
              ))}
              <input
                className="text-xs border border-dashed border-gray-300 dark:border-gray-600 rounded px-2 py-0.5 w-28 bg-transparent text-gray-800 dark:text-gray-100 placeholder-gray-400"
                placeholder="+ tag"
                disabled={busy}
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
        )}
      </div>

      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-800 text-sm">
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

      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4 min-h-[12rem]">
        {tab === "readme" &&
          (readme ? (
            <div
              className="text-sm text-gray-800 dark:text-gray-200"
              dangerouslySetInnerHTML={{ __html: renderMarkdownSafe(readme) }}
            />
          ) : (
            <div className="text-sm text-gray-500 dark:text-gray-400">
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
                <pre className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded p-3 overflow-auto text-xs whitespace-pre-wrap text-gray-800 dark:text-gray-200">
                  {file.content}
                </pre>
              </div>
            ) : entries ? (
              <div>
                {dirPath && (
                  <button
                    onClick={async () => {
                      const parent = dirPath.split("/").slice(0, -1).join("/");
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
                    <li key={e.path} className="py-1.5 flex items-center gap-2">
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
                        <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">
                          {e.size} B
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="text-gray-500 dark:text-gray-400">
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
              <div
                key={rel.id}
                className="border border-gray-100 dark:border-gray-800 rounded p-3"
              >
                <div className="font-medium">
                  {rel.name || rel.tagName}{" "}
                  <span className="text-gray-400 dark:text-gray-500 font-normal">
                    {rel.tagName}
                  </span>
                </div>
                {rel.publishedAt && (
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {new Date(rel.publishedAt).toLocaleDateString()}
                  </div>
                )}
                <ul className="mt-2 space-y-1">
                  {rel.assets.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center justify-between gap-2"
                    >
                      <span className="text-gray-700 dark:text-gray-300">
                        {a.name}{" "}
                        <span className="text-xs text-gray-400 dark:text-gray-500">
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
                    <li className="text-xs text-gray-400 dark:text-gray-500">
                      No assets
                    </li>
                  )}
                </ul>
              </div>
            ))}
            {releases && releases.length === 0 && (
              <div className="text-gray-500 dark:text-gray-400">
                No releases.
              </div>
            )}
            {!releases && (
              <div className="text-gray-500 dark:text-gray-400">
                {caps?.releases
                  ? "Loading releases..."
                  : "Releases not available for this provider."}
              </div>
            )}
          </div>
        )}
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
    className={`inline-flex items-center gap-1 px-3 py-2 border-b-2 -mb-px ${active ? "border-gray-900 dark:border-gray-100 font-medium" : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"}`}
  >
    {icon} {label}
  </button>
);
