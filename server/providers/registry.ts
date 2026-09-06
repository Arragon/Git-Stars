import { githubProvider } from "./github/index.js";
import { gitlabProvider } from "./gitlab/index.js";
import { giteeProvider } from "./gitee/index.js";
import type { RepositoryProvider } from "./types.js";

// Provider registry: the only place that maps a provider_type string to an adapter.
// Core/services depend on this, never on a concrete adapter module (ADR-0001 D2).
const providers: Record<string, RepositoryProvider> = {
  github: githubProvider,
  gitlab: gitlabProvider,
  gitee: giteeProvider,
};

export function getProvider(type: string): RepositoryProvider | null {
  return providers[type] ?? null;
}

export function listProviders(): RepositoryProvider[] {
  return Object.values(providers);
}
