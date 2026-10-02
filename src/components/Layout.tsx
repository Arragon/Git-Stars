// src/components/Layout.tsx
// AppShell / PublicShell — pixel-faithful port of the prototype `sidebar()` +
// `shell()` + `publicShell()` markup (GitStars-Redesign.html), driven by real
// session/sync state. Class names come from src/styles/redesign.css.

import React, { useCallback, useEffect, useState } from "react";
import { Outlet, useNavigate, useLocation, Link } from "react-router-dom";
import { Menu, Moon, Sun, Search, Star } from "lucide-react";
import { apiGet } from "../utils/api";
import { signOutAndResetLocal } from "../utils/session";
import { useAuthStore, SessionUser } from "../store/useAuthStore";
import { useSyncStatusStore } from "../store/useSyncStatusStore";
import { useSyncDrawerStore } from "../store/useSyncDrawerStore";
import { useTheme } from "../hooks/useTheme";
import { SyncDrawer } from "./SyncDrawer";
import { CommandPalette } from "./CommandPalette";
import { listLists, type ListSummary } from "../utils/gitstarsApi";

interface SessionResponse {
  user: SessionUser | null;
  devLoginEnabled: boolean;
  devLoginUsername?: string;
  githubOAuthConfigured: boolean;
}

const ROUTE_NAMES: Record<string, string> = {
  library: "收藏库",
  lists: "我的列表",
  hub: "Hub 广场",
  settings: "设置",
  repository: "仓库阅读",
};

const LIST_DOTS = [
  "var(--violet)",
  "var(--blue)",
  "var(--amber)",
  "var(--brand)",
];

