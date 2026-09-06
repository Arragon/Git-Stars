# ADR-0002: Normalized Repository Identity and Provider Adapter Contract

- Status: Accepted (frozen, provisional until 2nd live provider per ARCHITECTURE.md 13.2)
- Date: 2026-09-05
- Linear: [INH-304](https://linear.app/inhandy/issue/INH-304/freeze-normalized-repository-identity-and-provider-adapter-contract)
- Milestone: M0 - Architecture Contracts
- Depends on: ADR-0001. Blocks: ADR-0003 (data model), ADR-0006 (API surface), M2 adapters.

## Context

GitStars must treat GitHub / GitLab / Gitee (and future forges) as Providers without
letting provider differences force a core data-model redo. Scope for this effort:
**GitHub fully implemented; GitLab and Gitee frozen as contract + stub** (capability
flags advertise what is not yet live). The contract must still be expressive enough
that all three sample providers can be represented.

## Decision

### D1. Repository identity

```ts
type RepositoryIdentity = {
  providerType: string; // 'github' | 'gitlab' | 'gitee' | ...
  host: string; // normalized, e.g. 'github.com' (lowercase, no scheme/port unless non-default)
  remoteId: string; // provider-native id, STRING (never assume integer)
};
// canonical_key = `${providerType}:${host}/${namespacePath}/${name}` (display/lookup aid)
```

- The **stable** identity is `(providerType, host, remoteId)`. `canonical_key` is a
  derived, human-readable lookup aid and MAY change on rename; it is never the primary
  identity.
- `remoteId` is a string on purpose (GitLab uses integer ids, Gitee integer, but some
  forges use opaque strings).
- No automatic cross-forge merge: `github.com/foo/bar` and `gitlab.com/foo/bar` stay
  distinct rows (ARCHITECTURE.md 6.3).

### D2. Identity rules for lifecycle events

| Event                              | Rule                              | Effect on `repositories`                                                           | Effect on user state                                           |
| ---------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| rename                             | `remoteId` stable                 | update `name`, `namespace_path`, `web_url`, recompute `canonical_key`; keep row/id | untouched                                                      |
| transfer (owner/org change)        | `remoteId` stable (GitHub/GitLab) | update `namespace_path`, `web_url`, recompute `canonical_key`                      | untouched                                                      |
| transfer where provider changes id | treat as new identity             | new row; optional `provider_data.migrated_from` hint; NO auto-merge                | untouched                                                      |
| fork                               | own `remoteId`                    | new row; `provider_data.fork_of = {identity}`                                      | untouched                                                      |
| mirror                             | own `remoteId`                    | new row; no merge with source                                                      | untouched                                                      |
| deleted (remote 404/gone)          | keep row                          | set `status='deleted'`, `metadata_fetched_at`; do NOT hard-delete                  | `remote_memberships.active=false`; `SavedRepository` preserved |
| visibility change to private       | keep row                          | set `visibility='private'`                                                         | preserved; excluded from public List export (ADR / INH-384)    |

Hard invariant: no lifecycle event deletes user knowledge (SavedRepository/Note/Tags/
Lists). Remote deletion only deactivates membership.

### D3. Provider Adapter interface (`RepositoryProvider`)

Deliberately minimal, normalization-at-boundary. Lives in `server/providers/types.ts`.

```ts
interface ProviderConnectionContext {
  providerType: string;
  host: string;
  token?: string; // decrypted in-memory only; never logged/persisted plaintext
  remoteUserId?: string;
  remoteUsername?: string;
}

interface RepositoryProvider {
  readonly type: string;
  readonly capabilities: ProviderCapabilities;

  resolveIdentity(input: ResolveInput): Promise<RepositoryIdentity>;
  fetchRepository(id: RepositoryIdentity, ctx): Promise<RepositorySnapshot>;
  listMemberships(
    ctx,
    kind: MembershipKind,
    cursor?: unknown,
  ): Promise<MembershipPage>;

  // Repository View (optional per capability flags)
  getReadme?(id, ctx): Promise<ReadmeResult | null>;
  getTree?(id, ref: string, path: string, ctx): Promise<TreePage>;
  getFile?(id, ref: string, path: string, ctx): Promise<FileResult>;
  listReleases?(id, ctx, cursor?: unknown): Promise<ReleasePage>;
  getReleaseAsset?(id, assetRef: string, ctx): Promise<AssetStream>; // server-side; token never leaves server
  search?(query: string, ctx, cursor?: unknown): Promise<SearchPage>;
}
```

Normalized shapes (provider-agnostic; adapters MUST map into these, never pass raw
payloads through - ADR-0006):

- `RepositorySnapshot` -> fields of `repositories` (ADR-0003) incl. `provider_data`
  escape hatch for small provider-specific facts (not full raw payloads).
- `MembershipPage` -> `{ items: MembershipRecord[], nextCursor? }`, where
  `MembershipRecord = { identity, kind, remoteCreatedAt? }`.
- `TreePage`/`FileResult`/`ReleasePage`/`AssetStream`/`SearchPage` similarly normalized.

### D4. Capability flags (no provider branching in UI/domain)

```ts
type ProviderCapabilities = {
  memberships: Array<"star" | "fork" | "watch" | "own">;
  readme: boolean;
  tree: boolean;
  file: boolean;
  releases: boolean;
  releaseAssets: boolean;
  search: boolean;
  activity: boolean;
  privateRepos: boolean;
};
```

UI/domain reads `capabilities`, never `providerType`. Missing capability -> standard
fallback (hide the tab / show "not supported by this provider"), not an ad-hoc UI
branch. GitHub = all true. GitLab/Gitee stubs = declared but methods throw
`PROVIDER_NOT_IMPLEMENTED` until live; `capabilities` reflects only what is actually
wired, so the UI degrades honestly.

### D5. Standardized provider error model

Adapters translate provider-specific failures into one shape (mapped to the API error
catalog in ADR-0006):

```ts
type ProviderErrorCode =
  | "RATE_LIMITED"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "NETWORK"
  | "SERVER"
  | "NOT_IMPLEMENTED";
class ProviderError extends Error {
  code: ProviderErrorCode;
  retryable: boolean;
  status?: number;
  resetAt?: number; // epoch ms
}
```

Rules:

- Do NOT assume every 403 is a rate limit; inspect headers/body (GitHub
  `x-ratelimit-remaining`, `Retry-After`, reset) - see ARCHITECTURE.md 14 and current
  `server/github.ts` `isRateLimited`.
- `retryable` true only for RATE_LIMITED (with resetAt), NETWORK, SERVER(5xx).
- `NOT_IMPLEMENTED` is how GitLab/Gitee stubs fail closed.

### D6. Shared transport

`server/providers/shared/http.ts` centralizes mechanics (timeout/AbortController,
bounded retry + backoff + jitter, pagination helper, in-flight dedupe, structured
errors). Provider-specific rate-limit/pagination semantics stay inside each adapter.
Default concurrency 1 (max 2 per connection) until measured otherwise
(ARCHITECTURE.md 14).

### D7. Capability matrix template + sample mapping

| Capability                | GitHub (live)          | GitLab (stub)        | Gitee (stub)         |
| ------------------------- | ---------------------- | -------------------- | -------------------- |
| memberships               | star, fork, watch, own | star, fork (planned) | star, fork (planned) |
| readme/tree/file          | yes                    | contract-only        | contract-only        |
| releases/assets           | yes                    | contract-only        | contract-only        |
| search                    | yes                    | contract-only        | contract-only        |
| privateRepos              | yes (repo scope)       | contract-only        | contract-only        |
| identity `remoteId`       | integer-as-string      | integer-as-string    | integer-as-string    |
| rename/transfer stability | id stable              | id stable            | id stable            |

Sample fixtures for all three providers live under
`server/providers/__fixtures__/{github,gitlab,gitee}/` (spec in ADR-0007) and prove the
contract can express each provider's differences, including a rename/transfer case.

## Freeze rule

Per ARCHITECTURE.md 13.2, this Provider contract is **provisional**: it is not declared
stable until GitHub is extracted, GitLab is live, both run through the same SyncEngine,
and mixed-provider Library behavior passes tests. Gitee/GitLab stubs do not count as the
second live provider. A freeze review happens at that point (out of M0-M3 scope).

## Acceptance (INH-304)

- rename/transfer has an explicit, testable identity rule: D2 + fixtures (D7).
- core domain does not depend on GitHub-proprietary field names: D3 normalization + D4.
- missing capability has a standard fallback, not ad-hoc UI judgment: D4.
- contract expressible across 3 providers: D7 matrix + fixtures.
