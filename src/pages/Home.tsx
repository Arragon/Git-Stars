import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Github,
  Star,
  GitFork,
  Search,
  BarChart3,
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
      window.location.assign("/library");
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
      icon: <Star className="h-6 w-6 text-yellow-500" />,
      title: "Visualize Stars",
      description:
        "Get a clear overview of all your starred repositories in one beautiful dashboard.",
    },
    {
      icon: <GitFork className="h-6 w-6 text-blue-500" />,
      title: "Track Forks",
      description:
        "Keep track of the projects you have forked and monitor their original repositories.",
    },
    {
      icon: <Search className="h-6 w-6 text-green-500" />,
      title: "Advanced Search",
      description:
        "Easily find specific repositories with powerful filtering and search capabilities.",
    },
    {
      icon: <BarChart3 className="h-6 w-6 text-purple-500" />,
      title: "Analytics",
      description:
        "View statistics about languages, top starred repositories, and your activity.",
    },
  ];

  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl w-full text-center space-y-8">
        <div className="space-y-4">
          <Github className="mx-auto h-20 w-20 text-gray-900" />
          <h1 className="text-4xl tracking-tight font-extrabold text-gray-900 sm:text-5xl md:text-6xl">
            <span className="block">Manage your GitHub</span>
            <span className="block text-blue-600">Stars & Forks</span>
          </h1>
          <p className="mt-3 max-w-md mx-auto text-base text-gray-500 sm:text-lg md:mt-5 md:text-xl md:max-w-3xl">
            A beautiful, modern dashboard to visualize, organize, and search
            through all your GitHub starred repositories and forks.
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

        <div className="mt-10 max-w-sm mx-auto sm:max-w-none sm:flex sm:justify-center sm:space-x-4">
          <button
            onClick={handleLogin}
            disabled={isLoggingIn || isDevLoggingIn}
            className={`w-full flex items-center justify-center px-8 py-3 border border-transparent text-base font-medium rounded-md text-white bg-gray-900 hover:bg-gray-800 md:py-4 md:text-lg md:px-10 transition-colors ${
              isLoggingIn || isDevLoggingIn
                ? "opacity-75 cursor-not-allowed"
                : ""
            }`}
          >
            {isLoggingIn ? (
              <span className="flex items-center">
                <div className="animate-spin mr-3 h-5 w-5 border-b-2 border-white rounded-full"></div>
                Connecting to GitHub...
              </span>
            ) : (
              <span className="flex items-center">
                <Github className="mr-2 h-5 w-5" />
                Sign in with GitHub
              </span>
            )}
          </button>

          {devLoginEnabled && devLoginUsername && (
            <button
              onClick={handleDevLogin}
              disabled={isLoggingIn || isDevLoggingIn}
              className={`mt-4 sm:mt-0 w-full flex items-center justify-center px-6 py-3 border border-gray-300 text-base font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 md:py-4 md:text-lg transition-colors ${
                isLoggingIn || isDevLoggingIn
                  ? "opacity-75 cursor-not-allowed"
                  : ""
              }`}
              title="Local development login (no OAuth required)"
            >
              {isDevLoggingIn ? (
                <span className="flex items-center">
                  <div className="animate-spin mr-3 h-5 w-5 border-b-2 border-gray-600 rounded-full"></div>
                  Signing in...
                </span>
              ) : (
                <span className="flex items-center">
                  <Terminal className="mr-2 h-5 w-5" />
                  Sign in as {devLoginUsername}
                </span>
              )}
            </button>
          )}
        </div>

        <div className="mt-24">
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {features.map((feature, index) => (
              <div key={index} className="pt-6">
                <div className="flow-root bg-white rounded-lg px-6 pb-8 shadow-sm h-full border border-gray-100 hover:shadow-md transition-shadow">
                  <div className="-mt-6">
                    <div>
                      <span className="inline-flex items-center justify-center p-3 bg-gray-50 rounded-md shadow-sm border border-gray-100">
                        {feature.icon}
                      </span>
                    </div>
                    <h3 className="mt-8 text-lg font-medium text-gray-900 tracking-tight">
                      {feature.title}
                    </h3>
                    <p className="mt-5 text-base text-gray-500">
                      {feature.description}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
