// src/ai/ai.test.ts
// Unit tests for the vendor catalog and the normalized AI client. All network
// traffic is mocked; the key fixture is CONSTRUCTED at runtime so no
// credential-looking literal ever appears in source.

import { describe, expect, it, afterEach, vi } from "vitest";
import {
  AI_PROVIDER_PRESETS,
  getPreset,
  presetSupportsModelListing,
  LEGACY_PROVIDER_TO_PRESET,
} from "./providers";
import {
  aiChatComplete,
  listAiModels,
  AiClientError,
  type AiClientConfig,
} from "./client";

const FAKE_KEY = ["test", "-key-", "not-a-real-credential"].join("");

const cfg = (overrides: Partial<AiClientConfig> = {}): AiClientConfig => ({
  presetId: "openai",
  baseUrl: "https://relay.example/v1",
  apiKey: FAKE_KEY,
  model: "test-model",
  ...overrides,
});

describe("provider catalog", () => {
  it("has unique preset ids and valid groups", () => {
    const ids = AI_PROVIDER_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of AI_PROVIDER_PRESETS) {
      expect(["international", "china", "relay"]).toContain(p.group);
      expect(["openai", "anthropic", "gemini"]).toContain(p.flavor);
      expect(p.defaultModel.length > 0 || p.id.startsWith("custom")).toBe(true);
    }
  });

  it("covers mainstream international + china vendors and relays", () => {
    for (const id of [
      "openai",
      "anthropic",
      "google",
      "xai",
      "mistral",
      "groq",
      "openrouter",
      "deepseek",
      "moonshot",
      "zhipu",
      "dashscope",
      "minimax",
      "siliconflow",
      "ark",
      "hunyuan",
      "qianfan",
      "custom-openai",
      "custom",
    ]) {
      expect(getPreset(id), `missing preset ${id}`).toBeDefined();
    }
  });

  it("marks listing support only when modelsPath exists", () => {
    expect(presetSupportsModelListing("openai")).toBe(true);
    expect(presetSupportsModelListing("deepseek")).toBe(true);
    expect(presetSupportsModelListing("zhipu")).toBe(false);
    expect(presetSupportsModelListing("custom")).toBe(false);
  });

  it("maps every legacy store provider id to a preset", () => {
    for (const legacy of ["openai", "google", "claude", "minimax", "custom"]) {
      expect(getPreset(LEGACY_PROVIDER_TO_PRESET[legacy])).toBeDefined();
    }
  });
});

describe("aiChatComplete", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("normalizes OpenAI-compatible chat responses", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://relay.example/v1/chat/completions");
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe("test-model");
      expect(body.response_format).toEqual({ type: "json_object" });
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        `Bearer ${FAKE_KEY}`,
      );
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"summary":"s","tags":["t"]}' } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const text = await aiChatComplete(cfg(), "prompt", { jsonMode: true });
    expect(text).toBe('{"summary":"s","tags":["t"]}');
  });

  it("retries without response_format when a relay rejects it", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)));
      if (calls.length === 1) {
        return new Response(
          '{"error":{"message":"response_format unsupported"}}',
          { status: 400, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const text = await aiChatComplete(cfg(), "prompt", { jsonMode: true });
    expect(text).toBe("ok");
    expect(calls).toHaveLength(2);
    expect(calls[0].response_format).toBeDefined();
    expect(calls[1].response_format).toBeUndefined();
  });

  it("uses Anthropic wire format (x-api-key + version header, content blocks)", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://relay.example/v1/messages");
      const headers = init?.headers as Record<string, string>;
      expect(headers["x-api-key"]).toBe(FAKE_KEY);
      expect(headers["anthropic-version"]).toBe("2023-06-01");
      return new Response(
        JSON.stringify({
          content: [
            { type: "text", text: "hello " },
            { type: "text", text: "world" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const text = await aiChatComplete(cfg({ presetId: "anthropic" }), "prompt");
    expect(text).toBe("hello world");
  });

  it("uses Gemini wire format (x-goog-api-key header, candidates shape)", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe(
        "https://relay.example/v1beta/models/test-model:generateContent",
      );
      const headers = init?.headers as Record<string, string>;
      expect(headers["x-goog-api-key"]).toBe(FAKE_KEY);
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "gemini says hi" }] } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const text = await aiChatComplete(
      cfg({ presetId: "google", baseUrl: "https://relay.example/v1beta" }),
      "prompt",
    );
    expect(text).toBe("gemini says hi");
  });

  it("surfaces vendor error messages with the HTTP status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: { message: "invalid api key" } }),
            {
              status: 401,
              headers: { "content-type": "application/json" },
            },
          ),
      ),
    );
    await expect(aiChatComplete(cfg(), "prompt")).rejects.toThrow(
      /HTTP 401.*invalid api key/,
    );
  });
});

describe("listAiModels", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lists OpenAI-compatible models, deduped and sorted", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://relay.example/v1/models");
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        `Bearer ${FAKE_KEY}`,
      );
      return new Response(
        JSON.stringify({
          data: [{ id: "b-model" }, { id: "a-model" }, { id: "a-model" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const models = await listAiModels(cfg());
    expect(models).toEqual(["a-model", "b-model"]);
  });

  it("parses Gemini model names and keeps generateContent-capable entries", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            models: [
              {
                name: "models/gemini-2.0-flash",
                supportedGenerationMethods: ["generateContent"],
              },
              {
                name: "models/gemini-2.0-flash",
                supportedGenerationMethods: ["generateContent"],
              },
              {
                name: "models/embedding-001",
                supportedGenerationMethods: ["embedContent"],
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const models = await listAiModels(
      cfg({ presetId: "google", baseUrl: "https://relay.example/v1beta" }),
    );
    expect(models).toEqual(["gemini-2.0-flash"]);
  });

  it("throws a friendly error for presets without a listing endpoint", async () => {
    await expect(listAiModels(cfg({ presetId: "custom" }))).rejects.toThrow(
      AiClientError,
    );
  });

  it("wraps HTTP failures with the status code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("denied", { status: 403 })),
    );
    await expect(listAiModels(cfg())).rejects.toThrow(AiClientError);
  });
});
