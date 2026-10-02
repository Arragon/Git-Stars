import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Github,
  Star,
  Search,
  ListChecks,
  Share2,
  AlertCircle,
  Terminal,
} from "lucide-react";
import { apiPost } from "../utils/api";
import { useAuthStore } from "../store/useAuthStore";

const ERROR_MESSAGES: Record<string, string> = {
  identity_conflict:
    "This GitHub account is already linked to a different local user. Please contact the deployment owner.",
  oauth_denied: "GitHub OAuth authorization was denied.",
  oauth_state_invalid:
    "OAuth state validation failed. Please try signing in again.",
  oauth_failed: "GitHub OAuth authentication failed. Please try again.",
  github_rate_limit: "GitHub API rate limit exceeded. Please try again later.",
  oauth_not_configured:
    "GitHub OAuth is not configured on this server. Use dev login or set GITHUB_CLIENT_ID/SECRET.",
};

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

  const features = [
    {
      icon: <Star className="h-5 w-5 text-brand-500" />,
      title: "收藏库",
      description:
        "同步 GitHub Stars 与 Forks，构建可离线浏览、可搜索、可打标签的个人收藏库。",
    },
    {
      icon: <ListChecks className="h-5 w-5 text-blue-500" />,
      title: "列表管理",
      description:
        "用列表组织仓库：手动整理或依据 AI 摘要智能归类，支持导出导入与迁移。",
    },
    {
      icon: <Search className="h-5 w-5 text-green-600" />,
      title: "发现与搜索",
      description:
        "全网搜索 GitHub 仓库，一键收藏；库内按语言、标签、类型多维筛选。",
    },
    {
      icon: <Share2 className="h-5 w-5 text-purple-500" />,
      title: "分享与 Hub",
      description:
        "把列表发布为公开分享链接，选择进入 Hub 广场，让别人一键复制你的精选。",
    },
  ];

  return (
    <div className="flex flex-col items-center py-14 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl w-full text-center space-y-10">
        <div className="space-y-5">
          <span className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-gray-900 shadow-card mx-auto">
            <Star className="h-9 w-9 text-brand-400" fill="currentColor" />
          </span>
          <h1 className="text-4xl tracking-tight font-bold text-ink sm:text-5xl">
            <span className="block">收藏、整理并离线浏览</span>
            <span className="block mt-1">
              你的 <span className="text-brand-500">GitHub Stars</span>
            </span>
          </h1>
          <p className="max-w-2xl mx-auto text-base text-muted sm:text-lg">
            把散落的 Star 变成结构化的收藏库：AI
            自动提炼摘要与标签、列表化组织、跨设备离线同步，还能把精选分享给任何人。
          </p>
        </div>

        {error && (
          <div className="mx-auto max-w-md rounded-lg border border-red-200 bg-red-50 p-4 text-left">
            <div className="flex items-start">
              <AlertCircle className="h-5 w-5 text-red-500 mr-2 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-800">{error}</p>
            </div>
          </div>
        )}

        <div className="max-w-sm mx-auto sm:max-w-none sm:flex sm:justify-center sm:gap-4">
          <button
            onClick={handleLogin}
            disabled={isLoggingIn || isDevLoggingIn}
            className={`w-full inline-flex items-center justify-center px-8 py-3 text-base font-medium rounded-md text-white bg-gray-900 hover:bg-gray-700 sm:w-auto transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-60 ${
              isLoggingIn || isDevLoggingIn ? "cursor-not-allowed" : ""
            }`}
          >
            {isLoggingIn ? (
              <span className="flex items-center">
                <span className="animate-spin mr-3 h-5 w-5 border-2 border-white border-t-transparent rounded-full" />
                正在连接 GitHub…
              </span>
            ) : (
              <span className="flex items-center">
                <Github className="mr-2 h-5 w-5" />
                使用 GitHub 登录
              </span>
            )}
          </button>

          {devLoginEnabled && devLoginUsername && (
            <button
              onClick={handleDevLogin}
              disabled={isLoggingIn || isDevLoggingIn}
              className={`w-full sm:w-auto inline-flex items-center justify-center px-6 py-3 border border-line-strong text-base font-medium rounded-md text-ink bg-surface hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-60 ${
                isLoggingIn || isDevLoggingIn ? "cursor-not-allowed" : ""
              }`}
              title="本地开发登录（无需 OAuth）"
            >
              {isDevLoggingIn ? (
                <span className="flex items-center">
                  <span className="animate-spin mr-3 h-5 w-5 border-2 border-gray-600 border-t-transparent rounded-full" />
                  登录中…
                </span>
              ) : (
                <span className="flex items-center">
                  <Terminal className="mr-2 h-5 w-5" />以 {devLoginUsername}{" "}
                  登录
                </span>
              )}
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 text-left">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="bg-surface rounded-lg border border-line shadow-card p-5 hover:shadow-card-hover transition-shadow"
            >
              <div className="inline-flex items-center justify-center h-9 w-9 rounded-md bg-subtle border border-line-strong">
                {feature.icon}
              </div>
              <h3 className="mt-4 text-base font-semibold text-ink tracking-tight">
                {feature.title}
              </h3>
              <p className="mt-2 text-sm text-muted leading-relaxed">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
