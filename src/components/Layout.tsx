import React, { useEffect } from "react";
import { Outlet, useNavigate, useLocation, Link } from "react-router-dom";
import { Github, LogOut } from "lucide-react";
import { apiGet, apiPost } from "../utils/api";
import { useAuthStore, SessionUser } from "../store/useAuthStore";
import { SyncStatusBar } from "./SyncStatusBar";
import { OfflineBanner } from "./OfflineBanner";
import { localStore } from "../data";
import { useSyncStatusStore } from "../store/useSyncStatusStore";

interface SessionResponse {
  user: SessionUser | null;
  devLoginEnabled: boolean;
  devLoginUsername?: string;
  githubOAuthConfigured: boolean;
}

export const Layout: React.FC = () => {
  const { user, setUser, isLoading, setIsLoading, setDevLoginInfo } =
    useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    console.log("[Layout] Fetching session from backend...");

    apiGet<SessionResponse>("/api/auth/session")
      .then((session) => {
        console.log(
          "[Layout] Session result:",
          session.user ? "User logged in" : "No session",
        );
        setUser(session.user);
        setDevLoginInfo(session.devLoginEnabled, session.devLoginUsername);
        setIsLoading(false);

        if (!session.user && location.pathname !== "/") {
          console.log(
            "[Layout] Redirecting to / because no user session found",
          );
          navigate("/");
        } else if (session.user && location.pathname === "/") {
          console.log(
            "[Layout] Redirecting to /library because user is already logged in",
          );
          navigate("/library");
        }
      })
      .catch((error) => {
        console.error("[Layout] Failed to fetch session:", error);
        setUser(null);
        setIsLoading(false);
        if (location.pathname !== "/") {
          navigate("/");
        }
      });
  }, [navigate, location.pathname, setUser, setIsLoading, setDevLoginInfo]);

  const handleLogout = async () => {
    try {
      await apiPost("/api/auth/logout");
    } catch (error) {
      console.error("[Layout] Logout error:", error);
    }
    // Clear all user data from IndexedDB
    try {
      await localStore.clearUserState();
    } catch (e) {
      console.error("[Layout] Failed to clear local cache:", e);
    }
    // Reset sync status
    useSyncStatusStore.getState().reset();
    setUser(null);
    navigate("/");
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <nav className="bg-gray-900 text-white shadow-sm flex-shrink-0 z-10 relative">
        <div className="w-full px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div
              className="flex items-center cursor-pointer"
              onClick={() => (user ? navigate("/library") : navigate("/"))}
            >
              <Github className="h-8 w-8 text-white" />
              <span className="ml-2 text-xl font-bold">GitStars</span>
            </div>

            {user && (
              <div className="flex items-center space-x-4">
                <SyncStatusBar />
                <nav className="flex items-center space-x-3 text-sm">
                  <Link
                    to="/library"
                    className="text-gray-300 hover:text-white"
                  >
                    Library
                  </Link>
                  <Link to="/lists" className="text-gray-300 hover:text-white">
                    Lists
                  </Link>
                </nav>
                <div className="flex items-center">
                  {user.avatar_url && (
                    <img
                      className="h-8 w-8 rounded-full border border-gray-700"
                      src={user.avatar_url}
                      alt={user.full_name || user.username || "User avatar"}
                    />
                  )}
                  <span className="ml-2 text-sm font-medium hidden sm:block">
                    {user.full_name || user.username}
                  </span>
                </div>
                <button
                  onClick={handleLogout}
                  className="p-2 text-gray-300 hover:text-white hover:bg-gray-800 rounded-md transition-colors"
                  title="Logout"
                >
                  <LogOut className="h-5 w-5" />
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      <OfflineBanner />

      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>

      <footer className="bg-white border-t border-gray-200 mt-auto">
        <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
          <p className="text-center text-sm text-gray-500">
            &copy; {new Date().getFullYear()} GitStars. Visualizing your GitHub
            stars and forks.
          </p>
        </div>
      </footer>
    </div>
  );
};
