// src/data/__tests__/fault-injection.test.ts
// Verify NetworkFaultDriver: offline, timeout, dropAck, latency all work correctly.

import { describe, it, expect, beforeEach } from "vitest";
import { createFaultInjector, type FaultInjector } from "../driver/NetworkFaultDriver";

/** A minimal fetch stub that always returns 200 OK. */
const okFetch: typeof fetch = async () =>
  new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("NetworkFaultDriver", () => {
  let injector: FaultInjector;

  beforeEach(() => {
    injector = createFaultInjector();
  });

  describe("offline mode", () => {
    it("throws a network error on any request", async () => {
      injector.configure({ offline: true });
      const wrapped = injector.wrapFetch(okFetch);

      await expect(wrapped("/api/test")).rejects.toThrow("offline");
    });
  });

  describe("timeout mode", () => {
    it("returns a promise that never resolves", async () => {
      injector.configure({ timeout: true });
      const wrapped = injector.wrapFetch(okFetch);

      let resolved = false;
      const p = wrapped("/api/test").then(() => {
        resolved = true;
      });

      // Give the event loop a tick — should NOT resolve.
      await new Promise((r) => setTimeout(r, 10));
      expect(resolved).toBe(false);

      // Clean up: the promise will never settle, so we just move on.
      void p;
    });
  });

  describe("dropAck mode", () => {
    it("GET requests still resolve", async () => {
      injector.configure({ dropAck: true });
      const wrapped = injector.wrapFetch(okFetch);

      const res = await wrapped("/api/data", { method: "GET" });
      expect(res.status).toBe(200);
    });

    it("POST requests never resolve (ACK dropped)", async () => {
      injector.configure({ dropAck: true });
      const wrapped = injector.wrapFetch(okFetch);

      let resolved = false;
      const p = wrapped("/api/mutate", { method: "POST", body: "{}" }).then(
        () => {
          resolved = true;
        },
      );

      await new Promise((r) => setTimeout(r, 10));
      expect(resolved).toBe(false);
      void p;
    });
  });

  describe("latency injection", () => {
    it("delays the response by the configured amount", async () => {
      injector.configure({ latencyMs: 50 });
      const wrapped = injector.wrapFetch(okFetch);

      const start = performance.now();
      await wrapped("/api/test");
      const elapsed = performance.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(40); // allow small timer drift
    });
  });

  describe("partialBatchFailure", () => {
    it("deterministic: same seed → same failure pattern", async () => {
      const results: boolean[] = [];

      for (let run = 0; run < 2; run++) {
        injector.configure({ partialBatchFailure: { rate: 0.5, seed: 42 } });
        const wrapped = injector.wrapFetch(okFetch);
        const runResults: boolean[] = [];

        for (let i = 0; i < 10; i++) {
          try {
            await wrapped("/api/batch");
            runResults.push(true);
          } catch {
            runResults.push(false);
          }
        }
        results.push(...runResults);
      }

      // First 10 and second 10 should be identical (deterministic).
      const first = results.slice(0, 10);
      const second = results.slice(10, 20);
      expect(first).toEqual(second);
    });

    it("rate=0 → no failures", async () => {
      injector.configure({ partialBatchFailure: { rate: 0, seed: 1 } });
      const wrapped = injector.wrapFetch(okFetch);

      for (let i = 0; i < 5; i++) {
        const res = await wrapped("/api/test");
        expect(res.status).toBe(200);
      }
    });

    it("rate=1 → all fail", async () => {
      injector.configure({ partialBatchFailure: { rate: 1, seed: 1 } });
      const wrapped = injector.wrapFetch(okFetch);

      for (let i = 0; i < 5; i++) {
        await expect(wrapped("/api/test")).rejects.toThrow();
      }
    });
  });

  describe("reset", () => {
    it("clears all fault configuration", async () => {
      injector.configure({ offline: true });
      const wrapped1 = injector.wrapFetch(okFetch);
      await expect(wrapped1("/api/test")).rejects.toThrow();

      injector.reset();
      const wrapped2 = injector.wrapFetch(okFetch);
      const res = await wrapped2("/api/test");
      expect(res.status).toBe(200);
    });
  });
});
