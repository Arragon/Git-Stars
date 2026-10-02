// src/components/Layout.tsx
// AppShell (authenticated: fixed sidebar + topbar workspace) and PublicShell
// (anonymous: minimal top nav), per the redesign baseline. Anonymous access to
// /hub and /s/* is preserved.

import React, { useCallback, useEffect, useState } from "react";
import { Outlet, useNavigate, useLocation, Link } from "react-router-dom";
import {
  Star,
  LogOut,
  Folder,
  Compass,
  Library as LibraryIcon,
  Settings as SettingsIcon,
  Menu,
  Moon,
  Sun,
} from "lucide-react";
import { apiGet } from "../utils/api";
import { signOutAndResetLocal } from "../utils/session";
import { useAuthStore, SessionUser } from "../store/useAuthStore";
import { useSyncStatusStore } from "../store/useSyncStatusStore";
import { useSyncDrawerStore } from "../store/useSyncDrawerStore";
import { useTheme } from "../hooks/useTheme";
import { SyncDrawer } from "./SyncDrawer";
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
  "var(--c-ai)",
  "var(--c-info)",
  "var(--c-gold)",
  "var(--c-brand)",
];

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

  const currentName = location.pathname.startsWith("/repository/")
    ? "仓库阅读"
    : (ROUTE_NAMES[location.pathname.split("/")[1] ?? ""] ?? "页面不存在");

  if (isLoading) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <span className="animate-spin rounded-full h-10 w-10 border-2 border-brand border-t-transparent" />
      </div>
    );
  }

  // ---- Public shell (anonymous) ------------------------------------------
  if (!user) {
    return (
      <div className="min-h-screen bg-canvas flex flex-col">
        <header className="h-[62px] border-b border-line bg-surface flex items-center justify-between px-6 sticky top-0 z-10">
          <Link to="/" className="flex items-center gap-2 select-none">
            <span className="inline-flex items-center justify-center h-7 w-7 rounded-lg bg-[#303e35]">
              <Star className="h-4 w-4 text-gold" fill="currentColor" />
            </span>
            <span className="text-lg font-bold tracking-[-0.03em]">
              GitStars
            </span>
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <Link
              to="/hub"
              className="text-muted hover:text-ink px-2 py-1 rounded-md"
            >
              浏览 Hub
            </Link>
            <button
              type="button"
              aria-label="切换主题"
              onClick={() => setTheme(isDark ? "light" : "dark")}
              className="p-2 rounded-md text-muted hover:text-ink hover:bg-subtle"
            >
              {isDark ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </button>
            {location.pathname !== "/" && (
              <Link
                to="/"
                className="text-xs border border-line rounded-md px-3 py-1.5 hover:bg-subtle"
              >
                使用 GitHub 登录
              </Link>
            )}
          </div>
        </header>
        <main id="main-content" className="flex-1">
          <Outlet />
        </main>
        <SyncDrawer />
      </div>
    );
  }

  // ---- App shell (authenticated) -----------------------------------------
  const navItem = (
    to: string,
    label: string,
    Icon: typeof Star,
    count?: number,
  ) => {
    const active =
      to === "/library"
        ? location.pathname === "/library" ||
          location.pathname.startsWith("/repository/")
        : location.pathname.startsWith(to);
    return (
      <Link
        key={to}
        to={to}
        aria-current={active ? "page" : undefined}
        title={label}
        className={`flex items-center gap-[11px] px-3 py-2.5 min-h-[40px] rounded-[7px] text-[13px] transition-colors ${
          active
            ? "bg-brand-soft text-brand-text font-semibold"
            : "text-muted hover:bg-subtle hover:text-ink"
        }`}
      >
        <Icon className="h-[18px] w-[18px] shrink-0" />
        <span className="hidden min-[900px]:inline flex-1 truncate">
          {label}
        </span>
        {count !== undefined && (
          <span className="hidden min-[900px]:inline text-[11px] text-muted">
            {count}
          </span>
        )}
      </Link>
    );
  };

  const sidebar = (
    <>
      <div
        className={`fixed inset-0 bg-black/35 z-[35] min-[561px]:hidden ${
          menuOpen ? "block" : "hidden"
        }`}
        onClick={() => setMenuOpen(false)}
      />
      <aside
        className={`fixed left-0 top-0 bottom-0 z-40 bg-side border-r border-line flex flex-col py-5 px-3.5 pb-3.5 transition-transform w-[225px] ${
          menuOpen ? "translate-x-0" : "-translate-x-full"
        } min-[561px]:translate-x-0 min-[561px]:w-[var(--side-width)] min-[561px]:static min-[561px]:shrink-0`}
        aria-label="主导航"
      >
        <Link
          to="/library"
          className="flex items-center gap-2.5 text-[19px] font-bold tracking-[-0.035em] px-2.5 pb-6"
        >
          <span className="inline-flex items-center justify-center h-[31px] w-[31px] rounded-[9px] bg-[#303e35] shrink-0">
            <Star className="h-[19px] w-[19px] text-gold" fill="currentColor" />
          </span>
          <span className="hidden min-[900px]:inline">GitStars</span>
        </Link>

        <nav className="grid gap-1">
          {navItem("/library", "收藏库", LibraryIcon)}
          {navItem("/lists", "我的列表", Folder, sideLists.length)}
          {navItem("/hub", "Hub 广场", Compass)}
        </nav>

        {sideLists.length > 0 && (
          <>
            <div className="text-muted text-[11px] px-3 pt-6 pb-2 hidden min-[900px]:flex justify-between items-center">
              我的列表
              <Link
                to="/lists"
                className="text-muted hover:text-ink text-sm"
                title="新建列表"
              >
                +
              </Link>
            </div>
            <div className="hidden min-[900px]:grid gap-0.5">
              {sideLists.map((l, i) => (
                <Link
                  key={l.id}
                  to={`/lists?list=${l.id}`}
                  className={`flex items-center gap-2 px-3 py-2 rounded-md text-xs ${
                    location.search === `?list=${l.id}`
                      ? "bg-brand-soft text-brand-text"
                      : "text-muted hover:bg-subtle hover:text-ink"
                  }`}
                >
                  <span
                    className="w-2 h-2 rounded-[3px] shrink-0"
                    style={{ background: LIST_DOTS[i % LIST_DOTS.length] }}
                  />
                  <span className="flex-1 truncate">{l.name}</span>
                  <span className="text-[11px] text-muted">{l.itemCount}</span>
                </Link>
              ))}
            </div>
          </>
        )}

        <div className="mt-auto flex flex-col gap-1 pt-4">
          {navItem("/settings", "设置", SettingsIcon)}
          <div className="flex items-center gap-2 px-2 pt-2 border-t border-line mt-2 text-xs">
            <span className="h-[30px] w-[30px] rounded-full bg-brand-soft text-brand-text grid place-items-center text-[11px] font-bold shrink-0">
              {(user.full_name || user.username || "U")
                .slice(0, 2)
                .toUpperCase()}
            </span>
            <span className="flex-1 min-w-0 hidden min-[900px]:block">
              <span className="block truncate">{user.username}</span>
              <span className="block text-[10px] text-muted">个人工作空间</span>
            </span>
            <button
              type="button"
              onClick={handleLogout}
              aria-label="退出登录"
              title="退出登录"
              className="p-1.5 text-muted hover:text-ink hover:bg-subtle rounded-md"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );

  return (
    <div className="min-h-screen bg-canvas text-ink flex">
      {sidebar}
      <div className="flex-1 min-h-screen min-w-0 flex flex-col min-[561px]:ml-[var(--side-width)]">
        <header className="h-14 border-b border-line bg-surface flex items-center justify-between px-4 sm:px-[30px] sticky top-0 z-[25] gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              aria-label="打开导航"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
              className="min-[561px]:hidden p-2 text-muted hover:text-ink"
            >
              <Menu className="h-5 w-5" />
            </button>
            <span className="text-xs text-muted truncate">
              工作空间
              <span className="mx-2 text-line-strong">›</span>
              <span className="text-ink">{currentName}</span>
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={toggleSyncDrawer}
              title={isOnline ? "同步状态" : "离线，正在使用本地缓存"}
              className="flex items-center gap-1.5 text-[11px] text-muted px-2 py-1.5 rounded-md hover:bg-subtle"
            >
              <span
                className={`inline-block w-[7px] h-[7px] rounded-full ${
                  isOnline ? "bg-brand" : "bg-gold"
                }`}
              />
              {isOnline
                ? pendingMutationCount
                  ? `${pendingMutationCount} 条待同步`
                  : "已同步"
                : "离线"}
            </button>
            <button
              type="button"
              aria-label="切换主题"
              onClick={() => setTheme(isDark ? "light" : "dark")}
              className="p-2 rounded-md text-muted hover:text-ink hover:bg-subtle"
            >
              {isDark ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </button>
          </div>
        </header>

        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 px-4 sm:px-[30px] py-7 pb-10 max-w-[1880px] w-full mx-auto"
        >
          <Outlet />
        </main>
      </div>

      <SyncDrawer />
    </div>
  );
};
