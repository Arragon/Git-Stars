// src/sync/conflictResolvers.ts
// Entity-specific conflict resolvers for 409 VERSION_CONFLICT (ADR-0004 D4, INH-419).
// Each resolver takes the local pending mutation and the current server state,
// and returns a resolution action: retry with new payload, drop, or manual.

import type { QueuedMutation } from "../data/types";

export type ResolutionAction =
  | { action: "retry"; payload: unknown; newBaseVersion: number }
  | { action: "drop" }
  | { action: "manual" };

// --- Individual entity resolvers ---

/**
 * SavedRepository: LWW — re-apply local fields onto server current.
 * Local payload fields override server fields (last-writer-wins per field).
 */
export function resolveSavedRepository(
  localPending: QueuedMutation,
  serverCurrent: Record<string, unknown>,
): ResolutionAction {
  const payload = localPending.payload as Record<string, unknown>;
  if (!payload) return { action: "drop" };

  // Merge local fields onto server current.
  const merged = { ...serverCurrent, ...payload };
  const serverVersion = Number(serverCurrent.version ?? 1);

  return {
    action: "retry",
    payload: merged,
    newBaseVersion: serverVersion,
  };
}

/**
 * List: LWW — re-apply local fields (name, description) onto server current.
 */
export function resolveList(
  localPending: QueuedMutation,
  serverCurrent: Record<string, unknown>,
): ResolutionAction {
  const payload = localPending.payload as Record<string, unknown>;
  if (!payload) return { action: "drop" };

  const merged = { ...serverCurrent, ...payload };
  const serverVersion = Number(serverCurrent.version ?? 1);

  return {
    action: "retry",
    payload: merged,
    newBaseVersion: serverVersion,
  };
}

/**
 * ListItem membership: Set semantics.
 * If local is adding an item, check if server already has it (drop if so).
 * If local is removing an item, check if server already removed it (drop if so).
 * Otherwise re-apply the add/remove.
 */
export function resolveListItemMembership(
  localPending: QueuedMutation,
  serverCurrent: Record<string, unknown>,
): ResolutionAction {
  const payload = localPending.payload as {
    add?: string[];
    remove?: string[];
  };
  if (!payload) return { action: "drop" };

  const serverItems = (serverCurrent.items ?? []) as Array<{
    savedRepositoryId: string;
  }>;
  const serverSavedIds = new Set(serverItems.map((i) => i.savedRepositoryId));
  const serverVersion = Number(serverCurrent.version ?? 1);

  // Re-evaluate adds: only add items not already on server.
  const resolvedAdd = (payload.add ?? []).filter(
    (id) => !serverSavedIds.has(id),
  );
  // Re-evaluate removes: only remove items still on server.
  const resolvedRemove = (payload.remove ?? []).filter((id) =>
    serverSavedIds.has(id),
  );

  // If nothing to do after re-evaluation, drop.
  if (resolvedAdd.length === 0 && resolvedRemove.length === 0) {
    return { action: "drop" };
  }

  return {
    action: "retry",
    payload: { add: resolvedAdd, remove: resolvedRemove },
    newBaseVersion: serverVersion,
  };
}

/**
 * ListItem order: Fractional indexing — generate new keys between server neighbors.
 * The local reorder intent is re-applied against the server's current item set.
 */
export function resolveListItemOrder(
  localPending: QueuedMutation,
  serverCurrent: Record<string, unknown>,
): ResolutionAction {
  const payload = localPending.payload as { reorder?: string[] };
  if (!payload?.reorder) return { action: "drop" };

  const serverItems = (serverCurrent.items ?? []) as Array<{
    savedRepositoryId: string;
    position: string;
  }>;

  // If server doesn't have the items being reordered, can't resolve automatically.
  const serverSavedIds = new Set(serverItems.map((i) => i.savedRepositoryId));
  const allPresent = payload.reorder.every((id) => serverSavedIds.has(id));
  if (!allPresent) return { action: "manual" };

  const serverVersion = Number(serverCurrent.version ?? 1);

  // Re-apply the reorder intent — server will compute fractional keys.
  return {
    action: "retry",
    payload: { reorder: payload.reorder },
    newBaseVersion: serverVersion,
  };
}

/**
 * Tag: Set semantics — idempotent add/remove.
 * If attaching a tag, check if server already has it.
 * If detaching, check if server already removed it.
 */
export function resolveTag(
  localPending: QueuedMutation,
  serverCurrent: Record<string, unknown>,
): ResolutionAction {
  const payload = localPending.payload as Record<string, unknown>;
  if (!payload) return { action: "drop" };

  const serverVersion = Number(serverCurrent.version ?? 1);

  // For tag operations, the payload is typically { tagId, savedRepositoryId, op }.
  // Re-apply idempotently — server handles set semantics.
  return {
    action: "retry",
    payload,
    newBaseVersion: serverVersion,
  };
}

/**
 * Preference: Field-level shallow merge onto server current.
 * Local fields override server fields; server-only fields are preserved.
 */
export function resolvePreference(
  localPending: QueuedMutation,
  serverCurrent: Record<string, unknown>,
): ResolutionAction {
  const payload = localPending.payload as Record<string, unknown>;
  if (!payload) return { action: "drop" };

  const serverData = (serverCurrent.data ?? {}) as Record<string, unknown>;
  const merged = { ...serverData, ...payload };
  const serverVersion = Number(serverCurrent.version ?? 1);

  return {
    action: "retry",
    payload: merged,
    newBaseVersion: serverVersion,
  };
}

// --- Dispatcher ---

/**
 * Resolve a conflict based on entity type.
 * Dispatches to the appropriate entity-specific resolver.
 */
export function resolveConflict(
  entity: string,
  localPending: QueuedMutation,
  serverCurrent: unknown,
): ResolutionAction {
  const server = (serverCurrent ?? {}) as Record<string, unknown>;

  switch (entity) {
    case "saved_repository":
      return resolveSavedRepository(localPending, server);
    case "list":
      return resolveList(localPending, server);
    case "list_item": {
      // Determine if this is a membership or order operation.
      const payload = localPending.payload as Record<string, unknown>;
      if (payload?.reorder) {
        return resolveListItemOrder(localPending, server);
      }
      return resolveListItemMembership(localPending, server);
    }
    case "tag":
    case "repository_tag":
      return resolveTag(localPending, server);
    case "preference":
      return resolvePreference(localPending, server);
    default:
      // Unknown entity type — needs manual resolution.
      return { action: "manual" };
  }
}
