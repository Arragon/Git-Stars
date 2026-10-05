// src/ai/client.ts
// Normalized client for the configured AI provider. All mainstream vendors and
// OpenAI-compatible relays are reduced to two operations:
//   aiChatComplete(config, prompt, { jsonMode }) -> plain text
//   listAiModels(config) -> string[] (model ids)
// Wire differences (OpenAI vs Anthropic vs Gemini) are handled here so callers
// never see provider-specific payloads. The API key never leaves the browser
// except toward the vendor endpoint the user configured.

import { getPreset } from "./providers";

export interface AiClientConfig {
  presetId: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export class AiClientError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "AiClientError";
    this.status = status;
  }
}

function truncateForError(text: string, maxLen = 240): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > maxLen
    ? `${normalized.slice(0, maxLen)}…`
    : normalized;
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}${path}`;
}

function requireFields(cfg: AiClientConfig): void {
  if (!cfg.baseUrl.trim()) {
    throw new AiClientError("Base URL 未填写。");
  }
  if (!cfg.apiKey.trim()) {
    throw new AiClientError("API Key 未填写。");
  }
  if (!cfg.model.trim()) {
    throw new AiClientError("模型名未填写。");
  }
}

async function parseJsonOrThrow(
  response: Response,
): Promise<Record<string, unknown>> {
  const contentType = response.headers.get("content-type") || "";
  const isJson =
    contentType.includes("application/json") || contentType.includes("+json");
  let body: unknown = null;
  if (isJson) {
    body = await response.json().catch(() => null);
  } else {
    const text = await response.text();
    throw new AiClientError(
      `接口返回了非 JSON 响应（${contentType || "unknown content-type"}）：${truncateForError(text) || "(empty)"}`,
      response.status,
    );
  }
  if (!response.ok) {
    const errObj = body as { error?: { message?: string } } | null;
    const vendorMessage =
      errObj?.error?.message ?? JSON.stringify(body)?.slice(0, 200);
    throw new AiClientError(
      `API 错误（HTTP ${response.status}）：${vendorMessage ?? "无详情"}`,
      response.status,
    );
  }
  return (body ?? {}) as Record<string, unknown>;
}

// --- Chat completion (normalized) ---

export async function aiChatComplete(
  cfg: AiClientConfig,
  prompt: string,
  opts: { jsonMode?: boolean; temperature?: number } = {},
): Promise<string> {
  requireFields(cfg);
  const preset = getPreset(cfg.presetId);
  const flavor = preset?.flavor ?? "openai";
  const base = cfg.baseUrl.replace(/\/+$/, "");
  const temperature = opts.temperature ?? 0.3;

  if (flavor === "anthropic") {
    const response = await fetch(joinUrl(base, "/messages"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": cfg.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: 1024,
        temperature,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await parseJsonOrThrow(response);
    const content = data.content as
      Array<{ type?: string; text?: string }> | undefined;
    const text = (content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("");
    if (!text) throw new AiClientError("AI 返回了空内容。");
    return text;
  }

  if (flavor === "gemini") {
    const response = await fetch(
      joinUrl(base, `/models/${encodeURIComponent(cfg.model)}:generateContent`),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": cfg.apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature },
        }),
      },
    );
    const data = await parseJsonOrThrow(response);
    const candidates = data.candidates as
      Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined;
    const text = (candidates?.[0]?.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("");
    if (!text) throw new AiClientError("AI 返回了空内容。");
    return text;
  }

  // OpenAI-compatible (OpenAI + most vendors + relays).
  const buildBody = (jsonMode: boolean) => ({
    model: cfg.model,
    messages: [{ role: "user", content: prompt }],
    temperature,
    ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
  });
  let response = await fetch(joinUrl(base, "/chat/completions"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(buildBody(Boolean(opts.jsonMode))),
  });
  // Some relays/models reject response_format — retry once without it.
  if (opts.jsonMode && response.status === 400) {
    const errorText = await response.text().catch(() => "");
    if (/response_format|json_object/i.test(errorText)) {
      response = await fetch(joinUrl(base, "/chat/completions"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify(buildBody(false)),
      });
    } else {
      throw new AiClientError(
        `API 错误（HTTP 400）：${truncateForError(errorText) || "无详情"}`,
        400,
      );
    }
  }
  const data = await parseJsonOrThrow(response);
  const choices = data.choices as
    Array<{ message?: { content?: string } }> | undefined;
  const text = choices?.[0]?.message?.content ?? "";
  if (!text) throw new AiClientError("AI 返回了空内容。");
  return text;
}

// --- Model listing ---

export async function listAiModels(cfg: AiClientConfig): Promise<string[]> {
  requireFields(cfg);
  const preset = getPreset(cfg.presetId);
  const flavor = preset?.flavor ?? "openai";
  const modelsPath = preset?.modelsPath;
  if (!modelsPath) {
    throw new AiClientError("该厂商未提供模型列表接口，请手动填写模型名。");
  }
  const base = cfg.baseUrl.replace(/\/+$/, "");

  let ids: string[] = [];
  if (flavor === "gemini") {
    const response = await fetch(joinUrl(base, modelsPath), {
      headers: { "x-goog-api-key": cfg.apiKey },
    });
    const data = await parseJsonOrThrow(response);
    const models = data.models as
      | Array<{
          name?: string;
          supportedGenerationMethods?: string[];
        }>
      | undefined;
    ids = (models ?? [])
      .filter(
        (m) =>
          !m.supportedGenerationMethods ||
          m.supportedGenerationMethods.includes("generateContent"),
      )
      .map((m) => (m.name ?? "").replace(/^models\//, ""))
      .filter(Boolean);
  } else if (flavor === "anthropic") {
    const response = await fetch(joinUrl(base, modelsPath), {
      headers: {
        "x-api-key": cfg.apiKey,
        "anthropic-version": "2023-06-01",
      },
    });
    const data = await parseJsonOrThrow(response);
    const rows = data.data as Array<{ id?: string }> | undefined;
    ids = (rows ?? []).map((m) => m.id ?? "").filter(Boolean);
  } else {
    const response = await fetch(joinUrl(base, modelsPath), {
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
    });
    const data = await parseJsonOrThrow(response);
    const rows = data.data as Array<{ id?: string }> | undefined;
    ids = (rows ?? []).map((m) => m.id ?? "").filter(Boolean);
  }

  if (ids.length === 0) {
    throw new AiClientError(
      "模型列表为空：该接口可能不支持列出模型，请手动填写。",
    );
  }
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}
