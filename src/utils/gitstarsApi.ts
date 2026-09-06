import { apiDelete, apiGet, apiPost, apiPut } from "./api";

// Typed client bindings for the new authoritative domain API (INH-512, ADR-0006).
// Idempotency keys are generated per mutation so replays are safe (ADR-0004 D2).

const idemKey = (): string =>
  globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : String(Math.random());

export interface RepositoryProjection {
  id: string;
  providerType: string;
  host: string;
  remoteId: string;
  canonicalKey: string;
  name: string;
  namespacePath?: string;
  webUrl: string;
  description?: string;
  visibility?: string;
  primaryLanguage?: string;
  starsCount: number;
  forksCount: number;
  status: string;
}

export interface SavedRepository {
  id: string;
  version: number;
  etag: string;
  status: string;
  note?: string;
  aiSummary?: string;
  aiTags: string[];
  addedAt: string;
  updatedAt: string;
  repository: RepositoryProjection;
  tags: Array<{ id: string; name: string }>;
}

export interface RepositoryCapabilities {
  memberships: string[];
  readme: boolean;
  tree: boolean;
  file: boolean;
  releases: boolean;
  releaseAssets: boolean;
  search: boolean;
  activity: boolean;
  privateRepos: boolean;
}

export interface RepositoryDetailView extends RepositoryProjection {
  capabilities: RepositoryCapabilities | null;
  saved: {
    id: string;
    status: string;
    note?: string;
    version: number;
    addedAt: string;
    tags: Array<{ id: string; name: string }>;
  } | null;
}

export interface ListSummary {
  id: string;
  name: string;
  description: string;
  version: number;
  etag: string;
  createdAt: string;
  updatedAt: string;
  itemCount?: number;
}

export interface ListItemView {
  id: string;
  savedRepositoryId: string;
  position: number;
  note?: string;
  repository: {
    id: string;
    providerType: string;
    name: string;
    webUrl: string;
  };
}

export interface ListDetail extends ListSummary {
  items: ListItemView[];
}

export interface Tag {
  id: string;
  name: string;
  created_at: string;
}

// Library
export const listLibrary = (
  params: {
    provider?: string;
    tag?: string;
    status?: string;
    sort?: string;
    order?: string;
  } = {},
) => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, String(v));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiGet<SavedRepository[]>(`/api/library${suffix}`);
};
export const saveRepository = (repositoryId: string) =>
  apiPost<SavedRepository>(
    "/api/library",
    { repositoryId },
    { headers: { "Idempotency-Key": idemKey() } },
  );
export const getSaved = (id: string) =>
  apiGet<SavedRepository>(`/api/library/${id}`);
export const updateSaved = (
  id: string,
  patch: { note?: string; status?: string },
  etag?: string,
) =>
  apiPut<SavedRepository>(`/api/library/${id}`, patch, {
    headers: {
      "Idempotency-Key": idemKey(),
      ...(etag ? { "If-Match": etag } : {}),
    },
  });
export const deleteSaved = (id: string) =>
  apiDelete<{ ok: boolean }>(`/api/library/${id}`);

// Tags
export const listTags = () => apiGet<Tag[]>("/api/tags");
export const createTag = (name: string) =>
  apiPost<Tag>(
    "/api/tags",
    { name },
    { headers: { "Idempotency-Key": idemKey() } },
  );
export const attachTag = (savedId: string, tagId: string) =>
  apiPut<{ ok: boolean }>(`/api/library/${savedId}/tags/${tagId}`);
export const detachTag = (savedId: string, tagId: string) =>
  apiDelete<{ ok: boolean }>(`/api/library/${savedId}/tags/${tagId}`);

// Lists
export const listLists = () => apiGet<ListSummary[]>("/api/lists");
export const createList = (name: string, description = "") =>
  apiPost<ListSummary>(
    "/api/lists",
    { name, description },
    { headers: { "Idempotency-Key": idemKey() } },
  );
export const getList = (id: string) => apiGet<ListDetail>(`/api/lists/${id}`);
export const deleteList = (id: string) =>
  apiDelete<{ ok: boolean }>(`/api/lists/${id}`);
export const updateListItems = (
  id: string,
  payload: { add?: string[]; remove?: string[]; reorder?: string[] },
) =>
  apiPut<ListDetail>(`/api/lists/${id}/items`, payload, {
    headers: { "Idempotency-Key": idemKey() },
  });
export const exportList = (id: string) =>
  apiPost<unknown>(`/api/lists/${id}/export`);

