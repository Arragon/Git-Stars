// src/sync/idMap.ts
// Offline temp-id -> server-id resolution (M7-04 / INH-1702).
//
// A create performed offline keeps a local id (`pending:<uuid>`). Dependent mutations
// freeze their payload at enqueue time, so they must be rewritten to the authoritative
// server id before they are sent — including after a restart or a lost create ACK
// (the create is replayed idempotently and returns the same id).

import type { IdMapEntry } from "../data/types";

/**
 * Deep-rewrite every string that matches a temp id, leaving everything else untouched.
 * Payloads are shallow JSON objects (`{list_id, saved_repository_id}` etc.), so a
 * recursive walk is sufficient and keeps the helper independent of entity shapes.
 */
export function rewritePayloadWithIds<T>(
  payload: T,
  map: Map<string, string>,
): T {
  const walk = (value: unknown): unknown => {
    if (typeof value === "string") return map.get(value) ?? value;
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(value)) out[key] = walk(child);
      return out;
    }
    return value;
  };
  return walk(payload) as T;
}

export interface IdResolver {
  resolveRefs(refs: string[]): Promise<Map<string, string>>;
  record(entry: IdMapEntry): Promise<void>;
}

export interface IdMapStore {
  getIdMapEntry(tempId: string): Promise<IdMapEntry | undefined>;
  putIdMapEntry(entry: IdMapEntry): Promise<void>;
}

export function createIdResolver(store: IdMapStore): IdResolver {
  return {
    async resolveRefs(refs) {
      const map = new Map<string, string>();
      for (const ref of refs) {
        const entry = await store.getIdMapEntry(ref);
        if (entry) map.set(ref, entry.serverId);
      }
      return map;
    },
    async record(entry) {
      await store.putIdMapEntry(entry);
    },
  };
}
