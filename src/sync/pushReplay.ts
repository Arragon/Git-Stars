// src/sync/pushReplay.ts
// Push replay engine (INH-414).
// Replays pending mutations from the queue to the server in order.
// Enhanced with conflict resolution (INH-419).

import type { IdMapEntry, QueuedMutation } from "../data/types";
import type { MutationQueue } from "./mutationQueue";
import type { ConflictLog } from "./conflictLog";
import { ApiError } from "../utils/api";
import { resolveConflict } from "./conflictResolvers";
import { rewritePayloadWithIds, type IdResolver } from "./idMap";

export type PushStatus = "idle" | "pushing" | "paused" | "error";

export type PushOutcome =
  | "completed"
  | "failed"
  | "quarantined"
  | "paused"
  | "stopped"
  /** Waiting for a referenced temp id to be ACKed; leave pending, keep processing. */
  | "blocked";

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
  /** Authoritative id returned by a create (M7-04 temp-id mapping). */
  id?: string;
}

export interface ApiClient {
  sendMutation(mutation: QueuedMutation): Promise<MutationResponse>;
}

export interface PushReplayConfig {
  mutationQueue: MutationQueue;
  apiClient: ApiClient;
  conflictLog?: ConflictLog;
  /** Resolves/records offline temp ids (M7-04). Without it, refs are sent as-is. */
  idResolver?: IdResolver;
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

/**
 * 409 payloads may be `{current: {...}, etag}` (current server contract) or a legacy
 * `"<id>:<version>"` string. Normalize to an object so resolvers never spread a string
 * into a garbage payload (M7-14 root cause).
 */
function normalizeConflictCurrent(details: unknown): Record<string, unknown> {
  if (!details) return {};
  const raw =
    typeof details === "object" && details !== null && "current" in details
      ? (details as { current?: unknown }).current
      : details;
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    const match = /:(\d+)$/.exec(raw);
    return { version: match ? Number(match[1]) : 0 };
  }
  return {};
}

export function createPushReplay(config: PushReplayConfig): PushReplay {
  const { mutationQueue, apiClient, conflictLog, idResolver, onStatusChange } =
    config;

  let paused = false;
  let _retryAfterMs = 0;

  function setStatus(status: PushStatus) {
    onStatusChange?.(status);
  }

  async function processMutation(
    mutation: QueuedMutation,
  ): Promise<PushOutcome> {
    // 1. Resolve temp ids referenced by the payload (M7-04). A dependent mutation stays
    // pending until its create is ACKed; unrelated queue items keep flowing.
    let outgoing = mutation;
    if (mutation.refs && mutation.refs.length > 0) {
      if (!idResolver) return "blocked";
      const resolved = await idResolver.resolveRefs(mutation.refs);
      // Only temp ids can block; a real id is already authoritative.
      const unresolved = mutation.refs.filter(
        (ref) => ref.startsWith("pending:") && !resolved.has(ref),
      );
      if (unresolved.length > 0) return "blocked";
      outgoing = {
        ...mutation,
        payload: rewritePayloadWithIds(mutation.payload, resolved),
      };
    }

    try {
      const response = await apiClient.sendMutation(outgoing);
      // 2. Persist the authoritative id produced by a create BEFORE dropping the queue
      // entry, so a crash between the two steps replays idempotently instead of losing
      // the mapping (M7-04).
      if (mutation.createsTempId && response.id) {
        const entry: IdMapEntry = {
          tempId: mutation.createsTempId,
          entity: mutation.entity,
          serverId: response.id,
          version: Number(response.version ?? 1),
          etag: response.etag,
          createdAt: new Date().toISOString(),
        };
        await idResolver?.record(entry);
      }
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

          case 404:
            // Target entity no longer exists (e.g. a permanently failed dependency).
            // Quarantine instead of blocking the whole queue behind it (M7-04).
            await mutationQueue.quarantine(
              mutation.id,
              `Not found: ${err.message}`,
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
            const serverCurrent = normalizeConflictCurrent(err.details);

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
        case "blocked":
          // Dependency not ACKed yet — leave pending, keep unrelated items flowing.
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

    setStatus(
      outcome === "blocked" ? "idle" : remaining === 0 ? "idle" : "error",
    );
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
