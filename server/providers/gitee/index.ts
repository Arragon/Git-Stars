import {
  notImplemented,
  type ProviderCapabilities,
  type RepositoryProvider,
} from "../types.js";

// Gitee adapter: contract frozen (ADR-0002) but NOT wired in this effort. Fails closed with
// PROVIDER_NOT_IMPLEMENTED; capabilities advertised as unavailable.
const capabilities: ProviderCapabilities = {
  memberships: [],
  readme: false,
  tree: false,
  file: false,
  releases: false,
  releaseAssets: false,
  search: false,
  activity: false,
  privateRepos: false,
};

export const giteeProvider: RepositoryProvider = {
  type: "gitee",
  defaultHost: "gitee.com",
  capabilities,
  async fetchRepository() {
    throw notImplemented("gitee", "fetchRepository");
  },
  async listMemberships() {
    throw notImplemented("gitee", "listMemberships");
  },
};