const NAV_GLYPHS: Record<string, React.ReactNode> = {
  library: (
    <svg className="ico" viewBox="0 0 24 24">
      <path d="M4 4h4v16H4zM11 4h4v16h-4zM18 4l4 15-3.5 1-4-15z" />
    </svg>
  ),
  lists: (
    <svg className="ico" viewBox="0 0 24 24">
      <path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </svg>
  ),
  hub: (
    <svg className="ico" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" />
      <path d="m16 8-2.5 5.5L8 16l2.5-5.5Z" />
    </svg>
  ),
  settings: (
    <svg className="ico" viewBox="0 0 24 24">
      <path d="m9.8 3-.7 2.1-2 .8-2-.9L3 8.7l1.5 1.7v2.3L3 14.5l2.1 3.7 2-.5 2 .9.7 2.4h4.4l.7-2.4 2-.9 2 .5 2.1-3.7-1.5-1.8v-2.3L21 8.7l-2.1-3.7-2 .9-2-.8-.7-2.1Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
};

export const Layout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, setUser, isLoading, setIsLoading, setDevLoginInfo } =
    useAuthStore();
  const { isOnline, pendingMutationCount } = useSyncStatusStore();
  const toggleSyncDrawer = useSyncDrawerStore((s) => s.toggle);
  const { isDark, setTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [sideLists, setSideLists] = useState<ListSummary[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiGet<SessionResponse>("/api/auth/session")
      .then((data) => {
        if (cancelled) return;
        setUser(data.user);
        setDevLoginInfo(data.devLoginEnabled, data.devLoginUsername);
        setIsLoading(false);
      })
      .catch(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [location.pathname, setUser, setIsLoading, setDevLoginInfo]);

  useEffect(() => {
    if (!user) {
      setSideLists([]);
      return;
    }
    listLists()
      .then((all) => setSideLists(all.slice(0, 5)))
      .catch(() => setSideLists([]));
  }, [user, location.pathname]);

  const handleLogout = useCallback(async () => {
    const pending = useSyncStatusStore.getState().pendingMutationCount;
    if (
      pending > 0 &&
      !window.confirm(
        `本地还有 ${pending} 条未同步的修改，退出后将保留在设备上，下次登录可继续同步。确定退出？`,
      )
    ) {
      return;
    }
    await signOutAndResetLocal();
    setUser(null);
    navigate("/");
  }, [navigate, setUser]);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (e.key === "Escape" && menuOpen) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const currentName = location.pathname.startsWith("/repository/")
    ? "仓库阅读"
    : (ROUTE_NAMES[location.pathname.split("/")[1] ?? ""] ?? "页面不存在");

  if (isLoading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: "var(--canvas)" }}
      >
        <span className="animate-spin rounded-full h-10 w-10 border-2 border-brand border-t-transparent" />
      </div>
    );
  }

  // ---- Public shell (anonymous) ------------------------------------------
  if (!user) {
    return (
      <div
        className="min-h-screen flex flex-col"
        style={{ background: "var(--canvas)" }}
      >
        <header className="public-nav">
          <Link to="/" className="brand">
            <span className="brand-mark">
              <Star className="ico" fill="currentColor" strokeWidth={0} />
            </span>
            <span>GitStars</span>
          </Link>
          <div className="public-nav-right">
            <Link to="/hub" className="hub-link">
              浏览 Hub
            </Link>
            <button
              type="button"
              className="btn icon ghost"
              aria-label="切换主题"
              onClick={() => setTheme(isDark ? "light" : "dark")}
            >
              {isDark ? <Sun className="ico" /> : <Moon className="ico" />}
            </button>
            {location.pathname !== "/" && (
              <Link to="/" className="btn primary sm">
                使用 GitHub 登录
              </Link>
            )}
          </div>
        </header>
        <main id="main-content" tabIndex={-1}>
          <Outlet />
        </main>
        <SyncDrawer />
      </div>
    );
  }

  // ---- App shell (authenticated) ------------------------------------------
  const isActive = (to: string) =>
    to === "/library"
      ? location.pathname === "/library" ||
        location.pathname.startsWith("/repository/")
      : location.pathname.startsWith(to);

  const navItem = (to: string, label: string, count?: number) => {
    const active = isActive(to);
    return (
      <Link
        key={to}
        to={to}
        aria-current={active ? "page" : undefined}
        title={label}
        className={`nav-item ${active ? "active" : ""}`}
      >
        {NAV_GLYPHS[to === "/settings" ? "settings" : to.split("/")[1]]}
        <span className="hidden min-[900px]:inline">{label}</span>
        {count !== undefined && (
          <span className="count number hidden min-[900px]:inline">
            {count}
          </span>
        )}
      </Link>
    );
  };

  const sidebar = (
    <>
      <div
        className={`mobile-scrim ${menuOpen ? "open" : ""}`}
        onClick={() => setMenuOpen(false)}
      />
      <aside
        className={`sidebar ${menuOpen ? "open" : ""}`}
        aria-label="主导航"
      >
        <Link to="/library" className="brand">
          <span className="brand-mark">
            <Star className="ico" fill="currentColor" strokeWidth={0} />
          </span>
          <span className="brand-name">GitStars</span>
        </Link>
        <nav>
          {navItem("/library", "收藏库")}
          {navItem("/lists", "我的列表", sideLists.length)}
          {navItem("/hub", "Hub 广场")}
        </nav>
        {sideLists.length > 0 && (
          <>
            <div className="side-label">
              我的列表
              <Link
                to="/lists"
                className="text-muted hover:text-ink text-sm"
                title="新建列表"
              >
                +
              </Link>
            </div>
            <div className="side-collections">
              {sideLists.map((l, i) => (
                <Link
                  key={l.id}
                  to={`/lists?list=${l.id}`}
                  className="side-list"
                >
                  <span
                    className="list-dot"
                    style={{ background: LIST_DOTS[i % LIST_DOTS.length] }}
                  />
                  <span className="grow">{l.name}</span>
                  <span className="count number">{l.itemCount}</span>
                </Link>
              ))}
            </div>
          </>
        )}
        <div className="side-end">
          <button
            type="button"
            className="sync-mini"
            onClick={toggleSyncDrawer}
          >
            <span className="row gap8">
              <span className={`dot ${isOnline ? "" : "amber"}`} />
              {isOnline ? "GitHub 已连接" : "离线 · 本地缓存"}
            </span>
            <span className="small">
              {isOnline
                ? pendingMutationCount
                  ? `${pendingMutationCount} 条修改待同步`
                  : "上次同步 · 刚刚"
                : `${pendingMutationCount} 条修改待同步`}
            </span>
          </button>
          {navItem("/settings", "设置")}
          <div className="user">
            <span className="avatar">
              {(user.full_name || user.username || "U")
                .slice(0, 2)
                .toUpperCase()}
            </span>
            <span className="grow">
              {user.username}
              <span className="muted tiny" style={{ display: "block" }}>
                个人工作空间
              </span>
            </span>
            <button
              type="button"
              className="btn icon ghost sm"
              aria-label="搜索与快捷跳转"
              onClick={() => setPaletteOpen(true)}
            >
              <Search className="ico small" />
            </button>
            <button
              type="button"
              className="btn icon ghost sm"
              aria-label="退出登录"
              title="退出登录"
              onClick={() => void handleLogout()}
            >
              <LogOutGlyph />
            </button>
          </div>
        </div>
      </aside>
    </>
  );

  return (
    <>
      {sidebar}
      <div className="workspace">
        <header className="topbar">
          <div className="row gap8">
            <button
              type="button"
              className="btn icon ghost menu-toggle"
              aria-label="打开导航"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
            >
              <Menu className="ico" />
            </button>
            <div className="crumb">
              <span>工作空间</span>
              <span className="muted" style={{ margin: "0 4px" }}>
                ›
              </span>
              <span>{currentName}</span>
            </div>
          </div>
          <div className="topbar-actions">
            <button
              type="button"
              className="btn ghost sm command-shortcut"
              aria-label="搜索与快捷跳转"
              onClick={() => setPaletteOpen(true)}
            >
              <Search className="ico small" />
              <kbd>⌘ / Ctrl K</kbd>
            </button>
            <button
              type="button"
              className="sync-pill"
              onClick={toggleSyncDrawer}
            >
              <span className={`dot ${isOnline ? "" : "amber"}`} />
              {isOnline
                ? pendingMutationCount
                  ? `${pendingMutationCount} 条待同步`
                  : "已同步"
                : "离线"}
            </button>
            <button
              type="button"
              className="btn icon ghost"
              aria-label="切换浅色或深色主题"
              onClick={() => setTheme(isDark ? "light" : "dark")}
            >
              {isDark ? <Sun className="ico" /> : <Moon className="ico" />}
            </button>
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className="content">
          <Outlet />
        </main>
      </div>
      <SyncDrawer />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        authed
      />
    </>
  );
};

function LogOutGlyph() {
  return (
    <svg className="ico" style={{ width: 15, height: 15 }} viewBox="0 0 24 24">
      <path d="M9 3H4v18h5M9 12h12m-5-5 5 5-5 5" />
    </svg>
  );
}
