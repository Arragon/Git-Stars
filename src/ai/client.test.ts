// src/ai/client.test.ts
// M8-08: AI requests must be cancellable and time-bounded, and cancellation must be
// distinguishable from a provider failure.

import { afterEach, describe, expect, it, vi } from "vitest";
import { AiAbortError, AiClientError, aiChatComplete } from "./client";

const cfg = {
  presetId: "openai",
  baseUrl: "https://api.example.com/v1",
  apiKey: "test-key",
  model: "test-model",
};

function abortableFetch(): void {
  vi.stubGlobal(
    "fetch",
    (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      }),
  );
}

describe("aiChatComplete (M8-08)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the assistant text on success", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "hello" } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    await expect(aiChatComplete(cfg, "hi")).resolves.toBe("hello");
  });

  it("throws AiAbortError when the caller aborts", async () => {
    abortableFetch();
    const controller = new AbortController();
    const pending = aiChatComplete(cfg, "hi", { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(AiAbortError);
  });

  it("times out with a retryable AiClientError", async () => {
    abortableFetch();
    const pending = aiChatComplete(cfg, "hi", { timeoutMs: 20 });
    await expect(pending).rejects.toBeInstanceOf(AiClientError);
    await expect(pending).rejects.toThrow(/超时|timeout/i);
  });

  it("classifies provider HTTP errors with their status", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ error: { message: "bad key" } }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
    );
    await expect(aiChatComplete(cfg, "hi")).rejects.toMatchObject({
      status: 401,
    });
  });
});
