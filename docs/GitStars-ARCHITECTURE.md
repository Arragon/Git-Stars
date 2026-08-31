# GitStars Architecture

> Status: Architecture Baseline  
> Scope: GitStars Core + Provider Boundary + Portable Lists + Optional List Hub  
> Explicitly deferred: Tell Me More persistence model, plugin framework, graph database, full Forge capability standardization  
> Current implementation baseline: React + Vite + TypeScript + Supabase/PostgreSQL

---

## 1. Product definition

GitStars is a **user-owned, forge-neutral repository knowledge library**.

It aggregates repositories from code-hosting platforms such as GitHub and GitLab into one personal library, allows the user to add durable knowledge such as notes, tags, summaries, and collections, and supports portable curated Lists that can be exported, imported, and optionally published to a lightweight public List Hub.

The system is intentionally split into:

1. **GitStars Core** — the user's private repository library and knowledge.
2. **Provider Layer** — adapters that import remote repository/membership facts from GitHub, GitLab, and future forges.
3. **GitStars List Format** — a portable, sanitized exchange format. It remains a draft until it is validated with at least GitHub + GitLab.
4. **GitStars Hub** — an optional public service for share links and List Plaza.
5. **Explore / Tell Me More** — an optional intelligence capability built on top of Core, not a dependency of Core.

The product is no longer defined as a "GitHub Stars manager".

---

## 2. Confirmed root goal

A user must be able to:

- connect one or more forge accounts;
- aggregate repositories from those forges into one Library;
- preserve local knowledge even if a remote Star/Fork/Watch relationship disappears;
- organize repositories independently of the source platform;
- export/import mixed-forge curated Lists;
- use GitStars Core even when the official Hub is unavailable or never configured.

The minimum success condition is:

```text
GitHub ─┐
        ├─> Unified Library -> Notes / Tags / Collections -> Portable List
GitLab ─┘

Remote membership can change
        ↓
User knowledge remains intact

Hub unavailable
        ↓
Core still works
```

---

## 3. Architecture invariants

These are the decisions that should remain stable unless new evidence justifies changing them.

### I1. Library-first

The primary user-owned entity is **LibraryItem**, not Star/Fork membership.

Remote relationships explain how an item entered the Library; they do not own the user's knowledge.

### I2. Forge-neutral Core

GitHub, GitLab, Forgejo, Gitea, etc. are Providers.

Core domain code must not require GitHub-specific IDs, URLs, scopes, pagination rules, error classes, or OAuth semantics.

### I3. User-owned deployment and data

The default deployment is user-owned:

```text
Static frontend
+ user's Supabase project
+ user's forge credentials
+ user's AI credentials
```

This does not require the user to self-host the full Supabase Docker stack. Managed Supabase owned by the user is the default deployment target.

### I4. Portable Lists

Lists are transport artifacts independent of one GitStars database and independent of one forge.

Local database UUIDs never become portable repository identities.

### I5. Optional public Hub

GitStars Core must never depend on the official Hub for Library, sync, collections, import/export, AI, or local Explore capabilities.

### I6. Intelligence stays above Core

Tell Me More / Explore may read Repository and LibraryItem context and may suggest candidates. It must not become a prerequisite for Core operation.

---

## 4. Explicit non-goals

The current architecture deliberately does **not** attempt to provide:

- a centralized hosted copy of every user's Library;
- centralized GitHub/GitLab synchronization;
- a centralized AI proxy for all users;
- a database-agnostic persistence abstraction;
- an auth-provider abstraction layer;
- a complete standardized Forge API;
- a plugin marketplace/runtime;
- a repository graph database;
- vector search infrastructure;
- Redis/Kafka/background-worker infrastructure;
- automatic cross-forge repository identity merging;
- automatic crawling of every public List on the Hub;
- multi-tenant SaaS billing/quota infrastructure.

These can only be added after a real requirement justifies them.

---

## 5. Current implementation constraints

The current repository is a small React/Vite/Supabase application and should be migrated incrementally rather than rewritten.

