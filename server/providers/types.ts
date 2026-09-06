// Provider Adapter contract (ADR-0002). Provider-specific payloads stop here; everything
// above this boundary is normalized and forge-neutral. Core MUST NOT import provider modules.

export interface RepositoryIdentity {
  providerType: string;
  host: string;
  remoteId: string;
}

export type MembershipKind = "star" | "fork" | "watch" | "own";

export interface ProviderConnectionContext {
  providerType: string;
  host: string;
  token?: string | null;
  remoteUserId?: string | null;
  remoteUsername?: string | null;
}

export type Visibility = "public" | "private" | "internal";

export interface RepositorySnapshot {
  identity: RepositoryIdentity;
  canonicalKey: string;
  namespacePath: string | null;
  name: string;
  webUrl: string;
  description: string | null;
  visibility: Visibility | null;
  primaryLanguage: string | null;
  starsCount: number;
  forksCount: number;
  providerCreatedAt: string | null;
  providerUpdatedAt: string | null;
  providerData?: Record<string, unknown>;
}

export interface MembershipRecord {
  identity: RepositoryIdentity;
  kind: MembershipKind;
  remoteCreatedAt: string | null;
  snapshot?: Partial<RepositorySnapshot>;
}

export interface MembershipPage {
  items: MembershipRecord[];
  nextCursor?: string | null;
}

export interface ReadmeResult {
  path: string;
  // Content is the raw source (markdown/text). Rendering + sanitization happens in the client.
  format: "markdown" | "text";
  content: string;
}

export interface TreeEntry {
  path: string;
  type: "file" | "dir";
  size?: number;
}

export interface TreePage {
  ref: string;
  path: string;
  entries: TreeEntry[];
  truncated: boolean;
}

export interface FileResult {
  path: string;
  encoding: "utf-8" | "base64";
  content: string;
  size: number;
  truncated: boolean;
}

export interface ReleaseAsset {
  id: string;
  name: string;
  size: number;
  contentType: string;
  // Provider-native download reference; resolved server-side (token never leaves server).
  downloadRef: string;
}

export interface Release {
  id: string;
  tagName: string;
  name: string | null;
  publishedAt: string | null;
  assets: ReleaseAsset[];
}

export interface ReleasePage {
  items: Release[];
  nextCursor?: string | null;
}

export interface AssetBytes {
  filename: string;
  contentType: string;
  size: number;
  body: Uint8Array;
}

export interface SearchItem {
  identity: RepositoryIdentity;
  name: string;
  namespacePath: string | null;
  webUrl: string;
  description: string | null;
  starsCount: number;
  primaryLanguage: string | null;
}

export interface SearchPage {
  items: SearchItem[];
  nextCursor?: string | null;
  total?: number;
}

export interface ProviderCapabilities {
  memberships: MembershipKind[];
  readme: boolean;
  tree: boolean;
  file: boolean;
  releases: boolean;
  releaseAssets: boolean;
  search: boolean;
  activity: boolean;
  privateRepos: boolean;
}

export type ProviderErrorCode =
  | "RATE_LIMITED"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "NETWORK"
  | "SERVER"
  | "NOT_IMPLEMENTED";

export class ProviderError extends Error {
  code: ProviderErrorCode;
  retryable: boolean;
  status?: number;
  resetAt?: number;
  constructor(
    code: ProviderErrorCode,
    message: string,
    opts: { retryable?: boolean; status?: number; resetAt?: number } = {},
  ) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.retryable = opts.retryable ?? false;
    this.status = opts.status;
    this.resetAt = opts.resetAt;
  }
}

export interface RepositoryProvider {
  readonly type: string;
  readonly defaultHost: string;
  readonly capabilities: ProviderCapabilities;

  fetchRepository(
    identity: RepositoryIdentity,
    ctx: ProviderConnectionContext,
  ): Promise<RepositorySnapshot>;
  listMemberships(
    ctx: ProviderConnectionContext,
    kind: MembershipKind,
    cursor?: string | null,
  ): Promise<MembershipPage>;

  getReadme?(
    identity: RepositoryIdentity,
    ctx: ProviderConnectionContext,
  ): Promise<ReadmeResult | null>;
  getTree?(
    identity: RepositoryIdentity,
    ref: string,
    path: string,
    ctx: ProviderConnectionContext,
  ): Promise<TreePage>;
  getFile?(
    identity: RepositoryIdentity,
    ref: string,
    path: string,
    ctx: ProviderConnectionContext,
  ): Promise<FileResult>;
  listReleases?(
    identity: RepositoryIdentity,
    ctx: ProviderConnectionContext,
    cursor?: string | null,
  ): Promise<ReleasePage>;
  getReleaseAsset?(
    identity: RepositoryIdentity,
    downloadRef: string,
    ctx: ProviderConnectionContext,
  ): Promise<AssetBytes>;
  search?(
    query: string,
    ctx: ProviderConnectionContext,
    cursor?: string | null,
  ): Promise<SearchPage>;
}

export function notImplemented(
  provider: string,
  capability: string,
): ProviderError {
  return new ProviderError(
    "NOT_IMPLEMENTED",
    `${provider} provider does not implement ${capability} yet`,
    {
      retryable: false,
    },
  );
}
