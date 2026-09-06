import { randomUUID } from "node:crypto";
import { getDb } from "../db.js";
import { getProvider } from "../providers/registry.js";
import {
  ProviderError,
  type ProviderConnectionContext,
  type RepositoryIdentity,
  type RepositorySnapshot,
} from "../providers/types.js";
import { getProviderToken } from "./credentials.js";

// Repository read service (ADR-0001 Repository domain, ADR-0006 D2). DB is the cache of
// provider metadata; provider adapters are reached only through the registry, so this module
// never imports a concrete provider (ADR-0001 D2).

interface RepositoryRow {
  id: string;
  provider_type: string;
  host: string;
  remote_id: string;
  canonical_key: string;
  namespace_path: string | null;
  name: string;
  web_url: string;
  description: string | null;
  visibility: string | null;
  primary_language: string | null;
  stars_count: number;
  forks_count: number;
  status: string;
  provider_created_at: string | null;
  provider_updated_at: string | null;
  metadata_fetched_at: string | null;
}

export function projectRepository(row: RepositoryRow) {
  return {
    id: row.id,
    identity: {
      providerType: row.provider_type,
      host: row.host,
      remoteId: row.remote_id,
    },
    canonicalKey: row.canonical_key,
    name: row.name,
    namespacePath: row.namespace_path ?? undefined,
    webUrl: row.web_url,
    description: row.description ?? undefined,
    visibility: row.visibility ?? undefined,
    primaryLanguage: row.primary_language ?? undefined,
    starsCount: Number(row.stars_count),
    forksCount: Number(row.forks_count),
    status: row.status,
    metadataFetchedAt: row.metadata_fetched_at ?? undefined,
  };
}

function identityOf(row: RepositoryRow): RepositoryIdentity {
  return {
    providerType: row.provider_type,
    host: row.host,
    remoteId: row.remote_id,
  };
}

function loadRow(repositoryId: string): RepositoryRow | null {
  const row = getDb()
    .prepare("SELECT * FROM repositories WHERE id = ?")
    .get(repositoryId) as unknown as RepositoryRow | undefined;
  return row ?? null;
}

// Private repository metadata is owner-linked only (ADR-0005 D4): a viewer may read a private
// repo's CACHED metadata only if they have a SavedRepository or RemoteMembership for it. Public
// metadata is readable by any authenticated user. Returns null (-> 404) to avoid leaking existence.
// The provider-backed readers (readme/tree/file/releases) fetch live with the requester's own
// token, so the forge enforces access there; this guard closes the cache-read path.
function canViewRepository(userId: string, row: RepositoryRow): boolean {
  if (row.visibility !== "private") return true;
  const linked = getDb()
    .prepare(
      `SELECT 1 AS one FROM saved_repositories WHERE user_id = ? AND repository_id = ?
       UNION ALL
       SELECT 1 AS one FROM remote_memberships WHERE user_id = ? AND repository_id = ?
       LIMIT 1`,
    )
    .get(userId, row.id, userId, row.id);
  return Boolean(linked);
}

// Build the provider connection context for a user (decrypts the token in-memory only).
export function loadContext(
  userId: string,
  providerType: string,
): ProviderConnectionContext {
  const acct = getDb()
    .prepare(
      `SELECT host, remote_user_id, remote_username FROM provider_accounts
       WHERE user_id = ? AND provider_type = ? AND status = 'active'
       ORDER BY last_verified_at DESC LIMIT 1`,
    )
    .get(userId, providerType) as unknown as
    | {
        host: string;
        remote_user_id: string | null;
        remote_username: string | null;
      }
    | undefined;
  const provider = getProvider(providerType);
  return {
    providerType,
    host: acct?.host ?? provider?.defaultHost ?? providerType,
    token: getProviderToken(userId, providerType),
    remoteUserId: acct?.remote_user_id ?? null,
    remoteUsername: acct?.remote_username ?? null,
  };
}

