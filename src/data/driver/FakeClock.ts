// src/data/driver/FakeClock.ts
// Deterministic clock for tests — no real time, no sleep.

export interface Clock {
  /** Current time as ISO-8601 string. */
  now(): string;
  /** Advance clock by ms milliseconds. */
  advance(ms: number): void;
}

/**
 * Create a fake clock starting at `start` (default: epoch 0).
 * Deterministic: same start → same sequence of now() values.
 */
export function createFakeClock(start?: string): Clock {
  let cursor = start ? new Date(start).getTime() : 0;

  return {
    now() {
      return new Date(cursor).toISOString();
    },
    advance(ms: number) {
      cursor += ms;
    },
  };
}
