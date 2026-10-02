// src/pages/Home.tsx
// Pixel-faithful port of the prototype `home()` (login layout + decorative
// preview card), keeping the real auth flows: GitHub OAuth redirect, dev login
// and the ?redirect= return path.

import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertCircle, BookmarkCheck, Search } from "lucide-react";
import { apiPost } from "../utils/api";
import { useAuthStore } from "../store/useAuthStore";

const ERROR_MESSAGES: Record<string, string> = {
  identity_conflict:
    "This GitHub account is already linked to a different local user. Please contact the deployment owner.",
  oauth_denied: "GitHub OAuth authorization was denied.",
  oauth_state_invalid:
    "OAuth state validation failed. Please try signing in again.",
  oauth_failed: "GitHub OAuth authentication failed. Please try again.",
  github_rate_limit: "GitHub API rate limit exceeded. Please try later.",
  oauth_not_configured:
    "GitHub OAuth is not configured on this server. Use dev login or set GITHUB_CLIENT_ID/SECRET.",
};

// Decorative sample rows for the 界面示例 preview card (prototype fixtures).
const PREVIEW_ROWS = [
  {
    owner: "honojs",
    name: "hono",
    mark: "h",
    toneCls: "bg-brand-soft text-brand-text",
    tags: "后端服务 · 开发工具",
  },
  {
    owner: "vercel",
    name: "ai",
    mark: "ai",
    toneCls: "bg-ai-soft text-ai",
    tags: "智能体 · 开发工具",
  },
  {
    owner: "numpy",
    name: "numpy",
    mark: "nu",
    toneCls: "bg-info-soft text-info",
    tags: "科学计算 · 开发工具",
  },
];

function GitHubGlyph({ className = "ico" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path
        d="M9 20c-5 1-5-2-7-3m14 5v-4a3.5 3.5 0 0 0-1-2.8c3.4-.4 7-1.7 7-7.3a5.5 5.5 0 0 0-1.5-3.8A5 5 0 0 0 20 0s-1.3-.4-4 1.5a13 13 0 0 0-8 0C5.3-.4 4 0 4 0a5 5 0 0 0-.5 3.1A5.5 5.5 0 0 0 2 6.9c0 5.6 3.6 6.9 7 7.3A3.5 3.5 0 0 0 8 17v5"
        transform="translate(0 1) scale(.95)"
      />
    </svg>
  );
}

function CompassGlyph({ className = "ico" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" />
      <path d="m16 8-2.5 5.5L8 16l2.5-5.5Z" />
    </svg>
  );
}

function FolderGlyph({ className = "ico" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </svg>
  );
}

function NoteGlyph({ className = "ico" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path d="M5 3h14a2 2 0 0 1 2 2v10l-6 6H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM15 21v-6h6M7 8h10M7 12h7" />
    </svg>
  );
}

function LibraryGlyph({ className = "ico" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path d="M4 4h4v16H4zM11 4h4v16h-4zM18 4l4 15-3.5 1-4-15z" />
    </svg>
  );
}

export const Home: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isDevLoggingIn, setIsDevLoggingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { devLoginEnabled, devLoginUsername } = useAuthStore();

  useEffect(() => {
    const errorParam = searchParams.get("error");
    if (errorParam) {
      setError(
        ERROR_MESSAGES[errorParam] || `Authentication error: ${errorParam}`,
      );
    }
  }, [searchParams]);

  const handleLogin = () => {
    console.log("[Home] Redirecting to GitHub OAuth...");
    setIsLoggingIn(true);
    window.location.assign("/api/auth/github/login");
  };

  const handleDevLogin = async () => {
    console.log("[Home] Attempting dev login...");
    setIsDevLoggingIn(true);
    setError(null);

    try {
      await apiPost("/api/auth/dev-login");
      // Honor an app-relative redirect (e.g. /?redirect=/s/<shareId> from a
      // public share page) so the post-login flow returns where the user was.
      const redirect = searchParams.get("redirect");
      window.location.assign(
        redirect && redirect.startsWith("/") && !redirect.startsWith("//")
          ? redirect
          : "/library",
      );
    } catch (err) {
      console.error("[Home] Dev login failed:", err);
      setError(
        "Dev login failed. Check that LOCAL_DEV_USER is set on the backend.",
      );
      setIsDevLoggingIn(false);
    }
  };

  return (
    <>
      <div className="login-layout">
        <section className="login-copy">
          <h1>
            为开源收藏，
            <br />
            留一个好位置。
          </h1>
          <p>
            将 GitHub Stars 与 Forks
            整理成可检索的收藏库。用主题列表、个人备注和 AI
            摘要，把“以后再看”变成“随时可用”。
          </p>
          <div className="login-benefits">
            <span className="row">
              <Search className="ico" />
              一个入口，搜索收藏与自己的整理
            </span>
            <span className="row">
              <FolderGlyph />
              按主题归类，按需导出与分享
            </span>
            <span className="row">
              <NoteGlyph />
              记录判断，保留真正有用的线索
            </span>
          </div>
          {error && (
            <div className="notice error" role="alert">
              <AlertCircle className="ico" />
              <span className="grow">{error}</span>
            </div>
          )}
          <div className="row wrap">
            <button
              type="button"
              className="btn primary"
              disabled={isLoggingIn || isDevLoggingIn}
              onClick={handleLogin}
            >
              <GitHubGlyph />
              {isLoggingIn ? "正在连接 GitHub…" : "使用 GitHub 登录"}
            </button>
            <Link to="/hub" className="btn ghost">
              <CompassGlyph />
              先浏览公开列表
            </Link>
          </div>
          {devLoginEnabled && devLoginUsername && (
            <div className="mt16">
              <button
                type="button"
                className="btn sm"
                disabled={isLoggingIn || isDevLoggingIn}
                onClick={() => void handleDevLogin()}
                title="本地开发登录（无需 OAuth）"
              >
                {isDevLoggingIn
                  ? "登录中…"
                  : `以演示开发用户 ${devLoginUsername} 进入`}
              </button>
              <span className="tiny muted"> 仅演示开发登录</span>
            </div>
          )}
          <p className="tiny" style={{ marginTop: 18, fontSize: 11 }}>
            个人列表默认私有。发布分享快照与加入 Hub 都由你主动选择。
          </p>
        </section>
        <section className="login-preview" aria-label="收藏工作台示例">
          <div className="login-preview-head">
            <span className="row">
              <LibraryGlyph />
              你的收藏库
            </span>
            <span className="badge">界面示例</span>
          </div>
          {PREVIEW_ROWS.map((r) => (
            <div className="preview-row" key={`${r.owner}/${r.name}`}>
              <span className={`repo-emblem ${r.toneCls}`}>{r.mark}</span>
              <div className="grow">
                <h3>
                  {r.owner} / {r.name}
                </h3>
                <p>{r.tags}</p>
              </div>
              <BookmarkCheck className="ico" />
            </div>
          ))}
          <div className="login-preview-foot">
            <FolderGlyph className="ico small" />
            Agent 工具箱
            <span className="muted" style={{ marginLeft: "auto" }}>
              6 个仓库
            </span>
          </div>
        </section>
      </div>
      <div className="login-foot">
        GitStars · 个人开源收藏工作台
        <span style={{ margin: "0 8px" }}>·</span>把 Star 变成随时可用的知识
      </div>
    </>
  );
};