// Insert-or-update the provider-metadata cache from a normalized snapshot. Returns the row id.
export function upsertRepositoryFromSnapshot(
  snapshot: RepositorySnapshot,
): string {
  const db = getDb();
  const { providerType, host, remoteId } = snapshot.identity;
  const nowIso = new Date().toISOString();
  const existing = db
    .prepare(
      "SELECT id FROM repositories WHERE provider_type = ? AND host = ? AND remote_id = ?",
    )
    .get(providerType, host, remoteId) as unknown as { id: string } | undefined;

  const visibility = snapshot.visibility ?? "public";
  const providerData = JSON.stringify(snapshot.providerData ?? {});

  if (existing) {
    db.prepare(
      `UPDATE repositories SET canonical_key = ?, namespace_path = ?, name = ?, web_url = ?, description = ?,
         visibility = ?, primary_language = ?, stars_count = ?, forks_count = ?, status = 'active',
         provider_created_at = ?, provider_updated_at = ?, metadata_fetched_at = ?, provider_data = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      snapshot.canonicalKey,
      snapshot.namespacePath,
      snapshot.name,
      snapshot.webUrl,
      snapshot.description,
      visibility,
      snapshot.primaryLanguage,
      snapshot.starsCount,
      snapshot.forksCount,
      snapshot.providerCreatedAt,
      snapshot.providerUpdatedAt,
      nowIso,
      providerData,
      nowIso,
      existing.id,
    );
    return existing.id;
  }

  const id = randomUUID();
  db.prepare(
    `INSERT INTO repositories
       (id, provider_type, host, remote_id, canonical_key, namespace_path, name, web_url, description,
        visibility, primary_language, stars_count, forks_count, status, provider_created_at,
        provider_updated_at, metadata_fetched_at, provider_data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    providerType,
    host,
    remoteId,
    snapshot.canonicalKey,
    snapshot.namespacePath,
    snapshot.name,
    snapshot.webUrl,
    snapshot.description,
    visibility,
    snapshot.primaryLanguage,
    snapshot.starsCount,
    snapshot.forksCount,
    snapshot.providerCreatedAt,
    snapshot.providerUpdatedAt,
    nowIso,
    providerData,
    nowIso,
    nowIso,
  );
  return id;
}

// Repository View model: metadata + provider capabilities + the requesting user's personal state.
export function getRepositoryView(repositoryId: string, userId: string) {
  const row = loadRow(repositoryId);
  if (!row) return null;
  if (!canViewRepository(userId, row)) return null;
  const provider = getProvider(row.provider_type);
  const saved = getDb()
    .prepare(
      `SELECT id, status, note, ai_summary, ai_tags, version, added_at FROM saved_repositories
       WHERE user_id = ? AND repository_id = ? AND deleted_at IS NULL`,
    )
    .get(userId, repositoryId) as unknown as
    | {
        id: string;
        status: string;
        note: string | null;
        ai_summary: string | null;
        ai_tags: string;
        version: number;
        added_at: string;
      }
    | undefined;
  const tags = saved
    ? (getDb()
        .prepare(
          `SELECT t.id, t.name FROM repository_tags rt JOIN tags t ON t.id = rt.tag_id WHERE rt.saved_repository_id = ? ORDER BY t.name`,
        )
        .all(saved.id) as unknown as Array<{ id: string; name: string }>)
    : [];
  return {
    ...projectRepository(row),
    capabilities: provider?.capabilities ?? null,
    saved: saved
      ? {
          id: saved.id,
          status: saved.status,
          note: saved.note ?? undefined,
          aiSummary: saved.ai_summary ?? undefined,
          version: Number(saved.version),
          addedAt: saved.added_at,
          tags,
        }
      : null,
  };
}

// On-demand metadata refresh from the provider (writes through the cache).
export async function refreshRepository(
  repositoryId: string,
  userId: string,
): Promise<ReturnType<typeof projectRepository>> {
  const row = loadRow(repositoryId);
  if (!row)
    throw new ProviderError("NOT_FOUND", "Repository not found", {
      status: 404,
    });
  const provider = getProvider(row.provider_type);
  if (!provider)
    throw new ProviderError(
      "NOT_IMPLEMENTED",
      `No provider for ${row.provider_type}`,
    );
  const ctx = loadContext(userId, row.provider_type);
  const snapshot = await provider.fetchRepository(identityOf(row), ctx);
  upsertRepositoryFromSnapshot(snapshot);
  return projectRepository(loadRow(repositoryId)!);
}

// Provider-backed readers. Each loads the cache row for identity, then delegates to the adapter.
async function withProvider<T>(
  repositoryId: string,
  userId: string,
  capability: keyof NonNullable<ReturnType<typeof getProvider>>["capabilities"],
  fn: (
    identity: RepositoryIdentity,
    ctx: ProviderConnectionContext,
    provider: NonNullable<ReturnType<typeof getProvider>>,
  ) => Promise<T>,
): Promise<T> {
  const row = loadRow(repositoryId);
  if (!row)
    throw new ProviderError("NOT_FOUND", "Repository not found", {
      status: 404,
    });
  const provider = getProvider(row.provider_type);
  if (!provider)
    throw new ProviderError(
      "NOT_IMPLEMENTED",
      `No provider for ${row.provider_type}`,
    );
  const caps = provider.capabilities as unknown as Record<string, unknown>;
  const enabled = Array.isArray(caps[capability])
    ? (caps[capability] as unknown[]).length > 0
    : Boolean(caps[capability]);
  if (!enabled)
    throw new ProviderError(
      "NOT_IMPLEMENTED",
      `${row.provider_type} does not support ${String(capability)}`,
    );
  return fn(identityOf(row), loadContext(userId, row.provider_type), provider);
}

export const repositoryReader = {
  readme: (repositoryId: string, userId: string) =>
    withProvider(repositoryId, userId, "readme", (id, ctx, p) =>
      p.getReadme ? p.getReadme(id, ctx) : Promise.resolve(null),
    ),
  tree: (repositoryId: string, ref: string, path: string, userId: string) =>
    withProvider(repositoryId, userId, "tree", (id, ctx, p) => {
      if (!p.getTree) throw new ProviderError("NOT_IMPLEMENTED", "tree");
      return p.getTree(id, ref, path, ctx);
    }),
  file: (repositoryId: string, ref: string, path: string, userId: string) =>
    withProvider(repositoryId, userId, "file", (id, ctx, p) => {
      if (!p.getFile) throw new ProviderError("NOT_IMPLEMENTED", "file");
      return p.getFile(id, ref, path, ctx);
    }),
  releases: (repositoryId: string, userId: string, cursor?: string | null) =>
    withProvider(repositoryId, userId, "releases", (id, ctx, p) => {
      if (!p.listReleases)
        throw new ProviderError("NOT_IMPLEMENTED", "releases");
      return p.listReleases(id, ctx, cursor);
    }),
  asset: (repositoryId: string, downloadRef: string, userId: string) =>
    withProvider(repositoryId, userId, "releaseAssets", (id, ctx, p) => {
      if (!p.getReleaseAsset)
        throw new ProviderError("NOT_IMPLEMENTED", "releaseAssets");
      return p.getReleaseAsset(id, downloadRef, ctx);
    }),
};
