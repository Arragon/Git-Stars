// src/utils/cacheRecovery.ts
// Classification of local-cache open/migrate failures (INH-406).

import { UnsupportedVersionError } from "../data";

export type CacheErrorKind = "unsupported" | "corrupt";

export function classifyCacheError(err: unknown): CacheErrorKind {
  if (err instanceof UnsupportedVersionError) return "unsupported";
  // Raw IndexedDB VersionError: the existing cache was written with a newer
  // schema version than this build supports.
  if ((err as { name?: string })?.name === "VersionError") return "unsupported";
  return "corrupt";
}
