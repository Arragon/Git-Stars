// src/store/useAiConfigStore.ts
// AI provider configuration, persisted in localStorage (the key is the user's
// own, stored on their own device; see security review L1). `presetId` picks a
// vendor preset from src/ai/providers.ts which supplies protocol flavor, base
// URL and default model so the user only enters an API key.

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { getPreset, LEGACY_PROVIDER_TO_PRESET } from "../ai/providers";

export interface AiConfig {
  presetId: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  language: string;
  /** Model ids fetched from the vendor's list endpoint (best-effort cache). */
  fetchedModels?: string[];
}

interface AiConfigState {
  config: AiConfig;
  setConfig: (config: Partial<AiConfig>) => void;
  /** Switch preset: apply its baseUrl/defaultModel unless explicitly overridden. */
  applyPreset: (presetId: string) => void;
  setFetchedModels: (models: string[]) => void;
  isConfigured: () => boolean;
}

const DEFAULT_PRESET_ID = "minimax";

function defaultsFor(presetId: string): { baseUrl: string; model: string } {
  const preset = getPreset(presetId);
  return {
    baseUrl: preset?.baseUrl ?? "",
    model: preset?.defaultModel ?? "",
  };
}

export const useAiConfigStore = create<AiConfigState>()(
  persist(
    (set, get) => ({
      config: {
        presetId: DEFAULT_PRESET_ID,
        ...defaultsFor(DEFAULT_PRESET_ID),
        apiKey: "",
        language: "Simplified Chinese",
      },
      setConfig: (newConfig) =>
        set((state) => ({ config: { ...state.config, ...newConfig } })),
      applyPreset: (presetId) =>
        set((state) => {
          const defaults = defaultsFor(presetId);
          return {
            config: {
              ...state.config,
              presetId,
              baseUrl: defaults.baseUrl,
              model: defaults.model,
              fetchedModels: undefined,
            },
          };
        }),
      setFetchedModels: (fetchedModels) =>
        set((state) => ({ config: { ...state.config, fetchedModels } })),
      isConfigured: () => {
        const { config } = get();
        return (
          config.apiKey.trim().length > 0 &&
          config.baseUrl.trim().length > 0 &&
          config.model.trim().length > 0
        );
      },
    }),
    {
      name: "ai-config-storage",
      version: 1,
      // v0 stored {provider: "openai"|"google"|"claude"|"minimax"|"custom"}.
      // Map legacy ids to preset ids, preserving the user's key/URL/model.
      migrate: (persisted) => {
        const legacy = persisted as {
          config?: {
            provider?: string;
            presetId?: string;
            baseUrl?: string;
            apiKey?: string;
            model?: string;
            language?: string;
          };
        };
        const old = legacy?.config;
        if (!old) {
          return {
            config: {
              presetId: DEFAULT_PRESET_ID,
              ...defaultsFor(DEFAULT_PRESET_ID),
              apiKey: "",
              language: "Simplified Chinese",
            },
          };
        }
        const presetId =
          old.presetId ??
          LEGACY_PROVIDER_TO_PRESET[old.provider ?? ""] ??
          DEFAULT_PRESET_ID;
        const defaults = defaultsFor(presetId);
        return {
          config: {
            presetId,
            // A legacy "custom" provider had a user-supplied URL — keep it.
            baseUrl: old.baseUrl?.trim() ? old.baseUrl : defaults.baseUrl,
            apiKey: old.apiKey ?? "",
            model: old.model?.trim() ? old.model : defaults.model,
            language: old.language ?? "Simplified Chinese",
          },
        };
      },
    },
  ),
);
