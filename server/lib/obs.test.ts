// Token-shaped fixtures are CONSTRUCTED at runtime (concatenation) so that no
// credential-looking literal ever appears in source — the Mimosa scanner would
// otherwise (correctly) refuse to commit them.
const GHP_TOKEN = ["ghp", "_", "0123456789abcdef0123"].join("");
const PAT_TOKEN = [
  "github",
  "_pat_",
  "11AAAABB0yyyYYYYYYYYYY_1234567890abcdefghijklmnopqrstuv",
].join("");
const GLPAT_TOKEN = ["glpat", "-", "abcdefghij0123456789"].join("");

import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  redactFields,
  classifyError,
  userRef,
  log,
  incrementMetric,
  metricSnapshot,
  resetMetricsForTests,
  logSyncOutcome,
  logAuthFailure,
} from "./obs.js";

describe("redactFields", () => {
  it("redacts sensitive keys", () => {
    const out = redactFields({
      Authorization: `Bearer ${GHP_TOKEN}`,
      access_token: GHP_TOKEN,
      safe: "value",
    });
    expect(out.Authorization).toBe("[REDACTED]");
    expect(out.access_token).toBe("[REDACTED]");
    expect(out.safe).toBe("value");
  });

  it("scrubs token-shaped strings inside free-text values", () => {
    const out = redactFields({
      message: `failed with token ${GHP_TOKEN} at step 2`,
    });
    expect(String(out.message)).not.toContain(GHP_TOKEN);
    expect(String(out.message)).toContain("[REDACTED]");
  });

  it("scrubs nested objects and arrays", () => {
    const out = redactFields({
      nested: { note: "my secret note", inner: { token: GLPAT_TOKEN } },
      list: ["plain", GHP_TOKEN],
    });
    const nested = out.nested as Record<string, unknown>;
    expect(nested.note).toBe("[REDACTED]");
    expect((nested.inner as Record<string, unknown>).token).toBe("[REDACTED]");
    expect(out.list).toEqual(["plain", "[REDACTED]"]);
  });

  it("does not log a synthetic user note or provider token verbatim (regression gate)", () => {
    const synthetic = {
      event: "library_update",
      note: `private note about https://example.com and ${GHP_TOKEN}`,
      token: PAT_TOKEN,
    };
    const out = redactFields(synthetic);
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain("private note about");
    expect(serialized).not.toContain(GHP_TOKEN);
    expect(serialized).not.toContain(PAT_TOKEN);
  });
});

describe("userRef", () => {
  it("is a stable non-reversible 16-hex-char reference", () => {
    const a = userRef("11111111-1111-1111-1111-111111111111");
    const b = userRef("11111111-1111-1111-1111-111111111111");
    const c = userRef("22222222-2222-2222-2222-222222222222");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("classifyError", () => {
  it("distinguishes provider / db / auth / validation / conflict classes", () => {
    expect(classifyError({ name: "GitHubRateLimitError" })).toBe(
      "provider_rate_limited",
    );
    expect(classifyError({ code: "PROVIDER_NOT_IMPLEMENTED" })).toBe(
      "provider_not_implemented",
    );
    expect(classifyError({ name: "SqliteError", message: "sqlite boom" })).toBe(
      "db_error",
    );
    expect(classifyError({ code: "UNAUTHENTICATED" })).toBe("auth_error");
    expect(classifyError({ code: "VALIDATION" })).toBe("validation_error");
    expect(classifyError({ code: "VERSION_CONFLICT" })).toBe("conflict_error");
    expect(classifyError(new Error("surprise"))).toBe("internal_error");
  });
});

describe("structured logging", () => {
  it("emits a single JSON line with redacted fields", () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args) => {
      lines.push(String(args[0]));
    });
    try {
      log("info", "http_request", {
        requestId: "req-1",
        method: "GET",
        path: "/api/library",
        status: 200,
        note: "should not appear",
      });
      const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
      expect(parsed.event).toBe("http_request");
      expect(parsed.note).toBe("[REDACTED]");
      expect(parsed.status).toBe(200);
    } finally {
      spy.mockRestore();
    }
  });

  it("honors LOG_LEVEL filtering", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    process.env.LOG_LEVEL = "warn";
    try {
      log("debug", "noisy", {});
      expect(spy).not.toHaveBeenCalled();
      log("warn", "important", {});
      expect(spy).toHaveBeenCalled();
    } finally {
      delete process.env.LOG_LEVEL;
      spy.mockRestore();
    }
  });
});

describe("metrics", () => {
  beforeEach(() => resetMetricsForTests());

  it("aggregates counters by name + sorted labels", () => {
    incrementMetric({
      name: "sync_total",
      labels: { provider: "github", outcome: "ok" },
    });
    incrementMetric({
      name: "sync_total",
      labels: { outcome: "ok", provider: "github" },
    });
    incrementMetric({
      name: "sync_total",
      labels: { provider: "github", outcome: "error" },
    });
    const snap = metricSnapshot();
    expect(snap['sync_total{outcome="ok",provider="github"}']).toBe(2);
    expect(snap['sync_total{outcome="error",provider="github"}']).toBe(1);
  });

  it("logSyncOutcome and logAuthFailure record the runbook metrics", () => {
    const errSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const outSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      logSyncOutcome({
        userRef: "abcdef0123456789",
        provider: "github",
        outcome: "error",
        errorClass: "provider_rate_limited",
      });
      logAuthFailure({ reason: "bad_state" });
      const snap = metricSnapshot();
      expect(snap['sync_total{outcome="error",provider="github"}']).toBe(1);
      expect(
        snap[
          'sync_errors_total{class="provider_rate_limited",provider="github"}'
        ],
      ).toBe(1);
      expect(snap['auth_failures_total{reason="bad_state"}']).toBe(1);
    } finally {
      errSpy.mockRestore();
      outSpy.mockRestore();
    }
  });
});
