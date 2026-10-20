// src/utils/noteSaveState.ts
// Note save state machine (M7-14 / INH-1708). Kept pure so the UI can drive an honest
// status line and the "failed/conflict must not advance the saved version" rule is
// testable without a component test runner.

export type NoteSaveStatus =
  | "idle"
  | "saving"
  | "saved-local"
  | "pending"
  | "confirmed"
  | "conflict"
  | "failed";

export interface NoteSaveState {
  status: NoteSaveStatus;
  error?: string;
}

export type NoteSaveEvent =
  | { type: "edit" }
  | { type: "save" }
  | { type: "confirmed" }
  | { type: "pending" }
  | { type: "conflict"; error?: string }
  | { type: "failed"; error?: string };

export const INITIAL_NOTE_SAVE: NoteSaveState = { status: "idle" };

export function noteSaveReducer(
  _state: NoteSaveState,
  event: NoteSaveEvent,
): NoteSaveState {
  switch (event.type) {
    case "edit":
      return { status: "idle" };
    case "save":
      return { status: "saving" };
    case "confirmed":
      return { status: "confirmed" };
    case "pending":
      return { status: "pending" };
    case "conflict":
      return { status: "conflict", error: event.error };
    case "failed":
      return { status: "failed", error: event.error };
  }
}

/** Only a server-confirmed save may advance the cached note version. */
export function shouldAdvanceVersion(status: NoteSaveStatus): boolean {
  return status === "confirmed";
}

export function isConflictError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { status?: number }).status === 409
  );
}

/** Classify a MutationOutcome-like result into the state machine's status. */
export function statusFromOutcome(outcome: {
  confirmed: boolean;
  error?: unknown;
}): NoteSaveStatus {
  if (outcome.error)
    return isConflictError(outcome.error) ? "conflict" : "failed";
  // Queued offline (or dependency-blocked): local draft is kept, version is not advanced.
  return outcome.confirmed ? "confirmed" : "pending";
}

export function noteStatusLabel(status: NoteSaveStatus): string {
  switch (status) {
    case "idle":
      return "失焦后自动保存";
    case "saving":
      return "保存中…";
    case "saved-local":
      return "已保存到本地";
    case "pending":
      return "已保存到本地，等待同步";
    case "confirmed":
      return "已保存";
    case "conflict":
      return "存在冲突，草稿已保留";
    case "failed":
      return "保存失败，草稿已保留";
  }
}