Relevant current-state facts:

- build/check/lint exist, but there is no application test script yet;
- GitHub API, token retrieval, activity analysis, Stars/Forks fetching, and synchronization are concentrated in GitHub-specific utility code;
- the current database migrations include historical GitHub-centric schema and a separately named `secure_rls.sql`;
- the codebase still contains prototype/tooling residue and non-essential dependencies;
- existing user data and collection behavior must remain usable throughout migration.

Therefore the migration strategy is always:

```text
add -> backfill -> dual-read/dual-write where necessary -> switch -> stabilize -> remove later
```

Never perform a one-shot destructive redesign.

---

# Part I — Core domain

## 6. Repository

`Repository` represents remote repository facts.

It does not represent a Star, a Collection membership, or the user's personal knowledge.

### 6.1 Provisional portable identity

Until GitLab validation is complete, use:

```text
(provider_type, normalized_host, remote_id)
```

as the working identity.

Recommended shape:

```ts
type RepositoryIdentity = {
  providerType: string;
  host: string;
  remoteId: string;
};
```

`remoteId` is a string deliberately. Do not assume every provider uses integer IDs.

This identity is **provisional** until the second provider is implemented and tested. The product requirement "forge-neutral" is fixed; the exact provider contract is not.

### 6.2 Repository table

Target fields:

```text
repositories
------------
id UUID PK

provider_type TEXT NOT NULL
host TEXT NOT NULL
remote_id TEXT NOT NULL

namespace_path TEXT
name TEXT NOT NULL
web_url TEXT NOT NULL

description TEXT
visibility TEXT
primary_language TEXT

provider_created_at TIMESTAMPTZ
provider_updated_at TIMESTAMPTZ
metadata_fetched_at TIMESTAMPTZ

provider_data JSONB NOT NULL DEFAULT '{}'

created_at TIMESTAMPTZ NOT NULL
updated_at TIMESTAMPTZ NOT NULL

UNIQUE(provider_type, host, remote_id)
```

`provider_data` is an escape hatch for small provider-specific facts that do not deserve common columns. Do not dump complete raw API payloads into it by default.

### 6.3 No automatic cross-forge merge

These remain different Repository rows unless an explicit future intelligence layer says otherwise:

```text
github.com/foo/bar
gitlab.com/foo/bar
```

Matching names, README text, or commit history are not sufficient to merge identity automatically.

---

## 7. LibraryItem

`LibraryItem` is the central user-owned object.

Target fields:

```text
library_items
-------------
id UUID PK
user_id UUID NOT NULL
repository_id UUID NOT NULL

note TEXT
custom_tags TEXT[] NOT NULL DEFAULT '{}'
ai_summary TEXT
ai_tags TEXT[] NOT NULL DEFAULT '{}'
status TEXT

added_at TIMESTAMPTZ NOT NULL
updated_at TIMESTAMPTZ NOT NULL

UNIQUE(user_id, repository_id)
FK user_id -> auth/public user identity
FK repository_id -> repositories.id
```

The exact user table relationship should be resolved during the security migration, but LibraryItem ownership must ultimately be tied to authenticated user identity.

### 7.1 Why metadata belongs here

For the current product scale, separate `user_repository_metadata` is unnecessary abstraction.

The following are all properties of "this repository in my Library":

```text
note
custom tags
AI summary
AI tags
personal status
```

Keep them together until real access/lifecycle/performance differences justify a split.

---

## 8. RemoteMembership

`RemoteMembership` records evidence that a remote platform currently relates a user to a repository.

Examples:

```text
starred
forked
owned
watched
```

Target fields:

```text
remote_memberships
------------------
id UUID PK

user_id UUID NOT NULL
repository_id UUID NOT NULL
provider_connection_id UUID NOT NULL

kind TEXT NOT NULL
active BOOLEAN NOT NULL DEFAULT TRUE

remote_created_at TIMESTAMPTZ
first_seen_at TIMESTAMPTZ NOT NULL
last_seen_at TIMESTAMPTZ NOT NULL

source_data JSONB NOT NULL DEFAULT '{}'

UNIQUE(user_id, repository_id, provider_connection_id, kind)
```

