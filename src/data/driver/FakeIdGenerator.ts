// src/data/driver/FakeIdGenerator.ts
// Deterministic UUID generator for reproducible tests.

export interface IdGenerator {
  uuid(): string;
}

/**
 * Create a deterministic ID generator seeded with a string.
 * Same seed → same sequence of UUIDs every time.
 * Uses a simple counter-based approach with seed hashing for determinism.
 */
export function createDeterministicIdGenerator(seed: string): IdGenerator {
  // Simple hash of seed to initialize counter state
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  let counter = hash;

  return {
    uuid(): string {
      // Generate a UUID v4-like string deterministically from counter
      counter = (counter + 1) | 0;
      const hex = (n: number, len: number) =>
        Math.abs(n).toString(16).padStart(len, "0").slice(0, len);

      const a = hex(counter, 8);
      const b = hex(counter * 2654435761, 4); // Knuth multiplicative hash
      const c = hex(0x4000 | (counter & 0x0fff), 4); // version 4
      const d = hex(0x8000 | (counter & 0x3fff), 4); // variant 1
      const e = hex(counter * 1597334677, 12);

      return `${a}-${b}-${c}-${d}-${e}`;
    },
  };
}
