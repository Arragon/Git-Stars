// src/data/driver/NetworkFaultDriver.ts
// Deterministic network fault injector for sync/mutation testing.

/**
 * Simple seeded PRNG (mulberry32). Deterministic: same seed → same sequence.
 */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface NetworkFaultConfig {
  /** All requests fail with a network error. */
  offline?: boolean;
  /** All requests hang (never resolve). */
  timeout?: boolean;
  /** Mutation responses dropped — request sent but no response ever arrives. */
  dropAck?: boolean;
  /** Artificial delay added to every request (ms). */
  latencyMs?: number;
  /** Batch requests fail randomly with deterministic seed. */
  partialBatchFailure?: {
    rate: number; // 0–1
    seed: number;
  };
}

export interface FaultInjector {
  configure(config: NetworkFaultConfig): void;
  reset(): void;
  /** Wrap a fetch-like function with fault injection. */
  wrapFetch(fetchFn: typeof fetch): typeof fetch;
  /** Deterministic random in [0, 1) based on configured seed. */
  deterministicRandom(): number;
}

export function createFaultInjector(): FaultInjector {
  let config: NetworkFaultConfig = {};
  let rng: () => number = Math.random;

  function reseed() {
    const seed = config.partialBatchFailure?.seed ?? 0;
    rng = mulberry32(seed);
  }

  return {
    configure(next: NetworkFaultConfig) {
      config = { ...next };
      reseed();
    },

    reset() {
      config = {};
      rng = Math.random;
    },

    deterministicRandom() {
      return rng();
    },

    wrapFetch(fetchFn: typeof fetch): typeof fetch {
      return (async (input: RequestInfo | URL, init?: RequestInit) => {
        // offline → immediate network error
        if (config.offline) {
          throw new TypeError("Failed to fetch (offline)");
        }

        // timeout → never resolves
        if (config.timeout) {
          return new Promise<Response>(() => {
            // intentionally never resolves
          });
        }

        // dropAck → mutation requests (POST/PUT/PATCH/DELETE) never respond
        if (config.dropAck && init?.method && init.method !== "GET") {
          return new Promise<Response>(() => {
            // intentionally never resolves
          });
        }

        // partialBatchFailure → random failure per request
        if (config.partialBatchFailure) {
          const roll = rng();
          if (roll < config.partialBatchFailure.rate) {
            throw new TypeError("Failed to fetch (partial batch failure)");
          }
        }

        // latency → artificial delay
        if (config.latencyMs && config.latencyMs > 0) {
          await new Promise((r) => setTimeout(r, config.latencyMs));
        }

        return fetchFn(input, init);
      }) as typeof fetch;
    },
  };
}
