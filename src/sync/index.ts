// src/sync/index.ts
// Sync module exports (INH-414, INH-419).

export { createMutationQueue, MAX_RETRY_COUNT } from "./mutationQueue";
export type { MutationQueue } from "./mutationQueue";
export { createPushReplay } from "./pushReplay";
export type {
  PushReplay,
  PushReplayConfig,
  PushResult,
  PushStatus,
  ApiClient,
  MutationResponse,
} from "./pushReplay";
export { createConflictLog } from "./conflictLog";
export type { ConflictLog, ConflictRecord } from "./conflictLog";
export {
  resolveConflict,
  resolveSavedRepository,
  resolveList,
  resolveListItemMembership,
  resolveListItemOrder,
  resolveTag,
  resolvePreference,
} from "./conflictResolvers";
export type { ResolutionAction } from "./conflictResolvers";
