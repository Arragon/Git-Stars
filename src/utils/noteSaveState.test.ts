// src/utils/noteSaveState.test.ts
// M7-14 / INH-1708: honest note-save states; a failed/conflicted save must not advance
// the cached version and must keep the draft.

import { describe, expect, it } from "vitest";
import {
  INITIAL_NOTE_SAVE,
  isConflictError,
  noteSaveReducer,
  noteStatusLabel,
  shouldAdvanceVersion,
  statusFromOutcome,
} from "./noteSaveState";

describe("noteSaveReducer", () => {
  it("walks save -> confirmed", () => {
    const saving = noteSaveReducer(INITIAL_NOTE_SAVE, { type: "save" });
    expect(saving.status).toBe("saving");
    expect(noteSaveReducer(saving, { type: "confirmed" }).status).toBe(
      "confirmed",
    );
  });

  it("keeps the draft on failure/conflict (status is explicit)", () => {
    expect(
      noteSaveReducer(INITIAL_NOTE_SAVE, { type: "failed", error: "boom" }),
    ).toEqual({ status: "failed", error: "boom" });
    expect(
      noteSaveReducer(INITIAL_NOTE_SAVE, { type: "conflict", error: "409" }),
    ).toEqual({ status: "conflict", error: "409" });
  });

  it("marks a locally buffered draft without claiming a server save", () => {
    const draft = noteSaveReducer(INITIAL_NOTE_SAVE, { type: "draft" });
    expect(draft.status).toBe("draft");
    expect(shouldAdvanceVersion("draft")).toBe(false);
    expect(noteStatusLabel("draft")).toContain("本地");
  });

  it("returns to idle when the user edits again", () => {
    const failed = noteSaveReducer(INITIAL_NOTE_SAVE, { type: "failed" });
    expect(noteSaveReducer(failed, { type: "edit" }).status).toBe("idle");
  });
});

describe("version advancement rule", () => {
  it("advances only after server confirmation", () => {
    expect(shouldAdvanceVersion("confirmed")).toBe(true);
    for (const status of [
      "idle",
      "saving",
      "pending",
      "failed",
      "conflict",
    ] as const) {
      expect(shouldAdvanceVersion(status)).toBe(false);
    }
  });
});

describe("statusFromOutcome", () => {
  it("maps a 409 to conflict, other errors to failed", () => {
    expect(
      statusFromOutcome({ confirmed: false, error: { status: 409 } }),
    ).toBe("conflict");
    expect(
      statusFromOutcome({ confirmed: false, error: { status: 500 } }),
    ).toBe("failed");
  });

  it("maps an unconfirmed offline write to pending (not confirmed)", () => {
    expect(statusFromOutcome({ confirmed: false })).toBe("pending");
    expect(statusFromOutcome({ confirmed: true })).toBe("confirmed");
  });

  it("distinguishes conflict errors by HTTP status", () => {
    expect(isConflictError({ status: 409 })).toBe(true);
    expect(isConflictError(new Error("VERSION_CONFLICT"))).toBe(false);
  });
});

describe("labels", () => {
  it("never claims success for pending/failed/conflict", () => {
    expect(noteStatusLabel("confirmed")).toBe("已保存");
    expect(noteStatusLabel("pending")).toContain("等待同步");
    expect(noteStatusLabel("failed")).toContain("失败");
    expect(noteStatusLabel("conflict")).toContain("冲突");
  });
});
