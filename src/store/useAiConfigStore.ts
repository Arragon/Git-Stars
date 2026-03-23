import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type AiProvider = 'openai' | 'google' | 'claude' | 'minimax' | 'custom';

export interface AiConfig {
  provider: AiProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  language: string;
}

interface AiConfigState {
  config: AiConfig;
  setConfig: (config: Partial<AiConfig>) => void;
  isConfigured: () => boolean;
}

const defaultConfigs: Record<AiProvider, Omit<AiConfig, 'apiKey' | 'provider' | 'language'>> = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-3.5-turbo' },
  google: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-pro' },
  claude: { baseUrl: 'https://api.anthropic.com/v1', model: 'claude-3-haiku-20240307' },
  minimax: { baseUrl: 'https://aigc.x-see.cn/v1', model: 'MiniMax-M2.5' },
  custom: { baseUrl: '', model: '' }
};

export const useAiConfigStore = create<AiConfigState>()(
  persist(
    (set, get) => ({
      config: {
        provider: 'minimax',
        baseUrl: defaultConfigs.minimax.baseUrl,
        apiKey: '',
        model: defaultConfigs.minimax.model,
        language: 'Simplified Chinese',
      },
      setConfig: (newConfig) => set((state) => {
        const merged = { ...state.config, ...newConfig };
        // If provider changed and baseUrl/model weren't explicitly provided, apply defaults
        if (newConfig.provider && newConfig.provider !== state.config.provider) {
          if (!newConfig.baseUrl) merged.baseUrl = defaultConfigs[newConfig.provider].baseUrl;
          if (!newConfig.model) merged.model = defaultConfigs[newConfig.provider].model;
        }
        return { config: merged };
      }),
      isConfigured: () => {
        const { config } = get();
        return config.apiKey.trim().length > 0;
      },
    }),
    {
      name: 'ai-config-storage',
    }
  )
);
