import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDown,
  ArrowUp,
  Download,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  createList,
  deleteList,
  exportList,
  getList,
  importCommit,
  importPreview,
  listLibrary,
  listLists,
  updateListItems,
  type ImportPreview,
  type ListDetail,
  type ListSummary,
  type SavedRepository,
} from "../utils/gitstarsApi";
import { ApiError } from "../utils/api";

const msg = (e: unknown): string =>
  e instanceof ApiError
    ? `${e.code}: ${e.message}`
    : e instanceof Error
      ? e.message
      : "Error";

export const Lists: React.FC = () => {
  const [lists, setLists] = useState<ListSummary[]>([]);
  const [selected, setSelected] = useState<ListDetail | null>(null);
  const [library, setLibrary] = useState<SavedRepository[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [importText, setImportText] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);

  const reloadLists = useCallback(async () => {
    try {
      setLists(await listLists());
    } catch (e) {
      setError(msg(e));
    }
  }, []);

  useEffect(() => {
    reloadLists();
    listLibrary()
      .then(setLibrary)
      .catch((e) => setError(msg(e)));
  }, [reloadLists]);

  const openList = async (id: string) => {
    try {
      setSelected(await getList(id));
      setError("");
    } catch (e) {
      setError(msg(e));
    }
  };

  const onCreate = async () => {
    if (!name.trim()) return;
    try {
      const l = await createList(name.trim());
      setName("");
      await reloadLists();
      await openList(l.id);
    } catch (e) {
      setError(msg(e));
    }
  };

  const mutateItems = async (payload: {
    add?: string[];
    remove?: string[];
    reorder?: string[];
  }) => {
    if (!selected) return;
    try {
      const updated = await updateListItems(selected.id, payload);
      setSelected(updated);
      await reloadLists();
    } catch (e) {
      setError(msg(e));
    }
  };

  const move = (index: number, dir: -1 | 1) => {
    if (!selected) return;
    const order = selected.items.map((i) => i.savedRepositoryId);
    const target = index + dir;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    void mutateItems({ reorder: order });
  };

  const onExport = async (list: ListSummary) => {
    try {
      const doc = await exportList(list.id);
      const blob = new Blob([JSON.stringify(doc, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${list.name.replace(/\s+/g, "-").toLowerCase()}.gitstars-list.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(msg(e));
    }
  };

  const onPreview = async () => {
    try {
      setPreview(await importPreview(importText));
      setError("");
    } catch (e) {
      setError(msg(e));
      setPreview(null);
    }
  };
  const onCommit = async () => {
    try {
      await importCommit(importText, preview?.title);
      setImportText("");
      setPreview(null);
      await reloadLists();
    } catch (e) {
      setError(msg(e));
    }
  };

  const addable = library.filter(
    (s) =>
      selected && !selected.items.some((i) => i.savedRepositoryId === s.id),
  );

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Lists</h1>
      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              className="flex-1 text-sm border border-gray-200 rounded px-3 py-2"
              placeholder="New list name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onCreate();
              }}
            />
            <button
              onClick={onCreate}
              className="inline-flex items-center gap-1 bg-gray-900 text-white px-3 py-2 rounded text-sm"
            >
              <Plus className="h-4 w-4" /> Create
            </button>
          </div>
          <ul className="space-y-2">
            {lists.map((l) => (
              <li
                key={l.id}
                className={`bg-white rounded-lg border p-3 flex items-center gap-2 ${selected?.id === l.id ? "border-gray-900" : "border-gray-200"}`}
              >
                <button
                  onClick={() => openList(l.id)}
                  className="flex-1 text-left"
                >
                  <div className="text-sm font-medium text-gray-900">
                    {l.name}
                  </div>
                  <div className="text-xs text-gray-500">
                    {l.itemCount ?? 0} items
                  </div>
                </button>
                <button
                  onClick={() => onExport(l)}
                  className="text-gray-400 hover:text-gray-700"
                  title="Export"
                >
                  <Download className="h-4 w-4" />
                </button>
                <button
                  onClick={async () => {
                    await deleteList(l.id);
                    if (selected?.id === l.id) setSelected(null);
                    await reloadLists();
                  }}
                  className="text-gray-400 hover:text-red-600"
                  title="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
            {lists.length === 0 && (
              <li className="text-sm text-gray-500">No lists yet.</li>
            )}
          </ul>

          <div className="bg-white rounded-lg border border-gray-200 p-3 space-y-2">
            <div className="text-sm font-medium text-gray-700 inline-flex items-center gap-1">
              <Upload className="h-4 w-4" /> Import a List
            </div>
            <textarea
              className="w-full text-xs border border-gray-200 rounded p-2 font-mono"
              rows={4}
              placeholder="Paste a .gitstars-list JSON..."
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
            />
            <div className="flex gap-2">
              <button
                onClick={onPreview}
                className="text-sm bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded"
              >
                Preview
              </button>
              {preview && (
                <button
                  onClick={onCommit}
                  className="text-sm bg-gray-900 text-white px-3 py-1.5 rounded"
                >
                  Confirm import
                </button>
              )}
            </div>
            {preview && (
              <div className="text-xs text-gray-600 bg-gray-50 rounded p-2">
                <div className="font-medium">
                  “{preview.title}” — {preview.summary.total} items
                </div>
                <div>
                  new: {preview.summary.new} · existing:{" "}
                  {preview.summary.existing} · unresolved:{" "}
                  {preview.summary.unresolved}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-4">
          {selected ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">
                  {selected.name}
                </h2>
                <button
                  onClick={() => setSelected(null)}
                  className="text-gray-400 hover:text-gray-700"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <ul className="space-y-1">
                {selected.items.map((item, index) => (
                  <li
                    key={item.id}
                    className="flex items-center gap-2 border border-gray-100 rounded px-2 py-1.5"
                  >
                    <span className="text-xs text-gray-400 w-4">
                      {index + 1}
                    </span>
                    <Link
                      to={`/repository/${item.repository.id}`}
                      className="flex-1 text-sm text-gray-800 hover:underline truncate"
                    >
                      {item.repository.name}
                    </Link>
                    <button
                      onClick={() => move(index, -1)}
                      className="text-gray-400 hover:text-gray-700"
                      aria-label="Move up"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => move(index, 1)}
                      className="text-gray-400 hover:text-gray-700"
                      aria-label="Move down"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() =>
                        mutateItems({ remove: [item.savedRepositoryId] })
                      }
                      className="text-gray-400 hover:text-red-600"
                      aria-label="Remove from list"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
                {selected.items.length === 0 && (
                  <li className="text-sm text-gray-500">Empty list.</li>
                )}
              </ul>
              <div className="border-t border-gray-100 pt-3">
                <div className="text-xs text-gray-500 mb-1">
                  Add from library
                </div>
                <select
                  className="w-full text-sm border border-gray-200 rounded px-2 py-1.5"
                  defaultValue=""
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v) {
                      void mutateItems({ add: [v] });
                      e.target.value = "";
                    }
                  }}
                >
                  <option value="" disabled>
                    Select a saved repository...
                  </option>
                  {addable.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.repository.namespacePath
                        ? `${s.repository.namespacePath}/`
                        : ""}
                      {s.repository.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <div className="text-sm text-gray-500 py-12 text-center">
              Select a list to view and edit its items.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
