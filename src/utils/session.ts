// src/utils/session.ts
// Shared sign-out plumbing used by Layout and the Settings page.
//
// M7-03 / INH-1699: sign-out must not silently delete unsynced edits. The mutation
// queue (and its temp-id map) survives by default; only account deletion / an explicit
// discard passes `preserveQueue: false`.

import { postLogout } from "./gitstarsApi";
import { localStore } from "../data";
import { mutationQueue, conflictLog } from "../sync/syncClient";
import { useSyncStatusStore } from "../store/useSyncStatusStore";
import { useAiConfigStore } from "../store/useAiConfigStore";

export interface UnsyncedSummary {
  pending: number;
  quarantined: number;
  conflicts: number;
  total: number;
}

/** Count everything that would be lost if the local state were wiped. */
export async function readUnsyncedSummary(): Promise<UnsyncedSummary> {
  const counts = await mutationQueue.countAll();
  let conflicts = 0;
  try {
    conflicts = (await conflictLog.getUnresolved()).length;
  } catch {
    // Conflict log unavailable — queue counts still tell the user what is at stake.
  }
  return {
    pending: counts.pending,
    quarantined: counts.quarantined,
    conflicts,
    total: counts.total + conflicts,
  };
}

/**
 * Ask before signing out with unsynced state. Returns false when the user cancels.
 * Wording matches behaviour: the queue is preserved, not deleted.
 */
export async function confirmUnsyncedBeforeSignOut(): Promise<boolean> {
  const summary = await readUnsyncedSummary();
  if (summary.total === 0) return window.confirm("确定退出登录？");

  const parts = [
    summary.pending > 0 ? `${summary.pending} 条待同步修改` : "",
    summary.quarantined > 0 ? `${summary.quarantined} 条失败草稿` : "",
    summary.conflicts > 0 ? `${summary.conflicts} 条未解决冲突` : "",
  ].filter(Boolean);

  return window.confirm(
    `本地还有${parts.join("、")}。退出后会保留在设备上，下次登录同一账号可继续同步；只有删除账户或显式清除才会丢弃。确定退出？`,
  );
}

/**
 * Best-effort server logout + local user-state wipe. Callers own the auth-store reset
 * and navigation.
 *
 * @param options.preserveQueue Keep the offline mutation queue + id map (default true).
 */
export async function signOutAndResetLocal(
  options: { preserveQueue?: boolean } = {},
): Promise<void> {
  const preserveQueue = options.preserveQueue ?? true;
  try {
    await postLogout();
  } catch (error) {
    console.error("[session] Logout request failed:", error);
  }
  try {
    await localStore.clearUserState({ includeQueue: !preserveQueue });
  } catch (error) {
    console.error("[session] Failed to clear local cache:", error);
  }
  // The AI key is a per-account secret: never leave it behind for the next account.
  useAiConfigStore.getState().clearSecret();
  useSyncStatusStore.getState().reset();
}
