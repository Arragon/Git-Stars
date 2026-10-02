// src/components/CommandPalette.tsx
// ⌘/Ctrl+K command palette: page jumps + saved-repo search (prototype
// `.command-list` / `.command-item`).

import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Code,
  Compass,
  Folder,
  Github,
  Library as LibraryIcon,
  Search,
  Settings,
} from "lucide-react";
import { Dialog } from "./ui";
import { listLibrary, type SavedRepository } from "../utils/gitstarsApi";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  authed: boolean;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  open,
  onClose,
  authed,
}) => {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [repos, setRepos] = useState<SavedRepository[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && authed) {
      listLibrary({})
        .then(setRepos)
        .catch(() => setRepos([]));
    }
    if (open) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, authed]);

  const q = query.toLowerCase();
  const pages = (
    authed
      ? ([
          ["收藏库", "/library", LibraryIcon],
          ["我的列表", "/lists", Folder],
          ["Hub 广场", "/hub", Compass],
          ["设置", "/settings", Settings],
        ] as const)
      : ([
          ["Hub 广场", "/hub", Compass],
          ["登录", "/", Github],
        ] as const)
  ).filter(([label]) => label.toLowerCase().includes(q));

  const repoHits = authed
    ? repos
        .filter((r) =>
          `${r.repository.namespacePath ?? ""}/${r.repository.name} ${r.repository.description ?? ""}`
            .toLowerCase()
            .includes(q),
        )
        .slice(0, 7)
    : [];

  const go = (path: string) => {
    onClose();
    navigate(path);
  };

  return (
    <Dialog open={open} onClose={onClose} title="搜索与快捷跳转" width="520px">
      <div className="search-field mb16">
        <Search className="ico" />
        <input
          ref={inputRef}
          className="field"
          placeholder="搜索仓库或页面"
          aria-label="搜索仓库或页面"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const first = repoHits[0];
              if (q && first) go(`/repository/${first.repository.id}`);
              else if (pages.length) go(pages[0][1]);
            }
          }}
        />
      </div>
      <div className="command-list">
        {pages.map(([label, path, Icon]) => (
          <button
            key={path}
            type="button"
            className="command-item"
            onClick={() => go(path)}
          >
            <Icon className="ico" />
            {label}
            <span className="muted">页面</span>
          </button>
        ))}
        {repoHits.map((r) => (
          <button
            key={r.id}
            type="button"
            className="command-item"
            onClick={() => go(`/repository/${r.repository.id}`)}
          >
            <Code className="ico" />
            <span className="grow">
              {r.repository.namespacePath
                ? `${r.repository.namespacePath}/`
                : ""}
              {r.repository.name}
            </span>
            <span className="muted">仓库</span>
          </button>
        ))}
        {q && pages.length === 0 && repoHits.length === 0 && (
          <p className="muted small">没有匹配的结果。</p>
        )}
      </div>
    </Dialog>
  );
};
