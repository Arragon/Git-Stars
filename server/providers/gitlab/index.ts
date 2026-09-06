import {
  notImplemented,
  type ProviderCapabilities,
  type RepositoryProvider,
} from "../types.js";

// GitLab adapter: contract frozen (ADR-0002) but NOT wired in this effort. Capabilities are
// advertised as unavailable so the UI degrades honestly instead of half-working; every method
// fails closed with PROVIDER_NOT_IMPLEMENTED. Implement against a real GitLab slice later.
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

export const gitlabProvider: RepositoryProvider = {
  type: "gitlab",
  defaultHost: "gitlab.com",
  capabilities,
  async fetchRepository() {
    throw notImplemented("gitlab", "fetchRepository");
  },
  async listMemberships() {
    throw notImplemented("gitlab", "listMemberships");
  },
};
