// src/utils/membership.ts
// List membership planning (M7-02 / INH-1698). Pure functions so the tri-state picker,
// explicit diff and "only add" mode are testable without a component test runner.
//
// Rules:
//  - the picker starts from the REAL current membership (server/cache);
//  - saving submits only explicit changes (untouched memberships are never removed);
//  - batch edits support mixed state (some selected repos are already in the list);
//  - "only add" mode never sends a removal.

export type TriState = "on" | "off" | "mixed";

export interface MembershipOp {
  listId: string;
  savedId: string;
  op: "add" | "remove";
}

export interface MembershipOpGroup {
  listId: string;
  add: string[];
  remove: string[];
}

/** Current state of one list across the selected repositories. */
export function triStateFor(
  memberships: Map<string, Set<string>>,
  savedIds: string[],
  listId: string,
): TriState {
  if (savedIds.length === 0) return "off";
  let inCount = 0;
  for (const id of savedIds) {
    if (memberships.get(id)?.has(listId)) inCount += 1;
  }
  if (inCount === 0) return "off";
  return inCount === savedIds.length ? "on" : "mixed";
}

export function initialDesired(
  memberships: Map<string, Set<string>>,
  savedIds: string[],
  listIds: string[],
): Map<string, TriState> {
  const desired = new Map<string, TriState>();
  for (const listId of listIds) {
    desired.set(listId, triStateFor(memberships, savedIds, listId));
  }
  return desired;
}

/**
 * Compute the explicit add/remove set. `mixed` means "leave as is" unless the caller
 * resolved it (the UI toggles mixed -> on/off explicitly).
 */
export function planMembershipOps(params: {
  memberships: Map<string, Set<string>>;
  savedIds: string[];
  desired: Map<string, TriState>;
  addOnly?: boolean;
}): MembershipOp[] {
  const { memberships, savedIds, desired, addOnly = false } = params;
  const ops: MembershipOp[] = [];

  for (const [listId, want] of desired) {
    if (want === "mixed") continue;
    for (const savedId of savedIds) {
      const has = memberships.get(savedId)?.has(listId) ?? false;
      if (want === "on" && !has) ops.push({ listId, savedId, op: "add" });
      if (want === "off" && has && !addOnly) {
        ops.push({ listId, savedId, op: "remove" });
      }
    }
  }
  return ops;
}

/** One request per affected list (the server route accepts add/remove sets). */
export function groupOpsByList(ops: MembershipOp[]): MembershipOpGroup[] {
  const groups = new Map<string, MembershipOpGroup>();
  for (const op of ops) {
    const group = groups.get(op.listId) ?? {
      listId: op.listId,
      add: [],
      remove: [],
    };
    if (op.op === "add") group.add.push(op.savedId);
    else group.remove.push(op.savedId);
    groups.set(op.listId, group);
  }
  return [...groups.values()];
}
