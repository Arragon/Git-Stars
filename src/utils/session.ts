// src/utils/session.ts
// Shared sign-out plumbing used by Layout and the Settings page.

import { postLogout } from "./gitstarsApi";
import { localStore } from "../data";
import { useSyncStatusStore } from "../store/useSyncStatusStore";

/**
 * Best-effort server logout + local user-state wipe. Callers own the
 * auth-store reset and navigation.
 */
export async function signOutAndResetLocal(): Promise<void> {
  try {
    await postLogout();
  } catch (error) {
    console.error("[session] Logout request failed:", error);
  }
  try {
    await localStore.clearUserState();
  } catch (error) {
    console.error("[session] Failed to clear local cache:", error);
  }
  useSyncStatusStore.getState().reset();
}
