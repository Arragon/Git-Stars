// src/platform/index.ts
// Platform adapter resolution (ADR-0008 D2). v1 ships web only; desktop/mobile
// adapters are explicitly deferred — when they land, register them here behind
// runtime detection and keep every capability flag honest.

import { webPlatformAdapter, type PlatformAdapter } from "./web";

export { webPlatformAdapter };
export type { PlatformAdapter, SaveResult, SharePayload } from "./web";

let current: PlatformAdapter = webPlatformAdapter;

export function getPlatformAdapter(): PlatformAdapter {
  return current;
}

/** Test seam: swap the adapter for a fake with the same contract. */
export function setPlatformAdapter(adapter: PlatformAdapter): void {
  current = adapter;
}