// Import (dry-run preview by default; commit only when confirm=true)
export interface ImportPreview {
  dryRun: boolean;
  ok: boolean;
  title?: string;
  summary: { total: number; existing: number; new: number; unresolved: number };
  items: Array<{
    provider: string;
    host: string;
    remoteId: string;
    path?: string;
    status: string;
  }>;
}
export const importPreview = (text: string) =>
  apiPost<ImportPreview>("/api/library/import", { text });
export const importCommit = (text: string, listName?: string) =>
  apiPost<{ ok: boolean; listId?: string; counts?: Record<string, number> }>(
    "/api/library/import",
    { text, confirm: true, listName },
    { headers: { "Idempotency-Key": idemKey() } },
  );

// Repository View
export const getRepository = (id: string, refresh = false) =>
  apiGet<RepositoryDetailView>(
    `/api/repositories/${id}${refresh ? "?refresh=1" : ""}`,
  );
export const getReadme = (id: string) =>
  apiGet<{ path: string; format: string; content: string }>(
    `/api/repositories/${id}/readme`,
  );
export interface TreeEntryView {
  path: string;
  type: "file" | "dir";
  size?: number;
}
export const getTree = (id: string, ref: string, path: string) =>
  apiGet<{
    ref: string;
    path: string;
    entries: TreeEntryView[];
    truncated: boolean;
  }>(
    `/api/repositories/${id}/tree?ref=${encodeURIComponent(ref)}&path=${encodeURIComponent(path)}`,
  );
export const getFile = (id: string, ref: string, path: string) =>
  apiGet<{
    path: string;
    encoding: string;
    content: string;
    size: number;
    truncated: boolean;
  }>(
    `/api/repositories/${id}/file?ref=${encodeURIComponent(ref)}&path=${encodeURIComponent(path)}`,
  );
export interface ReleaseAssetView {
  id: string;
  name: string;
  size: number;
  contentType: string;
}
export interface ReleaseView {
  id: string;
  tagName: string;
  name: string | null;
  publishedAt: string | null;
  assets: ReleaseAssetView[];
}
export const getReleases = (id: string) =>
  apiGet<{ items: ReleaseView[] }>(`/api/repositories/${id}/releases`);
export const assetDownloadUrl = (id: string, assetId: string) =>
  `/api/repositories/${id}/releases/${assetId}/download`;

// Discover
export interface SearchItemView {
  identity: { providerType: string; remoteId: string };
  name: string;
  namespacePath: string | null;
  webUrl: string;
  description: string | null;
  starsCount: number;
}
export const searchRepositories = (q: string, provider = "github") =>
  apiGet<{ items: SearchItemView[]; total?: number }>(
    `/api/discover/search?q=${encodeURIComponent(q)}&provider=${encodeURIComponent(provider)}`,
  );

// Sync
export interface SyncResponse {
  status: string;
  counts?: { repositories: number; savedCreated: number; deactivated: number };
  code?: string;
  message?: string;
}
export const syncProvider = (provider = "github") =>
  apiPost<SyncResponse>(`/api/sync/${provider}`, undefined, {
    headers: { "Idempotency-Key": idemKey() },
  });

// Preferences
export interface PreferencesResponse {
  data: Record<string, unknown>;
  version: number;
  etag?: string;
}
export const getPreferences = () =>
  apiGet<PreferencesResponse>("/api/preferences");
export const updatePreferences = (patch: Record<string, unknown>) =>
  apiPut<PreferencesResponse>(
    "/api/preferences",
    { data: patch },
    { headers: { "Idempotency-Key": idemKey() } },
  );

// Providers
export interface ProviderAccount {
  providerType: string;
  host: string;
  remoteUserId: string;
  remoteUsername: string;
  scopes: string;
}
export const listProviders = () => apiGet<ProviderAccount[]>("/api/providers");

// Changes (change feed)
export interface ChangeEntry {
  seq: number;
  entityType: string;
  entityId: string;
  op: string;
  version: number;
  createdAt: string;
  data?: Record<string, unknown>;
}
export interface ChangeFeedResponse {
  changes: ChangeEntry[];
  nextCursor: number;
  hasMore: boolean;
  protocolVersion: number;
}
export const getChanges = (since = 0, limit?: number) => {
  const qs = new URLSearchParams({ since: String(since) });
  if (limit) qs.set("limit", String(limit));
  return apiGet<ChangeFeedResponse>(`/api/changes?${qs.toString()}`);
};

// Auth
export interface SessionUser {
  id: string;
  github_id: string;
  username: string;
  email?: string;
  avatar_url?: string;
  full_name?: string;
  last_synced_at?: string;
}
export const getMe = () =>
  apiGet<{
    user: SessionUser | null;
    devLoginEnabled: boolean;
    githubOAuthConfigured: boolean;
  }>("/api/auth/session");
export const postLogout = () => apiPost<{ ok: boolean }>("/api/auth/logout");