Do not use a PostgreSQL ENUM for `kind`; provider vocabulary is not yet stable.

### 8.1 Critical lifecycle invariant

A remote membership can disappear without deleting LibraryItem.

Example:

```text
GitHub starred=true
       ↓
user writes notes and adds collections
       ↓
GitHub unstar
       ↓
RemoteMembership.active=false

LibraryItem remains
Collections remain
Notes remain
AI metadata remains
```

This invariant must be enforced in schema, application logic, and tests.

---

## 9. ProviderConnection

A user may connect multiple accounts/hosts.

Target shape:

```text
provider_connections
--------------------
id UUID PK
user_id UUID NOT NULL

provider_type TEXT NOT NULL
host TEXT NOT NULL

remote_user_id TEXT
remote_username TEXT

status TEXT NOT NULL
connection_meta JSONB NOT NULL DEFAULT '{}'

last_verified_at TIMESTAMPTZ
created_at TIMESTAMPTZ NOT NULL
updated_at TIMESTAMPTZ NOT NULL
```

Credentials do not belong in this normal table.

Long-lived encrypted credential storage is deferred until background synchronization is a proven requirement.

---

## 10. Collections

Collections organize LibraryItems.

Target:

```text
collections
-----------
id
user_id
name
description
created_at
updated_at
```

```text
collection_items
----------------
collection_id
library_item_id
created_at

UNIQUE(collection_id, library_item_id)
```

The important design change is:

```text
Collection -> LibraryItem
```

rather than:

```text
Collection -> global Repository
```

This makes ownership and deletion semantics straightforward.

---

## 11. SyncState

Do not assume every provider supports timestamp-based incremental synchronization.

Target:

```text
sync_states
-----------
id
user_id
provider_connection_id
resource_kind

cursor JSONB
cursor_version INTEGER NOT NULL DEFAULT 1

last_attempt_at
last_success_at
last_full_reconcile_at

last_error_code
last_error_message

UNIQUE(user_id, provider_connection_id, resource_kind)
```

The provider owns the semantics of `cursor`.

---

## 12. SchemaMeta

Self-hosted/user-owned deployments need explicit compatibility tracking.

Target:

```text
schema_meta
-----------
schema_version INTEGER
minimum_app_version TEXT
updated_at TIMESTAMPTZ
```

The application must refuse unsafe writes when the database schema is incompatible.

App version, database schema version, and List format version are separate concepts.

---

# Part II — Provider boundary

## 13. Provider abstraction policy

The requirement is forge neutrality.

The exact provider interface is **not frozen** before GitLab exists.

### 13.1 Initial provisional seam

Keep the first interface deliberately small:

```ts
interface RepositoryProvider {
  fetchRepository(...): Promise<RepositorySnapshot>;

  listMemberships(
    connection: ProviderConnectionContext,
    kind: string,
    cursor?: unknown
  ): Promise<MembershipPage>;
}
```

This is a migration seam, not a public SDK.

GitHub-specific support such as activity/release endpoints may live beside the GitHub provider without being promoted into the shared provider contract.

### 13.2 Freeze rule

Do not declare a stable Provider API until:

1. GitHubProvider is extracted;
2. GitLabProvider exists;
3. both use the same SyncEngine;
4. mixed-provider Library behavior passes tests;
5. shared concepts have been re-reviewed against actual GitLab differences.

Only then may a L4 architecture review freeze a provider contract.

---

## 14. Provider transport

Each provider may use a shared low-level HTTP utility for mechanics:

```text
timeout
AbortController
bounded retry
backoff + jitter
rate-limit handling
pagination helpers
request deduplication
structured errors
```

Provider-specific API/rate-limit semantics stay in the provider adapter.

Do not put GitHub-specific `x-ratelimit-*` interpretation into generic Core code.

Default concurrency should remain conservative: usually 1, at most 2 per provider connection until measurements justify more.

