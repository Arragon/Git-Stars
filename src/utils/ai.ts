import { useAiConfigStore } from '../store/useAiConfigStore';

function truncateForError(text: string, maxLen: number = 240) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLen ? `${normalized.slice(0, maxLen)}…` : normalized;
}

function stripCodeFences(text: string) {
  let t = text.trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```[a-zA-Z0-9_-]*\n/, '');
    t = t.replace(/\n```$/, '');
  }
  return t.trim();
}

function extractJsonObject(text: string) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
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
    throw new Error(`AI returned non-JSON content: ${truncateForError(cleaned) || '(empty)'}`);
  }
}

async function readJsonResponse(response: Response) {
  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json') || contentType.includes('+json');
  if (isJson) return response.json();
  const text = await response.text();
  const snippet = truncateForError(text);
  throw new Error(`Expected JSON response but got ${contentType || 'unknown content-type'}: ${snippet || '(empty)'}`);
}

export async function summarizeProject(name: string, description: string, language: string, existingTags: string[] = []) {
  const { config, isConfigured } = useAiConfigStore.getState();
  
  if (!isConfigured()) {
    throw new Error('AI API is not configured. Please set your API key in the settings.');
  }

  const existingTagsContext = existingTags.length > 0 
    ? `\nYou may reuse these existing tags if they perfectly fit: ${existingTags.join(', ')}.`
    : '';

  const prompt = `You are an expert developer assistant. Please analyze the following GitHub project:
Name: ${name}
Description: ${description || 'No description provided'}
Language: ${language || 'Unknown'}

Please provide:
1. A concise one-sentence summary of the project in ${config.language || 'Simplified Chinese'}, including its main purpose and key features.
2. Extract 2 to 4 highly specific identity tags in ${config.language || 'Simplified Chinese'} that represent the project's exact domain, function, or standout features (e.g., "Markdown", "Translation", "Video Processing", "Database", "Vue Component"). Avoid overly generic tags like "Software" or "Tool".${existingTagsContext}

You MUST return ONLY a valid JSON object in the following format, with no markdown formatting, no code blocks, and no additional text:
{
  "summary": "The one sentence summary.",
  "tags": ["Tag1", "Tag2"]
}`;

  let endpoint = config.baseUrl;
  let headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  let body: any = {};

  // For OpenAI, MiniMax, and Custom (assuming OpenAI compatibility)
  if (['openai', 'minimax', 'custom'].includes(config.provider)) {
    if (!config.baseUrl?.trim()) {
      throw new Error('Base URL is required for the selected AI provider.');
    }
    if (!config.model?.trim()) {
      throw new Error('Model is required for the selected AI provider.');
    }
    // Ensure baseUrl ends without trailing slash and add chat/completions
    endpoint = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`;
    headers['Authorization'] = `Bearer ${config.apiKey}`;
    body = {
      model: config.model,
      messages: [
        { role: 'user', content: prompt }
      ],
      temperature: 0.3,
      response_format: { type: "json_object" }
    };
  } else if (config.provider === 'google') {
    if (!config.baseUrl?.trim()) {
      throw new Error('Base URL is required for the selected AI provider.');
    }
    if (!config.model?.trim()) {
      throw new Error('Model is required for the selected AI provider.');
    }
    // Gemini API
    endpoint = `${config.baseUrl.replace(/\/$/, '')}/models/${config.model}:generateContent?key=${config.apiKey}`;
    body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3 }
    };
  } else if (config.provider === 'claude') {
    if (!config.baseUrl?.trim()) {
      throw new Error('Base URL is required for the selected AI provider.');
    }
    if (!config.model?.trim()) {
      throw new Error('Model is required for the selected AI provider.');
    }
    // Anthropic API
    endpoint = `${config.baseUrl.replace(/\/$/, '')}/messages`;
    headers['x-api-key'] = config.apiKey;
    headers['anthropic-version'] = '2023-06-01';
    body = {
      model: config.model,
      max_tokens: 1024,
      temperature: 0.3,
      messages: [
        { role: 'user', content: prompt }
      ]
    };
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`API Error (${response.status}): ${errText}`);
    }

    const data = await readJsonResponse(response);
    let jsonString = '';

    if (['openai', 'minimax', 'custom'].includes(config.provider)) {
      jsonString = data?.choices?.[0]?.message?.content ?? '';
    } else if (config.provider === 'google') {
      jsonString = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    } else if (config.provider === 'claude') {
      jsonString = data?.content?.[0]?.text ?? '';
    }

    if (!jsonString) {
      throw new Error('Empty response from AI provider.');
    }

    const result = parseJsonObjectFromText(jsonString);
    
    if (!result.summary || !Array.isArray(result.tags)) {
      throw new Error('Invalid response format from AI');
    }

    return {
      summary: result.summary,
      tags: result.tags
    };
  } catch (error) {
    console.error('[AI Service] Summarization failed:', error);
    throw error;
  }
}
