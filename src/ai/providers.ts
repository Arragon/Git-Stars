// src/ai/providers.ts
// Mainstream AI vendor catalog (presets). A preset gives everything needed so
// the user only enters an API key: wire protocol flavor, default base URL and
// model, plus — when the vendor supports it — the model-list endpoint used by
// the "获取模型列表" action. Relay/one-api style stations are OpenAI-compatible;
// the user supplies their own base URL.

export type AiApiFlavor = "openai" | "anthropic" | "gemini";

export type AiProviderGroup = "international" | "china" | "relay";

export interface AiProviderPreset {
  /** Stable id persisted in the config store. */
  id: string;
  label: string;
  group: AiProviderGroup;
  flavor: AiApiFlavor;
  baseUrl: string;
  defaultModel: string;
  /**
   * Model-list path relative to baseUrl, when the vendor exposes a list
   * endpoint. Absent → the UI shows manual model input only.
   */
  modelsPath?: string;
  keyPlaceholder?: string;
  hint?: string;
}

export const AI_PROVIDER_GROUP_LABELS: Record<AiProviderGroup, string> = {
  international: "国际厂商",
  china: "国内厂商",
  relay: "中转站 / 自定义",
};

export const AI_PROVIDER_PRESETS: AiProviderPreset[] = [
  // --- 国际厂商 ---
  {
    id: "openai",
    label: "OpenAI",
    group: "international",
    flavor: "openai",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    modelsPath: "/models",
    keyPlaceholder: "sk-...",
  },
  {
    id: "anthropic",
    label: "Anthropic Claude",
    group: "international",
    flavor: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-3-5-haiku-latest",
    modelsPath: "/models",
    keyPlaceholder: "sk-ant-...",
  },
  {
    id: "google",
    label: "Google Gemini",
    group: "international",
    flavor: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-2.0-flash",
    modelsPath: "/models",
    keyPlaceholder: "AIza...",
  },
  {
    id: "xai",
    label: "xAI Grok",
    group: "international",
    flavor: "openai",
    baseUrl: "https://api.x.ai/v1",
    defaultModel: "grok-3-mini",
    modelsPath: "/models",
  },
  {
    id: "mistral",
    label: "Mistral AI",
    group: "international",
    flavor: "openai",
    baseUrl: "https://api.mistral.ai/v1",
    defaultModel: "mistral-small-latest",
    modelsPath: "/models",
  },
  {
    id: "groq",
    label: "Groq",
    group: "international",
    flavor: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    modelsPath: "/models",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    group: "international",
    flavor: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openrouter/auto",
    modelsPath: "/models",
  },

  // --- 国内厂商 ---
  {
    id: "deepseek",
    label: "DeepSeek",
    group: "china",
    flavor: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    modelsPath: "/models",
    keyPlaceholder: "sk-...",
  },
  {
    id: "moonshot",
    label: "月之暗面 Kimi",
    group: "china",
    flavor: "openai",
    baseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "moonshot-v1-8k",
    modelsPath: "/models",
  },
  {
    id: "zhipu",
    label: "智谱 GLM",
    group: "china",
    flavor: "openai",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4-flash",
  },
  {
    id: "dashscope",
    label: "阿里通义千问 (DashScope)",
    group: "china",
    flavor: "openai",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
    modelsPath: "/models",
  },
  {
    id: "minimax",
    label: "MiniMax",
    group: "china",
    flavor: "openai",
    baseUrl: "https://aigc.x-see.cn/v1",
    defaultModel: "MiniMax-M2.5",
  },
  {
    id: "siliconflow",
    label: "硅基流动 SiliconFlow",
    group: "china",
    flavor: "openai",
    baseUrl: "https://api.siliconflow.cn/v1",
    defaultModel: "Qwen/Qwen2.5-7B-Instruct",
    modelsPath: "/models",
  },
  {
    id: "ark",
    label: "火山方舟 (豆包)",
    group: "china",
    flavor: "openai",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    defaultModel: "doubao-1.5-pro-32k-250115",
    hint: "模型名也可填接入点 ID（ep-xxx），在方舟控制台获取。",
  },
  {
    id: "hunyuan",
    label: "腾讯混元",
    group: "china",
    flavor: "openai",
    baseUrl: "https://api.hunyuan.cloud.tencent.com/v1",
    defaultModel: "hunyuan-turbos-latest",
  },
  {
    id: "qianfan",
    label: "百度千帆",
    group: "china",
    flavor: "openai",
    baseUrl: "https://qianfan.baidubce.com/v2",
    defaultModel: "ernie-4.0-turbo-8k",
  },

  // --- 中转站 / 自定义 ---
  {
    id: "custom-openai",
    label: "OpenAI 兼容中转站",
    group: "relay",
    flavor: "openai",
    baseUrl: "",
    defaultModel: "",
    modelsPath: "/models",
    keyPlaceholder: "中转站令牌",
    hint: "适用于 one-api / new-api 等中转站：填入站点地址（通常以 /v1 结尾）。若站点实现了模型列表接口，可直接拉取。",
  },
  {
    id: "custom",
    label: "完全自定义",
    group: "relay",
    flavor: "openai",
    baseUrl: "",
    defaultModel: "",
    hint: "手动填写 Base URL 与模型名，按 OpenAI 兼容协议调用。",
  },
];

export function getPreset(id: string): AiProviderPreset | undefined {
  return AI_PROVIDER_PRESETS.find((p) => p.id === id);
}

export function presetSupportsModelListing(id: string): boolean {
  const preset = getPreset(id);
  return Boolean(preset?.modelsPath);
}

/** Legacy store provider ids → preset ids (config store v0 → v1 migration). */
export const LEGACY_PROVIDER_TO_PRESET: Record<string, string> = {
  openai: "openai",
  google: "google",
  claude: "anthropic",
  minimax: "minimax",
  custom: "custom-openai",
};
