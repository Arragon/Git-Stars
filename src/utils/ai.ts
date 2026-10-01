// src/utils/ai.ts
// Repo summarization via the configured AI provider (src/ai/client.ts handles
// vendor wire differences; the caller only sees plain text in → parsed JSON out).

import { useAiConfigStore } from "../store/useAiConfigStore";
import { aiChatComplete, AiClientError } from "../ai/client";

function truncateForError(text: string, maxLen: number = 240) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > maxLen
    ? `${normalized.slice(0, maxLen)}…`
    : normalized;
}

function stripCodeFences(text: string) {
  let t = text.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```[a-zA-Z0-9_-]*\n/, "");
    t = t.replace(/\n```$/, "");
  }
  return t.trim();
}

function extractJsonObject(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text;
}

function parseJsonObjectFromText(text: string) {
  const cleaned = stripCodeFences(text);
  try {
    return JSON.parse(cleaned);
  } catch {
    const extracted = extractJsonObject(cleaned);
    if (extracted !== cleaned) {
      try {
        return JSON.parse(extracted);
      } catch {
        // fall through
      }
    }
    throw new Error(
      `AI returned non-JSON content: ${truncateForError(cleaned) || "(empty)"}`,
    );
  }
}

export async function summarizeProject(
  name: string,
  description: string,
  language: string,
  existingTags: string[] = [],
) {
  const { config, isConfigured } = useAiConfigStore.getState();

  if (!isConfigured()) {
    throw new Error(
      "AI API is not configured. Please set your API key in the settings.",
    );
  }

  const outputLanguage = config.language || "Simplified Chinese";
  const existingTagsContext =
    existingTags.length > 0
      ? `\nYou may reuse these existing tags if they fit: ${existingTags.join(", ")}.`
      : "";

  const prompt = `You are an expert developer assistant. Please analyze the following GitHub project:
Name: ${name}
Description: ${description || "No description provided"}
Language: ${language || "Unknown"}

Please provide:
1. A concise one-sentence summary of the project in ${outputLanguage}, including its main purpose and key features.
2. Extract 2 to 4 ABSTRACT CATEGORY tags in ${outputLanguage} that classify what KIND of project this is — think "which shelf of a library would this sit on", not "what makes this project unique".

Tag rules (follow strictly):
- Each tag is a short, reusable category noun: a technical domain (e.g. 机器学习、网络代理、音视频、文档翻译、数据库、网络安全), a form factor (e.g. CLI 工具、GUI 应用、浏览器扩展、移动开发、自托管), or a stack layer (e.g. 前端组件、后端服务、运维部署).
- Each tag must be ≤ 6 Chinese characters (or ≤ 3 English words). One concept per tag — never pack a list of protocols, product names or features into a single tag.
- FORBIDDEN in tags: the project's own name, vendor/product names (e.g. "sing-box", "Xray"), specific protocol lists (e.g. "Trojan/Tuic/Juicity", "VMess/VLESS"), version names, or sentence fragments describing features.
- Wrong vs right example — for a web GUI client of a proxy suite:
  wrong: "Project V 图形客户端", "VMess/VLESS", "Trojan/Tuic/Juicity"
  right: "网络代理", "GUI 应用", "自托管"
- Wrong vs right example — for a deep-learning tuning handbook:
  wrong: "深度学习性能优化", "超参数调优", "MATLAB单文件实现"
  right: "深度学习", "机器学习", "学习资料"
- Prefer these common categories when they fit: 机器学习, 深度学习, 网络代理, 网络安全, 爬虫, 数据库, 后端服务, 前端组件, 移动开发, 桌面应用, CLI 工具, GUI 应用, 浏览器扩展, 自托管, 运维部署, 容器, 监控, 音视频, 图像处理, 文档翻译, 学习资料, 效率工具, 系统工具, 区块链, 游戏开发. If none fits, invent one at the same level of abstraction.${existingTagsContext}

You MUST return ONLY a valid JSON object in the following format, with no markdown formatting, no code blocks, and no additional text:
{
  "summary": "The one sentence summary.",
  "tags": ["Tag1", "Tag2"]
}`;

  try {
    const jsonString = await aiChatComplete(
      {
        presetId: config.presetId,
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model,
      },
      prompt,
      { jsonMode: true },
    );

    const result = parseJsonObjectFromText(jsonString);

    if (!result.summary || !Array.isArray(result.tags)) {
      throw new Error("Invalid response format from AI");
    }

    return {
      summary: result.summary,
      tags: result.tags,
    };
  } catch (error) {
    if (error instanceof AiClientError) {
      console.error("[AI Service] Summarization failed:", error.message);
      throw new Error(error.message);
    }
    console.error("[AI Service] Summarization failed:", error);
    throw error;
  }
}
