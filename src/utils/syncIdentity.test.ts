import { describe, expect, it } from "vitest";
import {
  IDENTITY_CONFLICT_MESSAGE,
  isIdentityConflictError,
  resolveSyncIdentity,
} from "./syncIdentity";

describe("resolveSyncIdentity", () => {
  it("allows a GitHub account without an existing local record", () => {
    expect(
      resolveSyncIdentity({
        githubId: "gh-1",
        sessionUserId: "user-1",
      }),
    ).toEqual({ status: "ok" });
  });

  it("allows an existing record belonging to the current session user", () => {
    expect(
      resolveSyncIdentity({
        githubId: "gh-1",
        sessionUserId: "user-1",
        existingUserId: "user-1",
      }),
    ).toEqual({ status: "ok" });
  });

  it("rejects an existing record belonging to another session user", () => {
    const decision = resolveSyncIdentity({
      githubId: "gh-1",
      sessionUserId: "user-1",
      existingUserId: "user-2",
    });

    expect(decision).toEqual({
      status: "conflict",
      code: "IDENTITY_CONFLICT",
      reason: "existing_record",
      message: IDENTITY_CONFLICT_MESSAGE,
    });
    expect(JSON.stringify(decision)).not.toContain("user-1");
    expect(JSON.stringify(decision)).not.toContain("user-2");
  });
});

describe("isIdentityConflictError", () => {
  it("recognizes backend identity conflict errors", () => {
    expect(
      isIdentityConflictError({
        code: "IDENTITY_CONFLICT",
        message: "GitHub account already linked to another user",
      }),
    ).toBe(true);
  });

  it("rejects unrelated or missing errors", () => {
    expect(isIdentityConflictError({ code: "UNAUTHENTICATED" })).toBe(false);
    expect(isIdentityConflictError({ code: "DB_WRITE_FAILED" })).toBe(false);
    expect(isIdentityConflictError(null)).toBe(false);
    expect(isIdentityConflictError(undefined)).toBe(false);
  });
});
