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
      ? `\nYou may reuse these existing tags if they perfectly fit: ${existingTags.join(", ")}.`
      : "";

  const prompt = `You are an expert developer assistant. Please analyze the following GitHub project:
Name: ${name}
Description: ${description || "No description provided"}
Language: ${language || "Unknown"}

Please provide:
1. A concise one-sentence summary of the project in ${outputLanguage}, including its main purpose and key features.
2. Extract 2 to 4 highly specific identity tags in ${outputLanguage} that represent the project's exact domain, function, or standout features (e.g., "Markdown", "Translation", "Video Processing", "Database", "Vue Component"). Avoid overly generic tags like "Software" or "Tool".${existingTagsContext}

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
