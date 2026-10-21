// src/data/drafts.ts
// Local note drafts (M8-06). Drafts are keyed by account + entity so switching accounts
// never exposes another user's unfinished text, and are cleared on successful save.
// localStorage is intentional: drafts are tiny, must survive refresh, and need no schema.

const PREFIX = "gitstars:draft";

export type DraftKind = "saved_repository" | "list_item";

function key(ownerId: string, kind: DraftKind, entityId: string): string {
  return `${PREFIX}:${ownerId}:${kind}:${entityId}`;
}

export function saveDraft(
  ownerId: string,
  kind: DraftKind,
  entityId: string,
  value: string,
): void {
  try {
    if (!value) localStorage.removeItem(key(ownerId, kind, entityId));
    else localStorage.setItem(key(ownerId, kind, entityId), value);
  } catch {
    // storage unavailable — the in-memory editor state still holds the text
  }
}

export function readDraft(
  ownerId: string,
  kind: DraftKind,
  entityId: string,
): string | null {
  try {
    return localStorage.getItem(key(ownerId, kind, entityId));
  } catch {
    return null;
  }
}

export function clearDraft(
  ownerId: string,
  kind: DraftKind,
  entityId: string,
): void {
  try {
    localStorage.removeItem(key(ownerId, kind, entityId));
  } catch {
    // ignore
  }
}
