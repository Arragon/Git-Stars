// src/sync/accountScope.ts
// Account scoping for offline state (M8-X). The mutation queue and its temp-id map must
// never be replayed under a different account: entries carry the owning user id and are
// filtered against the current scope, which is set when the session user is known.
//
// Legacy entries (created before this field existed) are claimed by the first signed-in
// scope that touches them, so an upgrade does not strand pending work.

const STORAGE_KEY = "gitstars.account_scope";

let currentOwner: string | null = null;

export function setAccountScope(userId: string | null): void {
  currentOwner = userId;
  try {
    if (userId) globalThis.localStorage?.setItem(STORAGE_KEY, userId);
    else globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    // storage unavailable (private mode) — in-memory scope still applies this session
  }
}

export function getAccountScope(): string | null {
  if (currentOwner) return currentOwner;
  try {
    currentOwner = globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    currentOwner = null;
  }
  return currentOwner;
}

/** Test helper: reset the module-level scope without touching storage. */
export function resetAccountScopeForTests(): void {
  currentOwner = null;
}

/**
 * True when an entry belongs to the active scope. Unowned (legacy) entries match so the
 * queue can claim them; `ownerMatches` is called after `claimUnowned` in the queue.
 */
export function isVisibleToScope(
  entryOwner: string | undefined,
  scope: string | null,
): boolean {
  if (!scope) return true; // before sign-in nothing is known; push will 401 anyway
  return !entryOwner || entryOwner === scope;
}
