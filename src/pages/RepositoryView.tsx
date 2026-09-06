import React, { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Star,
  Bookmark,
  BookmarkCheck,
  Download,
  FileText,
  Folder,
  X,
} from "lucide-react";
import {
  assetDownloadUrl,
  attachTag,
  createTag,
  deleteSaved,
  detachTag,
  getFile,
  getReadme,
  getReleases,
  getRepository,
  getTree,
  listTags,
  saveRepository,
  updateSaved,
  type ReleaseView,
  type RepositoryDetailView,
  type Tag,
  type TreeEntryView,
} from "../utils/gitstarsApi";
import { renderMarkdownSafe } from "../lib/markdown";
import { ApiError } from "../utils/api";

type Tab = "readme" | "files" | "releases";

export const RepositoryView: React.FC = () => {
  const { id = "" } = useParams<{ id: string }>();
  const [repo, setRepo] = useState<RepositoryDetailView | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [tab, setTab] = useState<Tab>("readme");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [readme, setReadme] = useState<string | null>(null);
  const [entries, setEntries] = useState<TreeEntryView[] | null>(null);
  const [dirPath, setDirPath] = useState("");
  const [file, setFile] = useState<{ path: string; content: string } | null>(
    null,
  );
  const [releases, setReleases] = useState<ReleaseView[] | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, tg] = await Promise.all([getRepository(id), listTags()]);
      setRepo(r);
      setTags(tg);
      setError("");
    } catch (e) {
      setError(
        e instanceof ApiError
          ? `${e.code}: ${e.message}`
          : "Failed to load repository",
      );
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

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
        if (!cancelled)
          setError(
            e instanceof ApiError
              ? `${e.code}: ${e.message}`
              : "Failed to load content",
          );
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [tab, repo, id, readme, entries, releases]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(
        e instanceof ApiError ? `${e.code}: ${e.message}` : "Action failed",
      );
    } finally {
      setBusy(false);
    }
  };

  const openFile = async (path: string) => {
    try {
      const f = await getFile(id, "", path);
      setFile({ path: f.path, content: f.content });
    } catch (e) {
      setError(
        e instanceof ApiError
          ? `${e.code}: ${e.message}`
          : "Failed to open file",
      );
    }
  };

  if (!repo) {
    return (
      <div className="max-w-4xl mx-auto p-6 text-gray-500">
        {error || "Loading..."}
      </div>
    );
  }

  const caps = repo.capabilities;
  const fullName = repo.namespacePath
    ? `${repo.namespacePath}/${repo.name}`
    : repo.name;

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
      <Link
        to="/library"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800"
      >
        <ArrowLeft className="h-4 w-4" /> Library
      </Link>

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-gray-900 truncate">
              {fullName}
            </h1>
            <div className="text-xs text-gray-500 mt-1 flex items-center gap-3">
              <span className="uppercase">{repo.providerType}</span>
              <span className="inline-flex items-center gap-1">
                <Star className="h-3 w-3" />
                {repo.starsCount}
              </span>
              <span>forks {repo.forksCount}</span>
              {repo.primaryLanguage && <span>{repo.primaryLanguage}</span>}
              {repo.visibility === "private" && (
                <span className="text-amber-600">private</span>
              )}
            </div>
            {repo.description && (
              <p className="text-sm text-gray-600 mt-2">{repo.description}</p>
            )}
            <a
              href={repo.webUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:underline mt-1 inline-block"
            >
              {repo.webUrl}
            </a>
          </div>
          {repo.saved ? (
            <button
              onClick={() => act(() => deleteSaved(repo.saved!.id))}
              disabled={busy}
              className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 border border-amber-200 px-3 py-1.5 rounded text-sm shrink-0"
            >
              <BookmarkCheck className="h-4 w-4" /> Saved
            </button>
          ) : (
            <button
              onClick={() => act(() => saveRepository(repo.id))}
              disabled={busy}
              className="inline-flex items-center gap-1 bg-gray-900 text-white px-3 py-1.5 rounded text-sm shrink-0"
            >
              <Bookmark className="h-4 w-4" /> Save
            </button>
          )}
        </div>

        {repo.saved && (
          <div className="mt-4 border-t border-gray-100 pt-3 space-y-2">
            <input
              className="w-full text-sm border border-gray-200 rounded px-2 py-1"
              placeholder="Personal note..."
              defaultValue={repo.saved.note ?? ""}
              onBlur={(e) => {
                const v = e.target.value;
                if (v !== (repo.saved?.note ?? ""))
                  act(() => updateSaved(repo.saved!.id, { note: v }));
              }}
            />
            <div className="flex flex-wrap items-center gap-1.5">
              {repo.saved.tags.map((t) => (
                <span
                  key={t.id}
                  className="inline-flex items-center gap-1 bg-gray-100 text-gray-700 text-xs rounded px-2 py-0.5"
                >
                  {t.name}
                  <button
                    onClick={() => act(() => detachTag(repo.saved!.id, t.id))}
                    className="text-gray-400 hover:text-red-600"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              <input
                className="text-xs border border-dashed border-gray-300 rounded px-2 py-0.5 w-28"
                placeholder="+ tag"
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  const name = (e.target as HTMLInputElement).value.trim();
                  if (!name) return;
                  (e.target as HTMLInputElement).value = "";
                  void act(async () => {
                    const existing = tags.find((t) => t.name === name);
                    const tag = existing ?? (await createTag(name));
                    await attachTag(repo.saved!.id, tag.id);
                  });
                }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-1 border-b border-gray-200 text-sm">
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

      <div className="bg-white rounded-lg border border-gray-200 p-4 min-h-[12rem]">
        {tab === "readme" &&
          (readme ? (
            <div
              className="text-sm text-gray-800"
              dangerouslySetInnerHTML={{ __html: renderMarkdownSafe(readme) }}
            />
          ) : (
            <div className="text-sm text-gray-500">
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
                  className="text-xs text-blue-600 hover:underline mb-2 inline-flex items-center gap-1"
                >
                  <ArrowLeft className="h-3 w-3" /> Back to files
                </button>
                <pre className="bg-gray-50 border border-gray-200 rounded p-3 overflow-auto text-xs whitespace-pre-wrap">
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
                    className="text-xs text-blue-600 hover:underline mb-2"
                  >
                    .. up
                  </button>
                )}
                <ul className="divide-y divide-gray-100">
                  {entries.map((e) => (
                    <li key={e.path} className="py-1.5 flex items-center gap-2">
                      {e.type === "dir" ? (
                        <Folder className="h-4 w-4 text-gray-400" />
                      ) : (
                        <FileText className="h-4 w-4 text-gray-400" />
                      )}
                      {e.type === "dir" ? (
                        <button
                          className="text-gray-800 hover:underline"
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
                          className="text-gray-800 hover:underline"
                          onClick={() => openFile(e.path)}
                        >
                          {e.path.split("/").pop()}
                        </button>
                      )}
                      {typeof e.size === "number" && (
                        <span className="ml-auto text-xs text-gray-400">
                          {e.size} B
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="text-gray-500">
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
              <div key={rel.id} className="border border-gray-100 rounded p-3">
                <div className="font-medium text-gray-900">
                  {rel.name || rel.tagName}{" "}
                  <span className="text-gray-400 font-normal">
                    {rel.tagName}
                  </span>
                </div>
                {rel.publishedAt && (
                  <div className="text-xs text-gray-500">
                    {new Date(rel.publishedAt).toLocaleDateString()}
                  </div>
                )}
                <ul className="mt-2 space-y-1">
                  {rel.assets.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center justify-between gap-2"
                    >
                      <span className="text-gray-700">
                        {a.name}{" "}
                        <span className="text-xs text-gray-400">
                          ({Math.max(1, Math.round(a.size / 1024))} KB)
                        </span>
                      </span>
                      <a
                        href={assetDownloadUrl(id, a.id)}
                        className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                      >
                        <Download className="h-3 w-3" /> Download
                      </a>
                    </li>
                  ))}
                  {rel.assets.length === 0 && (
                    <li className="text-xs text-gray-400">No assets</li>
                  )}
                </ul>
              </div>
            ))}
            {releases && releases.length === 0 && (
              <div className="text-gray-500">No releases.</div>
            )}
            {!releases && (
              <div className="text-gray-500">
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
    className={`inline-flex items-center gap-1 px-3 py-2 border-b-2 -mb-px ${active ? "border-gray-900 text-gray-900 font-medium" : "border-transparent text-gray-500 hover:text-gray-800"}`}
  >
    {icon} {label}
  </button>
);
