import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw, Star, Search, ExternalLink, X } from "lucide-react";
import {
  attachTag,
  createTag,
  deleteSaved,
  detachTag,
  listLibrary,
  listTags,
  searchRepositories,
  syncProvider,
  updateSaved,
  type SavedRepository,
  type SearchItemView,
  type Tag,
} from "../utils/gitstarsApi";
import { ApiError } from "../utils/api";

const NoteEditor: React.FC<{
  initial?: string;
  onSave: (note: string) => void;
}> = ({ initial, onSave }) => {
  const [value, setValue] = useState(initial ?? "");
  useEffect(() => setValue(initial ?? ""), [initial]);
  return (
    <input
      className="w-full text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-gray-400"
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
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchItemView[] | null>(null);

  const reload = useCallback(async () => {
    try {
      const [lib, tg] = await Promise.all([
        listLibrary({ provider, tag: tagFilter, sort, order: "desc" }),
        listTags(),
      ]);
      setItems(lib);
      setTags(tg);
      setError("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load library");
    } finally {
      setLoading(false);
    }
  }, [provider, tagFilter, sort]);

  useEffect(() => {
    reload();
  }, [reload]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await reload();
    } catch (e) {
      setError(
        e instanceof ApiError ? `${e.code}: ${e.message}` : "Action failed",
      );
    } finally {
      setBusy(false);
    }
  };

  const onSearch = async () => {
    if (!query.trim()) {
      setResults(null);
      return;
    }
    setBusy(true);
    try {
      const r = await searchRepositories(query.trim());
      setResults(r.items);
    } catch (e) {
      setError(
        e instanceof ApiError ? `${e.code}: ${e.message}` : "Search failed",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Library</h1>
        <button
          onClick={() => run(() => syncProvider("github"))}
          disabled={busy}
          className="inline-flex items-center gap-2 bg-gray-900 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-700 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} /> Sync
          GitHub
        </button>
      </div>

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 p-3">
        <div className="flex gap-2">
          <input
            className="flex-1 text-sm border border-gray-200 rounded px-3 py-2"
            placeholder="Discover repositories on GitHub..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSearch();
            }}
          />
          <button
            onClick={onSearch}
            className="inline-flex items-center gap-1 bg-gray-100 hover:bg-gray-200 px-3 py-2 rounded text-sm"
          >
            <Search className="h-4 w-4" /> Search
          </button>
        </div>
        {results && (
          <ul className="mt-3 divide-y divide-gray-100">
            {results.map((r) => (
              <li
                key={`${r.identity.providerType}:${r.identity.remoteId}`}
                className="py-2 flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">
                    {r.namespacePath ? `${r.namespacePath}/` : ""}
                    {r.name}
                  </div>
                  <div className="text-xs text-gray-500 truncate">
                    {r.description}
                  </div>
                </div>
                <a
                  href={r.webUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline shrink-0"
                >
                  <ExternalLink className="h-3 w-3" /> Open
                </a>
              </li>
            ))}
            {results.length === 0 && (
              <li className="py-2 text-sm text-gray-500">No results.</li>
            )}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          className="border border-gray-200 rounded px-2 py-1"
        >
          <option value="">All providers</option>
          <option value="github">GitHub</option>
          <option value="gitlab">GitLab</option>
          <option value="gitee">Gitee</option>
        </select>
        <select
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          className="border border-gray-200 rounded px-2 py-1"
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
          className="border border-gray-200 rounded px-2 py-1"
        >
          <option value="added_at">Sort: Recently added</option>
          <option value="stars">Sort: Stars</option>
          <option value="name">Sort: Name</option>
        </select>
        <span className="ml-auto text-gray-500 self-center">
          {items.length} saved
        </span>
      </div>

      <div className="space-y-3">
        {items.map((it) => (
          <div
            key={it.id}
            className="bg-white rounded-lg border border-gray-200 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link
                  to={`/repository/${it.repository.id}`}
                  className="text-base font-semibold text-gray-900 hover:underline"
                >
                  {it.repository.namespacePath
                    ? `${it.repository.namespacePath}/`
                    : ""}
                  {it.repository.name}
                </Link>
                <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-3">
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
                    <span className="text-amber-600">private</span>
                  )}
                </div>
                {it.repository.description && (
                  <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                    {it.repository.description}
                  </p>
                )}
              </div>
              <button
                onClick={() => run(() => deleteSaved(it.id))}
                className="text-gray-400 hover:text-red-600 shrink-0"
                title="Remove from library"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3">
              <NoteEditor
                initial={it.note}
                onSave={(note) =>
                  run(() => updateSaved(it.id, { note }, it.etag))
                }
              />
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {it.tags.map((t) => (
                <span
                  key={t.id}
                  className="inline-flex items-center gap-1 bg-gray-100 text-gray-700 text-xs rounded px-2 py-0.5"
                >
                  {t.name}
                  <button
                    onClick={() => run(() => detachTag(it.id, t.id))}
                    className="text-gray-400 hover:text-red-600"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              <input
                className="text-xs border border-dashed border-gray-300 rounded px-2 py-0.5 w-28"
                placeholder="+ tag"
                onKeyDown={async (e) => {
                  if (e.key !== "Enter") return;
                  const name = (e.target as HTMLInputElement).value.trim();
                  if (!name) return;
                  (e.target as HTMLInputElement).value = "";
                  await run(async () => {
                    const existing = tags.find((t) => t.name === name);
                    const tag = existing ?? (await createTag(name));
                    await attachTag(it.id, tag.id);
                  });
                }}
              />
            </div>
          </div>
        ))}
        {items.length === 0 && !busy && !loading && (
          <div className="text-center text-gray-500 py-12 bg-white rounded-lg border border-dashed border-gray-300">
            Your library is empty. Click “Sync GitHub” to import your stars and
            forks.
          </div>
        )}
      </div>
    </div>
  );
};
