// src/sync/pushReplay.ts
// Push replay engine (INH-414).
// Replays pending mutations from the queue to the server in order.
// Enhanced with conflict resolution (INH-419).

import type { QueuedMutation } from "../data/types";
import type { MutationQueue } from "./mutationQueue";
import type { ConflictLog } from "./conflictLog";
import { ApiError } from "../utils/api";
import { resolveConflict } from "./conflictResolvers";

export type PushStatus = "idle" | "pushing" | "paused" | "error";

export interface PushResult {
  completed: number;
  failed: number;
  quarantined: number;
  remaining: number;
}

export interface MutationResponse {
  version: number;
  etag: string;
  current?: unknown; // Server current state for conflict resolution
}

export interface ApiClient {
  sendMutation(mutation: QueuedMutation): Promise<MutationResponse>;
}

export interface PushReplayConfig {
  mutationQueue: MutationQueue;
  apiClient: ApiClient;
  conflictLog?: ConflictLog;
  onStatusChange?: (status: PushStatus) => void;
}

export interface PushReplay {
  replayAll(): Promise<PushResult>;
  replayOne(id: string): Promise<PushResult>;
  pause(): void;
  resume(): void;
}

// --- Preference coalesce (ADR-0004 D4) ---
// Only preference mutations may be coalesced (field-level merge).
// Consecutive preference mutations are merged into a single server call.

function coalescePreferences(mutations: QueuedMutation[]): QueuedMutation[] {
  const result: QueuedMutation[] = [];

  for (const m of mutations) {
    if (
      m.entity === "preference" &&
      m.operation === "update" &&
      result.length > 0
    ) {
      const last = result[result.length - 1];
      if (last.entity === "preference" && last.operation === "update") {
        // Merge payload (shallow merge of preference fields).
        const mergedPayload = {
          ...(last.payload as Record<string, unknown>),
          ...(m.payload as Record<string, unknown>),
        };
        result[result.length - 1] = {
          ...last,
          payload: mergedPayload,
          // Keep the original id for idempotency — the first mutation's key.
        };
        continue;
      }
    }
    result.push(m);
  }

  return result;
}

// --- Push replay implementation ---

