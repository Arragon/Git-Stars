import React, { useEffect } from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Home } from "./pages/Home";
import { Dashboard } from "./pages/Dashboard";
import { ProjectDetail } from "./pages/ProjectDetail";
import { Library } from "./pages/Library";
import { RepositoryView } from "./pages/RepositoryView";
import { Lists } from "./pages/Lists";
import {
  useSyncStatusStore,
  startSyncStatusPolling,
  stopSyncStatusPolling,
} from "./store/useSyncStatusStore";
import { pullSync, pushReplay } from "./sync/syncClient";
import { localStore } from "./data";
import { CacheRecoveryScreen } from "./components/CacheRecoveryScreen";
import { classifyCacheError } from "./utils/cacheRecovery";

const SyncProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const setOnline = useSyncStatusStore((s) => s.setOnline);
  const cacheError = useSyncStatusStore((s) => s.cacheError);
  const setCacheError = useSyncStatusStore((s) => s.setCacheError);

  useEffect(() => {
    // Initialize IndexedDB on mount. A hard failure here (corrupt schema, cache
    // written by a newer build) surfaces the recovery screen instead of silently
    // degrading (INH-406).
    localStore
      .open()
      .then(() => localStore.migrate())
      .catch((err) => {
        console.error("Local cache unavailable", err);
        setCacheError(classifyCacheError(err));
      });

    const handleOnline = () => {
      setOnline(true);
      // On reconnect: trigger pull sync + push replay
      pullSync
        .sync()
        .then(() => pushReplay.replayAll())
        .catch(console.error);
    };
    const handleOffline = () => {
      setOnline(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Set initial state
    setOnline(navigator.onLine);

    // Start polling for sync status updates
    startSyncStatusPolling();

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      stopSyncStatusPolling();
    };
  }, [setOnline, setCacheError]);

  // Hard cache failure: recovery UI instead of a degraded app (INH-406).
  if (cacheError) {
    return <CacheRecoveryScreen />;
  }

  return <>{children}</>;
};

function App() {
  return (
    <Router>
      <SyncProvider>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="library" element={<Library />} />
            <Route path="repository/:id" element={<RepositoryView />} />
            <Route path="lists" element={<Lists />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="project/:id" element={<ProjectDetail />} />
          </Route>
        </Routes>
      </SyncProvider>
    </Router>
  );
}

export default App;
