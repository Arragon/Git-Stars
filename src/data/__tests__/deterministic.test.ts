// src/data/__tests__/deterministic.test.ts
// Verify same seed → same results across runs for clock, ID generator, and fault injector.

import { describe, it, expect } from "vitest";
import { createFakeClock } from "../driver/FakeClock";
import { createDeterministicIdGenerator } from "../driver/FakeIdGenerator";
import { createFaultInjector } from "../driver/NetworkFaultDriver";

describe("Deterministic primitives", () => {
  describe("FakeClock", () => {
    it("same start → same sequence", () => {
      const c1 = createFakeClock("2024-06-01T12:00:00.000Z");
      const c2 = createFakeClock("2024-06-01T12:00:00.000Z");

      expect(c1.now()).toBe(c2.now());
      c1.advance(5000);
      c2.advance(5000);
      expect(c1.now()).toBe(c2.now());
    });

    it("advance is additive and correct", () => {
      const clock = createFakeClock("2024-01-01T00:00:00.000Z");
      expect(clock.now()).toBe("2024-01-01T00:00:00.000Z");

      clock.advance(3600_000); // +1 hour
      expect(clock.now()).toBe("2024-01-01T01:00:00.000Z");

      clock.advance(1000); // +1 second
      expect(clock.now()).toBe("2024-01-01T01:00:01.000Z");
    });

    it("default start is epoch 0", () => {
      const clock = createFakeClock();
      expect(clock.now()).toBe("1970-01-01T00:00:00.000Z");
    });
  });

  describe("FakeIdGenerator", () => {
    it("same seed → same UUID sequence", () => {
      const gen1 = createDeterministicIdGenerator("test-seed");
      const gen2 = createDeterministicIdGenerator("test-seed");

      const ids1 = Array.from({ length: 5 }, () => gen1.uuid());
      const ids2 = Array.from({ length: 5 }, () => gen2.uuid());

      expect(ids1).toEqual(ids2);
    });

    it("different seed → different UUID sequence", () => {
      const gen1 = createDeterministicIdGenerator("seed-a");
      const gen2 = createDeterministicIdGenerator("seed-b");

      const ids1 = Array.from({ length: 5 }, () => gen1.uuid());
      const ids2 = Array.from({ length: 5 }, () => gen2.uuid());

      expect(ids1).not.toEqual(ids2);
    });

    it("generates unique IDs within a single generator", () => {
      const gen = createDeterministicIdGenerator("unique-test");
      const ids = new Set(Array.from({ length: 100 }, () => gen.uuid()));
      expect(ids.size).toBe(100);
    });

    it("IDs match UUID v4 format", () => {
      const gen = createDeterministicIdGenerator("format-test");
      const uuid = gen.uuid();
      // UUID format: 8-4-4-4-12 hex chars
      expect(uuid).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });
  });

  describe("FaultInjector determinism", () => {
    it("same seed → same partialBatchFailure pattern across runs", () => {
      // Note: due to async nature, we test the deterministicRandom directly
      const inj1 = createFaultInjector();
      inj1.configure({ partialBatchFailure: { rate: 0.5, seed: 99 } });
      const seq1 = Array.from({ length: 10 }, () => inj1.deterministicRandom());

      const inj2 = createFaultInjector();
      inj2.configure({ partialBatchFailure: { rate: 0.5, seed: 99 } });
      const seq2 = Array.from({ length: 10 }, () => inj2.deterministicRandom());

      expect(seq1).toEqual(seq2);
    });
  });
});