export function createPushReplay(config: PushReplayConfig): PushReplay {
  const { mutationQueue, apiClient, conflictLog, onStatusChange } = config;

  let paused = false;
  let _retryAfterMs = 0;

  function setStatus(status: PushStatus) {
    onStatusChange?.(status);
  }

  async function processMutation(
    mutation: QueuedMutation,
  ): Promise<"completed" | "failed" | "quarantined" | "paused" | "stopped"> {
    try {
      await apiClient.sendMutation(mutation);
      await mutationQueue.complete(mutation.id);
      return "completed";
    } catch (err) {
      if (err instanceof ApiError) {
        switch (err.status) {
          case 400:
            // Validation error → permanent failure, quarantine.
            await mutationQueue.quarantine(
              mutation.id,
              `Validation error: ${err.message}`,
            );
            return "quarantined";

          case 401:
          case 403:
            // Session expired → pause, preserve queue.
            paused = true;
            setStatus("paused");
            return "paused";

          case 409: {
            // Version conflict — attempt auto-resolution via conflict resolvers (INH-419).
            const serverCurrent = err.details
              ? ((err.details as Record<string, unknown>).current ??
                err.details)
              : {};

            // Record conflict for audit/UI.
            const conflictId = await conflictLog?.record({
              entityType: mutation.entity,
              entityId: mutation.entityId,
              operation: mutation.operation,
              baseVersion: mutation.baseVersion,
              serverVersion: Number(
                (serverCurrent as Record<string, unknown>)?.version ?? 0,
              ),
              localPayload: mutation.payload,
              serverSnapshot: serverCurrent,
            });

            // Attempt auto-resolution.
            const resolution = resolveConflict(
              mutation.entity,
              mutation,
              serverCurrent,
            );

            switch (resolution.action) {
              case "retry": {
                // Update mutation with new payload and baseVersion, then retry.
                await mutationQueue.updateMutation(mutation.id, {
                  payload: resolution.payload,
                  baseVersion: resolution.newBaseVersion,
                });
                // Mark conflict as auto-resolved.
                if (conflictId && conflictLog) {
                  await conflictLog.markResolved(
                    conflictId,
                    resolution.payload,
                  );
                }
                // Retry immediately.
                try {
                  const updatedMutation = await mutationQueue
                    .getPending()
                    .then((all) => all.find((m) => m.id === mutation.id));
                  if (updatedMutation) {
                    await apiClient.sendMutation(updatedMutation);
                    await mutationQueue.complete(updatedMutation.id);
                    return "completed";
                  }
                } catch (retryErr) {
                  // Retry failed — fall through to mark as failed.
                  if (retryErr instanceof ApiError && retryErr.status !== 409) {
                    await mutationQueue.markFailed(
                      mutation.id,
                      `Retry failed: ${retryErr.message}`,
                    );
                    return "failed";
                  }
                  // Still 409 or other — mark failed for next cycle.
                  await mutationQueue.markFailed(
                    mutation.id,
                    `VERSION_CONFLICT after retry: ${err.message}`,
                  );
                  return "failed";
                }
                return "failed";
              }
              case "drop": {
                // Server already has the desired state — drop mutation.
                await mutationQueue.complete(mutation.id);
                if (conflictId && conflictLog) {
                  await conflictLog.markResolved(conflictId);
                }
                return "completed";
              }
              case "manual": {
                // Needs user intervention — quarantine mutation, leave conflict pending.
                await mutationQueue.quarantine(
                  mutation.id,
                  `MANUAL_RESOLUTION_REQUIRED: ${err.message}`,
                );
                return "quarantined";
              }
            }
            return "failed";
          }

          case 429: {
            // Rate limited → pause with Retry-After.
            const retryAfter = err.details
              ? Number((err.details as Record<string, unknown>).retryAfter) *
                1000
              : 60_000;
            _retryAfterMs = retryAfter || 60_000;
            paused = true;
            setStatus("paused");
            return "paused";
          }

          default:
            // 5xx or other → stop, preserve queue.
            return "stopped";
        }
      }

      // Network error or unknown → stop, preserve queue.
      return "stopped";
    }
  }

  async function replayAll(): Promise<PushResult> {
    paused = false;
    _retryAfterMs = 0;
    setStatus("pushing");

    const result: PushResult = {
      completed: 0,
      failed: 0,
      quarantined: 0,
      remaining: 0,
    };

    const pending = await mutationQueue.getPending();

    // Apply preference coalesce.
    const toProcess = coalescePreferences(pending);

    for (const mutation of toProcess) {
      if (paused) break;

      const outcome = await processMutation(mutation);

      switch (outcome) {
        case "completed":
          result.completed++;
          break;
        case "failed":
          result.failed++;
          break;
        case "quarantined":
          result.quarantined++;
          break;
        case "paused":
        case "stopped":
          // Stop processing; queue preserved.
          break;
      }

      if (outcome === "paused" || outcome === "stopped") break;
    }

    // Recount remaining.
    const stillPending = await mutationQueue.getPending();
    result.remaining = stillPending.length;

    if (result.remaining === 0) {
      setStatus("idle");
    } else if (paused) {
      setStatus("paused");
    } else if (result.failed > 0 || result.quarantined > 0) {
      setStatus("error");
    } else {
      setStatus("idle");
    }

    return result;
  }

  async function replayOne(id: string): Promise<PushResult> {
    setStatus("pushing");

    const all = await mutationQueue.getPending();
    const mutation = all.find((m) => m.id === id);

    if (!mutation) {
      setStatus("idle");
      return { completed: 0, failed: 0, quarantined: 0, remaining: all.length };
    }

    const outcome = await processMutation(mutation);

    const remaining = (await mutationQueue.getPending()).length;

    const result: PushResult = {
      completed: outcome === "completed" ? 1 : 0,
      failed: outcome === "failed" ? 1 : 0,
      quarantined: outcome === "quarantined" ? 1 : 0,
      remaining,
    };

    setStatus(remaining === 0 ? "idle" : "error");
    return result;
  }

  function pause() {
    paused = true;
    setStatus("paused");
  }

  function resume() {
    paused = false;
    _retryAfterMs = 0;
    setStatus("idle");
  }

  return {
    replayAll,
    replayOne,
    pause,
    resume,
  };
}