---

# Part III — Synchronization

## 15. Sync invariants

Every sync implementation must satisfy:

1. repeated execution is idempotent;
2. partial failure never advances the affected cursor;
3. Stars/Forks/Owned/etc. use independent resource state;
4. a retry can safely re-apply fetched records;
5. remote membership removal does not remove LibraryItem;
6. runtime identity conflicts fail closed;
7. no sync path silently catches database errors and still reports success.

---

## 16. Incremental sync

Conceptual flow:

```text
capture syncStartedAt / load provider cursor
        ↓
provider.listMemberships(...)
        ↓
validate provider response
        ↓
upsert repositories
        ↓
upsert active remote memberships
        ↓
ensure LibraryItem for newly discovered repository
        ↓
commit DB changes
        ↓
advance cursor
```

Cursor advancement occurs only after the corresponding database write is successful.

If a provider uses timestamp cursors, a small overlap window may be used where safe; idempotency makes repeated data preferable to missing data.

---

## 17. Full reconciliation

Incremental synchronization is not sufficient for remote removals or some metadata changes.

Full reconciliation periodically compares:

```text
current remote membership set
vs
known active remote membership set
```

Result:

```text
remote only -> add/activate membership
local active only -> mark membership inactive
both -> refresh last_seen / repository metadata as appropriate
```

Do not cascade delete LibraryItems when memberships become inactive.

---

# Part IV — Security and trust

## 18. Trust boundaries

```text
Browser                  = untrusted
Provider API responses    = untrusted external input
Imported List files       = untrusted input
Edge Function             = trusted execution boundary
Postgres RLS/constraints  = final data-integrity boundary
Official Hub              = independent external system
```

Single-user deployment is not an excuse to remove these boundaries; bugs and malicious imports still exist.

---

## 19. RLS baseline

Every table exposed through Supabase Data API must have correct RLS and explicit privileges.

User-owned tables require ownership checks.

For UPDATE, policies need both read eligibility and post-update ownership checks.

High-privilege service/secret keys must never appear in frontend code.

The historical pattern:

```text
unsafe initial migration
+ separately named secure_rls.sql
```

must be replaced by normal versioned corrective migrations and automated RLS tests.

Do not edit already-applied production migrations in place; repair existing installations with forward migrations.

---

## 20. Destructive runtime repair is forbidden

Application runtime must not automatically:

```text
delete an old user because OAuth identity differs
delete inactive users
delete old users to enforce a cap
cascade-delete user knowledge as "repair"
```

On identity conflict:

```text
abort
record diagnostic
preserve data
```

Repairs must be explicit migration/admin procedures.

---

## 21. Credentials

Default policy:

- provider token/PAT/API key is not written to ordinary business tables;
- service-role/secret key never reaches the browser;
- AI secret should live in the user's server-side environment/Function secrets;
- long-lived provider credential vaulting is deferred until required by background sync.

---

# Part V — Portable Lists

## 22. Collection is not List

A local Collection may contain private data and internal organization state.

A List is a deliberately serialized portable artifact.

Flow:

```text
Collection / selected LibraryItems
        ↓
List serializer
        ↓
sanitizer
        ↓
GitStars List Draft
        ↓
export OR explicit Hub publish
```

---

## 23. List format lifecycle

Do **not** publish stable List Schema v1 while only GitHub has been tested.

Use an internal/publicly experimental Draft v0 during GitHub-only development.

Freeze v1 only after:

- GitHub + GitLab are both implemented;
- a mixed-forge List can be exported;
- another instance can import it;
- unknown/unavailable provider items have defined behavior;
- malicious input tests pass;
- L4 protocol review approves the identity fields.

---

## 24. Minimal List Draft

A deliberately small draft shape:

```json
{
  "format": "gitstars-list",
  "schema_version": 0,
  "title": "Example",
  "description": "...",
  "items": [
    {
      "source": {
        "provider": "github",
        "host": "github.com",
        "remote_id": "123",
        "path": "owner/repo"
      },
      "note": "...",
      "tags": []
    }
  ]
}
```

