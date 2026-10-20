// src/utils/membership.test.ts
// M7-02 / INH-1698: membership picker tri-state + explicit diff (no accidental removal).

import { describe, expect, it } from "vitest";
import {
  groupOpsByList,
  initialDesired,
  planMembershipOps,
  triStateFor,
} from "./membership";

const memberships = new Map<string, Set<string>>([
  ["s1", new Set(["A"])],
  ["s2", new Set(["B"])],
]);

describe("triStateFor", () => {
  it("reports off / on / mixed across the selected repositories", () => {
    expect(triStateFor(memberships, ["s1"], "C")).toBe("off");
    expect(triStateFor(memberships, ["s1"], "A")).toBe("on");
    expect(triStateFor(memberships, ["s1", "s2"], "A")).toBe("mixed");
    expect(triStateFor(memberships, ["s1", "s2"], "B")).toBe("mixed");
  });
});

describe("initialDesired", () => {
  it("initializes every list from real membership (picker no longer opens unchecked)", () => {
    const desired = initialDesired(memberships, ["s1", "s2"], ["A", "B", "C"]);
    expect(desired.get("A")).toBe("mixed");
    expect(desired.get("B")).toBe("mixed");
    expect(desired.get("C")).toBe("off");
  });
});

describe("planMembershipOps", () => {
  it("only submits explicit changes: untouched memberships are never removed", () => {
    const desired = initialDesired(memberships, ["s1"], ["A", "C"]);
    // User adds C and leaves A untouched.
    desired.set("C", "on");
    expect(
      planMembershipOps({ memberships, savedIds: ["s1"], desired }),
    ).toEqual([{ listId: "C", savedId: "s1", op: "add" }]);
  });

  it("re-saving without edits produces zero operations", () => {
    const desired = initialDesired(memberships, ["s1"], ["A"]);
    expect(
      planMembershipOps({ memberships, savedIds: ["s1"], desired }),
    ).toEqual([]);
  });

  it("batch keeps per-repo ownership and adds the new list", () => {
    // s1 in A, s2 in B; user adds C for both.
    const desired = initialDesired(memberships, ["s1", "s2"], ["A", "B", "C"]);
    desired.set("C", "on");
    const ops = planMembershipOps({
      memberships,
      savedIds: ["s1", "s2"],
      desired,
    });
    expect(ops).toEqual([
      { listId: "C", savedId: "s1", op: "add" },
      { listId: "C", savedId: "s2", op: "add" },
    ]);
  });

  it("only-add mode never removes", () => {
    const desired = initialDesired(memberships, ["s1"], ["A"]);
    desired.set("A", "off");
    expect(
      planMembershipOps({
        memberships,
        savedIds: ["s1"],
        desired,
        addOnly: true,
      }),
    ).toEqual([]);
  });

  it("removes only the explicitly deselected list/repo pair", () => {
    const desired = new Map<string, "on" | "off" | "mixed">([
      ["A", "off"],
      ["B", "on"],
    ]);
    const ops = planMembershipOps({
      memberships: new Map([
        ["s1", new Set(["A", "B"])],
        ["s2", new Set(["B"])],
      ]),
      savedIds: ["s1", "s2"],
      desired,
    });
    expect(ops).toEqual([
      { listId: "A", savedId: "s1", op: "remove" },
      // s1 is already in B, so "on" is a no-op there; s2 stays in B untouched.
    ]);
  });

  it("mixed is treated as unchanged until the user resolves it", () => {
    const desired = initialDesired(memberships, ["s1", "s2"], ["A"]);
    expect(desired.get("A")).toBe("mixed");
    expect(
      planMembershipOps({ memberships, savedIds: ["s1", "s2"], desired }),
    ).toEqual([]);
  });
});

describe("groupOpsByList", () => {
  it("batches add/remove sets per list", () => {
    const groups = groupOpsByList([
      { listId: "A", savedId: "s1", op: "add" },
      { listId: "A", savedId: "s2", op: "remove" },
      { listId: "B", savedId: "s1", op: "add" },
    ]);
    expect(groups).toEqual([
      { listId: "A", add: ["s1"], remove: ["s2"] },
      { listId: "B", add: ["s1"], remove: [] },
    ]);
  });
});
