# ADR-0001: Core Domain Boundaries and Module/Package Map

- Status: Accepted (frozen)
- Date: 2026-09-05
- Linear: [INH-300](https://linear.app/inhandy/issue/INH-300/freeze-core-domain-boundaries-and-modulepackage-map)
- Milestone: M0 - Architecture Contracts
- Blocks: ADR-0002 (INH-304), ADR-0003 (INH-307), INH-323 (service skeleton), ADR-0008 (INH-458)

## Context

GitStars is a user-owned, forge-neutral repository knowledge library (see
`docs/GitStars-ARCHITECTURE.md`). The Linear plan re-scopes the product around five
core modules - Discover / Repository / Library / Lists / Hub - with an authoritative
server-side data layer and clients that cache and sync.

Two constraints shape this contract:

1. Deployment must remain **local-first**: the authoritative service runs as a single
   local Node process (Hono + SQLite) for debugging, and is deployable to a user-owned
   cloud without changing the domain contract. "Cloud core" means _the authoritative
   server process the user owns_, not a GitStars-operated multi-tenant SaaS
   (consistent with ARCHITECTURE.md section 4 non-goals).
2. "Reader" is part of **Repository View**; there is no separate top-level `gitreader`
   domain.

Without frozen boundaries, Reader/Provider/Library/Lists/Hub collapse into
interdependent page logic.

## Decision

### D1. Domain ownership

| Domain     | Owns                                                                                               | Must NOT own                                    |
| ---------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Identity   | GitStars account, session, `provider_accounts`, credential vault                                   | Repository metadata, user knowledge             |
| Repository | `RepositoryRef` (provider facts), Repository View read model, README/tree/file/releases projection | User note/tags/save status                      |
| Library    | `SavedRepository` (save status, note, ai metadata), `Tag`/`RepositoryTag`                          | Provider HTTP mechanics                         |
| Lists      | `List`, ordered `ListItem`, portable export/import                                                 | Repository provider fetch                       |
| Discover   | Cross-provider search aggregation + normalization                                                  | Persistence of user state                       |
| Sync       | Versioning, change feed, idempotency, conflict resolution (cross-cutting service)                  | UI state                                        |
| Hub (M5)   | Public sanitized List snapshots, share links, plaza                                                | Any reverse dependency on private Library/Lists |

Provider adapters (github/gitlab/gitee) and infrastructure (db, crypto, config,
logging) are **supporting layers**, not user-facing domains.

### D2. Allowed dependency direction

```
UI features  ->  application services  ->  domain (core)  ->  ports
                                              |
                        provider adapters ----+ (implement ports)
                        infrastructure   ----+ (implement ports)
```

Hard rules (enforced in review and by ADR-0007 tests):

- Core domain MUST NOT import provider-specific modules, IDs, URLs, scopes,
  pagination rules, or error classes (ARCHITECTURE.md I2).
- UI components MUST NOT implement forge HTTP behavior.
- Sync/orchestration MUST NOT call `alert()`; failures return structured results.
- Hub client code MUST NOT be required for Core startup (I5).
- Provider-specific types MUST NOT leak into the core user-state model; they stop at
  the adapter boundary and are normalized (ADR-0002).
- No provider conditional-branch pollution in Repository UI/domain: use capability
  flags (ADR-0002), not `if (provider === 'github')`.

### D3. Package/workspace map (target; adopted incrementally)

Per ARCHITECTURE.md section 35, folders are created only as real code moves in - not
as empty scaffolding. Current flat `server/` and `src/` migrate toward:

```
server/
  core/
    identity/     # accounts, sessions, provider_accounts, credentials
    repository/   # RepositoryRef service, Repository View read model
    library/      # SavedRepository, Tag, RepositoryTag, Note
    lists/        # List, ListItem, export/import (list-format)
    discover/     # search aggregation
    sync/         # versioning, change feed, idempotency, conflicts
  providers/
    shared/       # transport, http, rate-limit, pagination, errors (ADR-0002)
    github/  gitlab/  gitee/
  routes/         # thin API surface (ADR-0006); no domain logic
  infra/
    db/  migrations/  config/  crypto/  logging/
src/
  features/{library,lists,repository,discover,settings}/
  shared/{api,store,components}/
list-format/      # isomorphic portable List schema + validator (ADR / INH-384)
```

`list-format/` is shared between server (export/import engine) and client (preview),
so it stays framework-free and isomorphic.

### D4. Repository View reuse

Repository View is a single read model + UI shell reused by Discover, Library, and
Lists. Those modules navigate _into_ Repository View by `RepositoryRef` identity; they
do not re-implement repository rendering. Personal-state overlays (saved / note / tags
/ list membership) are contributed by Library/Lists, not baked into Repository.

### D5. Three data boundaries

| Boundary          | Examples                                                                            | Regenerable?              | Authority                             |
| ----------------- | ----------------------------------------------------------------------------------- | ------------------------- | ------------------------------------- |
| Provider metadata | `repositories`, `remote_memberships`, activity                                      | Yes (re-fetch from forge) | Server cache                          |
| User state        | `saved_repositories` (note/status/ai), `tags`, `lists`, `list_items`, `preferences` | No - user knowledge       | Server (authoritative), client caches |
| Public Hub data   | sanitized List snapshots, share metadata                                            | N/A (published artifact)  | Hub (independent)                     |

Deleting provider metadata MUST NOT delete user state (enforced by ADR-0003 ownership
matrix and tests).

### D6. Change control

These boundaries are frozen. Changing a boundary requires: an ADR amendment recording
new evidence, review of every dependent ADR (0002-0008), and an update to the
anti-pattern list. Downstream implementers (L2/L3) MUST NOT redefine boundaries; they
escalate per ARCHITECTURE.md section 12 / Roadmap rule 10.

## Anti-patterns (forbidden)

- A top-level `gitreader` domain.
- ` SavedRepository`/`List` importing `providers/github/*`.
- Repository UI branching on provider name instead of capability flags.
- Hub imported by Core startup path.
- Provider raw payloads used directly as the public API contract (ADR-0006).
- Runtime destructive "repair" (delete user/knowledge on identity conflict) - see
  ARCHITECTURE.md section 20 and ADR-0005.

## Consequences

- A new file/interface can be classified by asking: which domain owns the data, and
  does it cross a forbidden edge? No guesswork required.
- Local-first deployment is preserved: the same `server/core/*` runs on SQLite locally
  and on a managed DB in cloud; only `server/infra/*` config differs.
- Provider breadth (GitLab/Gitee) and client breadth (desktop/mobile) can grow without
  touching core domain, because they enter only through ports/adapters.

## Acceptance (INH-300)

- No standalone `gitreader` top-level domain: satisfied by D1/D4 (Reader is inside
  Repository View).
- Provider-specific types do not leak into core user-state model: D2 + D5 + ADR-0002.
- Hub is not a reverse dependency of private Library/Lists: D2 + D1.
- A downstream developer can classify a new file/interface from this ADR alone: D1-D3.
- Independent architecture review: recorded as a required gate before M1 starts.