Fields such as lineage, fork-of-list, signatures, immutable version references, and sophisticated relation metadata are deferred.

AI summary should remain an explicit export option rather than an unconditional portable field.

---

## 25. Import behavior

Imported Lists are untrusted.

Pipeline:

```text
size limit
-> JSON parse
-> schema validation
-> semantic validation
-> sanitize
-> preview
-> user confirmation
-> import
```

Unknown provider items must not be silently discarded.

They may be retained as unresolved imported items containing enough snapshot information to display and later resolve.

Raw HTML/script execution and arbitrary automatic remote fetching are forbidden.

---

## 26. Private repository rule

A public List must not leak private repository identity or user annotations.

Publishing flow must check privacy before data leaves the self-hosted instance.

Hub validation repeats the check where possible.

A private repository excluded from publishing must not leak:

```text
name
URL
note
summary
provider path
```

---

## 27. List export vs backup

These are different products.

### List export

Portable and shareable.

Never contains:

```text
local UUID
user ID
provider token
AI key
sync state
internal configuration
private-only database metadata
```

### Backup

Protects non-regenerable user knowledge, including:

```text
LibraryItems
notes
tags
collections
collection membership
AI metadata
manual additions
preferences
```

Backup/restore design must not be forced into the public List schema.

---

# Part VI — Optional List Hub

## 28. Hub purpose

GitStars Hub is a thin public network for:

```text
publish a sanitized List snapshot
share by URL
browse List Plaza
search public List metadata
```

It is not a centralized GitStars backend.

The Hub must not run:

```text
user repository sync
AI processing for all users
background GitHub/GitLab refresh for all Lists
private Library storage
provider credential storage
```

---

## 29. Hub architecture policy

Do not design Hub database/auth details too early.

Hub development starts only after List v1 is frozen.

V0 can remain minimal:

```text
hub_user
published_list
snapshot
```

The internal Hub user ID must be independent from GitHub user ID even if GitHub OAuth is the only initial login method.

Identity federation, immutable history, List forking/lineage, ranking, and recommendation are follow-up decisions based on actual usage.

---

# Part VII — Explore / Tell Me More

## 30. Position

Tell Me More is an Explore capability:

```text
Repository / LibraryItem
        ↓
on-demand intelligence
        ↓
summary / evidence / candidate repositories
        ↓
user chooses what to save
```

Foundation work must not create a speculative repository-relations schema, graph DB, plugin API, or intelligence provider framework.

When Tell Me More V0 is implemented, let the actual first use case define its service boundary.

---

# Part VIII — Deployment and operations

## 31. Default deployment

Recommended default:

```text
Frontend:
Vercel / Cloudflare Pages / Netlify / static server

Backend:
user-owned managed Supabase project

Forge credentials:
user-owned

AI credentials:
user-owned
```

Full self-hosted Supabase/Docker is an advanced deployment path, not the architecture's default optimization target.

---

## 32. Version compatibility

Track independently:

```text
APP_VERSION
DATABASE_SCHEMA_VERSION
LIST_SCHEMA_VERSION
```

When app and database are incompatible, enter a safe state instead of continuing partial writes.

Safe state should permit at least diagnostics and recovery/export operations where technically possible.

---

## 33. Migration policy

Prefer forward-compatible additive migrations.

Typical pattern:

```text
ADD new table/column
-> backfill
-> migrate code
-> dual-read/write only when necessary
-> switch
-> stabilize for at least one release
-> remove legacy structure later
```

Do not combine identity redesign, destructive schema removal, and major UI refactor into one migration.

---

## 34. Recovery

Before any destructive migration, require a backup or verified recovery path.

The user knowledge that deserves first-class recovery is the data that cannot be regenerated from a Forge:

```text
notes
tags
collections
manual LibraryItems
AI-generated/edited knowledge
preferences
```

---

# Part IX — Code architecture

## 35. Modular monolith

