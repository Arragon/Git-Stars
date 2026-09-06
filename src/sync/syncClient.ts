// src/sync/syncClient.ts
// Production singleton wiring for sync modules.
// Connects mutationQueue, conflictLog, pushReplay, pullSync to localStore + API.

import { localStore } from "../data";
import type { QueuedMutation } from "../data/types";
import { createMutationQueue } from "./mutationQueue";
import { createConflictLog } from "./conflictLog";
import { createPushReplay } from "./pushReplay";
import { createPullSync } from "./pullSync";
import { getChanges } from "../utils/gitstarsApi";
import { apiPut, apiPost, apiDelete } from "../utils/api";
import type { MutationResponse } from "./pushReplay";

// --- Sync singletons ---

export const mutationQueue = createMutationQueue(localStore);
export const conflictLog = createConflictLog(localStore);

// --- API client for push replay ---

const syncApiClient = {
  async sendMutation(m: QueuedMutation): Promise<MutationResponse> {
    const headers: Record<string, string> = {
      "Idempotency-Key": m.id,
    };

    // Add If-Match for versioned entities
    if (m.baseVersion > 0) {
      headers["If-Match"] = String(m.baseVersion);
    }

    const payload = m.payload as Record<string, unknown>;

    switch (m.entity) {
      case "saved_repository": {
        if (m.operation === "create") {
          const res = await apiPost<{
            id: string;
            version: number;
            etag: string;
          }>("/api/library", payload, { headers });
          return { version: res.version, etag: res.etag };
        }
        if (m.operation === "delete") {
          await apiDelete(`/api/library/${m.entityId}`);
          return { version: 0, etag: "" };
        }
        // update
        const res = await apiPut<{ version: number; etag: string }>(
          `/api/library/${m.entityId}`,
          payload,
          { headers },
        );
        return { version: res.version, etag: res.etag };
      }

      case "list": {
        if (m.operation === "create") {
          const res = await apiPost<{
            id: string;
            version: number;
            etag: string;
          }>("/api/lists", payload, { headers });
          return { version: res.version, etag: res.etag };
        }
        if (m.operation === "delete") {
          await apiDelete(`/api/lists/${m.entityId}`);
          return { version: 0, etag: "" };
        }
        const res = await apiPut<{ version: number; etag: string }>(
          `/api/lists/${m.entityId}`,
          payload,
          { headers },
        );
        return { version: res.version, etag: res.etag };
      }

      case "list_item": {
        // list_id is in payload
        const listId = (payload.list_id as string) || m.entityId.split(":")[0];
        if (m.operation === "create") {
          const res = await apiPost<{ version: number; etag: string }>(
            `/api/lists/${listId}/items`,
            payload,
            { headers },
          );
          return { version: res.version ?? 1, etag: res.etag ?? "" };
        }
        if (m.operation === "delete") {
          await apiDelete(`/api/lists/${listId}/items`, {
            item_ids: [m.entityId],
          });
          return { version: 0, etag: "" };
        }
        const res = await apiPut<{ version: number; etag: string }>(
          `/api/lists/${listId}/items`,
          payload,
          { headers },
        );
        return { version: res.version ?? 1, etag: res.etag ?? "" };
      }

      case "tag": {
        if (m.operation === "create") {
          const res = await apiPost<{
            id: string;
            version: number;
            etag: string;
          }>("/api/tags", payload, { headers });
          return { version: res.version ?? 1, etag: res.etag ?? "" };
        }
        if (m.operation === "delete") {
          await apiDelete(`/api/tags/${m.entityId}`);
          return { version: 0, etag: "" };
        }
        return { version: m.baseVersion + 1, etag: "" };
      }

      case "repository_tag": {
        const savedId =
          (payload.saved_repository_id as string) || m.entityId.split(":")[0];
        const tagId = (payload.tag_id as string) || m.entityId.split(":")[1];
        if (m.operation === "create") {
          await apiPut(`/api/library/${savedId}/tags/${tagId}`, undefined, {
            headers,
          });
          return { version: 1, etag: "" };
        }
        if (m.operation === "delete") {
          await apiDelete(`/api/library/${savedId}/tags/${tagId}`);
          return { version: 0, etag: "" };
        }
        return { version: m.baseVersion + 1, etag: "" };
      }

      case "preference": {
        const res = await apiPut<{ version: number; etag: string }>(
          "/api/preferences",
          { data: payload },
          { headers },
        );
        return { version: res.version, etag: res.etag };
      }

      default:
        throw new Error(`Unhandled entity: ${m.entity}`);
    }
  },
};

// --- Push replay ---

export const pushReplay = createPushReplay({
  mutationQueue,
  apiClient: syncApiClient,
  conflictLog,
});

// --- Pull sync ---

export const pullSync = createPullSync({
  localStore,
  apiClient: {
    getChanges: (since, limit) => getChanges(since, limit),
  },
});