Do not convert to a monorepo yet.

Target direction:

```text
src/
  core/
    repository/
    library/
    sync/

  providers/
    shared/
    github/
    gitlab/        # created only when implementation begins

  application/
    sync/
    activity/
    ai/
    lists/

  infrastructure/
    supabase/
    config/
    logging/

  features/
    library/
    collections/
    lists/
    settings/
    explore/

  list-format/
```

This is a direction, not a demand to create empty folders immediately.

Create modules only as actual code moves into them.

---

## 36. Dependency rules

- UI components do not directly implement Forge HTTP behavior.
- Provider adapters do not manipulate React state.
- Sync orchestration does not call `alert()`.
- Repositories/infrastructure do not own presentation state.
- Core does not import GitHub-specific modules.
- Hub client code does not become required for Core startup.
- List parser treats every external field as untrusted until validated.

---

# Part X — Type safety, testing, and CI

## 37. Type safety

Move toward:

```text
TypeScript strict
typed Supabase client
validated external provider responses
validated List files
database constraints
```

Do not flip every advanced TS option in one unbounded commit.

Adopt strictness incrementally if necessary, but `strict` is the target baseline.

---

## 38. Test priority

Tests protect invariants, not arbitrary coverage metrics.

Highest priority:

### Database/security
- RLS ownership
- anon denial where expected
- no cross-user writes
- destructive maintenance functions unavailable
- migrations reset successfully

### Sync
- partial DB failure does not advance cursor
- retry is idempotent
- remote unstar marks membership inactive
- LibraryItem remains
- identity conflict never deletes user data

### Provider
- repository normalization
- pagination
- rate-limit/error normalization
- provider contract tests after GitLab exists

### List
- malformed JSON
- oversized input
- private repo exclusion
- unknown provider handling
- mixed GitHub/GitLab round-trip
- v1 backward compatibility after freeze

---

## 39. CI completion gate

At maturity, merge requires:

```text
npm ci
typecheck/check
lint
unit tests
database tests
migration reset/test
build
```

After List v1:

```text
List compatibility fixtures
```

A task is not complete if verification was skipped.

---

# Part XI — Performance and observability

## 40. Performance priorities

Optimize the actual current failure modes:

```text
provider request dedupe
conservative request concurrency
TTL/cache where meaningful
conditional requests where provider supports them
bulk DB writes
incremental sync
full reconcile at bounded frequency
```

Do not introduce distributed infrastructure without evidence.

---

## 41. Logging

Use structured, sanitized diagnostics.

Recommended fields:

```text
operation
provider
host
resource_kind
phase
error_code
request_id
```

Never log:

```text
OAuth token
PAT
AI key
Authorization header
service-role key
```

No telemetry to GitStars maintainers by default.

---

# Part XII — Architecture checkpoints

The following decisions require explicit L4/L5 review before being frozen:

1. corrective security/data migration that can destroy existing data;
2. final LibraryItem/RemoteMembership migration plan before old tables are removed;
3. Provider contract after GitLab is implemented;
4. List Schema v1;
5. Hub architecture before public deployment;
6. any decision to persist long-lived provider credentials;
7. any decision to add central background crawling/AI.

L3/L2 agents may implement bounded work inside these approved boundaries; they should not redefine them.

---

## 42. Definition of architectural success

The architecture is considered validated when all of these are true:

```text
1. GitHub sync can fail halfway without losing future data.
2. Remote unstar/fork removal cannot delete user knowledge.
3. Existing GitHub data has migrated into LibraryItem + RemoteMembership safely.
4. Core sync code no longer depends directly on GitHub implementation details.
5. GitLab can be added without changing LibraryItem semantics.
6. GitHub + GitLab repositories coexist in one Library.
7. A mixed-forge List can round-trip between two instances.
8. Hub absence has zero impact on Core.
9. Private data cannot enter public List snapshots by default.
10. App/database mismatch fails safely.
11. Tests and CI enforce the critical invariants.
```

Anything beyond this is product evolution rather than foundation architecture.
