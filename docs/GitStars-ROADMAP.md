# GitStars Development Roadmap & Execution Prompts

> Purpose: migrate the existing GitHub-centric prototype into the architecture defined in `ARCHITECTURE.md` without losing existing functions or data.  
> Execution style: independently testable milestones; every milestone leaves the repository runnable.  
> Granularity: L3/L2 coding models should be able to execute a milestone without making new architecture decisions.

---

# 0. Model-tier contract

## L5

Use only for major strategy reversal, security-critical architecture, protocol stability, or unusually ambiguous cross-system decisions.

## L4

Use for:

- architecture checkpoints;
- destructive migration review;
- final domain-boundary decisions;
- Provider contract freeze after GitLab;
- List v1 protocol freeze;
- public Hub architecture/security review.

L4 should not spend time on repetitive JSX, file moves, bulk renames, or ordinary tests.

## L3

Primary implementation tier.

Appropriate for:

- bounded database migrations when schema design is already specified;
- synchronization state machines;
- repository/service extraction;
- Provider implementation;
- import/export pipelines;
- CI and nontrivial test infrastructure.

L3 is not allowed to silently redesign architecture.

## L2

Mechanical implementation tier.

Appropriate for:

- bounded renames;
- moving components after interfaces exist;
- adding straightforward tests from specified cases;
- documentation;
- dependency cleanup;
- UI terminology changes;
- small CRUD hooks/components.

If an L2 task encounters ambiguity that changes schema, ownership, public protocol, or Provider semantics, it must stop and escalate.

---

# 1. Global execution rules

Every agent prompt in this roadmap inherits these rules:

1. Read `ARCHITECTURE.md` and the relevant existing files before editing.
2. Preserve existing user-visible functions and existing data unless the milestone explicitly says otherwise.
3. Do not perform unrelated refactors.
4. Do not introduce React Query, Redux, Redis, queues, graph DB, vector DB, microservices, plugin systems, or database abstractions.
5. Prefer mature existing libraries already in the project; add dependencies only when the milestone justifies them.
6. Never hide a failed database/API operation and still report success.
7. Never delete user data as an automatic repair strategy.
8. All new external input is untrusted.
9. Tests passing is part of completion.
10. If an architectural contradiction is discovered, stop implementation and report it rather than improvising a new architecture.
11. Keep commits/milestones narrow enough to review independently.
12. Never remove legacy schema in the same milestone that first introduces its replacement.

Recommended completion report for every milestone:

```text
Changed:
Files:
Migrations:
Tests added:
Commands run:
Results:
Known limitations:
Architecture deviations: none / describe
```

---

# PHASE A — Establish a safe baseline

Goal: make the existing repository measurable and prevent future refactors from proceeding without verification.

---

## A1. Record baseline and repair project metadata

**Tier:** L2  
**Risk:** Low  
**Dependencies:** none

### Scope

- inspect current package scripts and source layout;
- rename package metadata from prototype naming where safe;
- create/update developer documentation describing the existing commands;
- do not change runtime behavior.

### Acceptance criteria

- current `npm run check`, `npm run lint`, and `npm run build` behavior is recorded;
- package name no longer says `trae-project`;
- no functional code changes.

### Prompt

```text
You are executing GitStars Roadmap milestone A1.

Read ARCHITECTURE.md first. Inspect package.json, README.md and repository root.

Task:
1. Record the current baseline commands and their results.
2. Replace prototype-only package metadata such as the package name with an appropriate GitStars package name, without changing dependencies or runtime behavior.
3. Update developer documentation only where needed to document check/lint/build.
4. Do not touch application behavior, database schema, UI design, or provider logic.

Run npm run check, npm run lint and npm run build.
If a command already fails before your changes, distinguish baseline failure from regression.
Return the standard milestone completion report.
```

---

## A2. Add Vitest unit-test harness

**Tier:** L3  
**Risk:** Low  
**Dependencies:** A1

### Scope

- add Vitest;
- add `npm test` / `npm run test`;
- configure for pure TypeScript/service tests first;
- add one trivial deterministic test proving the harness runs;
- do not introduce browser/component testing unless required.

### Acceptance criteria

```text
npm test
npm run check
npm run lint
npm run build
```

all run successfully or baseline failures are explicitly documented.

### Prompt

```text
Execute GitStars milestone A2.

Architecture is fixed by ARCHITECTURE.md. Add the smallest Vitest setup suitable for testing TypeScript domain/service logic.

Requirements:
- add only dependencies required for Vitest;
- add a test script;
- add one minimal deterministic test;
- do not add React Testing Library, Playwright, Cypress, Jest, or coverage tooling;
- do not refactor product code merely to create tests.

Verify test/check/lint/build.
```

---

## A3. Add database test layout

**Tier:** L3  
**Risk:** Medium  
**Dependencies:** A2

### Scope

Create the database-test convention before changing security.

Recommended:

```text
supabase/tests/database/
```

Add minimal pgTAP/SQL tests or the current officially supported Supabase database-test mechanism available in the installed CLI.

Do not guess CLI commands; inspect `supabase --help`.

### Acceptance criteria

- a clean local database can run at least one database test;
- test command/process is documented;
- no production schema change yet.

### Prompt

```text
Execute milestone A3.

Read ARCHITECTURE.md. Inspect the installed Supabase CLI with --help and the repository's current supabase directory.

Create the smallest repeatable database test layout for future RLS/migration tests. Do not change production policies or tables in this milestone.

Document the exact local commands discovered from the installed CLI rather than assuming command syntax.

Prove one simple database test can run and report the command/result.
```

---

## A4. Add baseline CI

**Tier:** L2/L3  
**Risk:** Low  
**Dependencies:** A2, A3

### Scope

Create GitHub Actions CI running:

```text
npm ci
npm run check
npm run lint
npm test
npm run build
```

Add database reset/test only if A3 provides a reliable non-interactive command.

### Acceptance criteria

- CI YAML is syntactically valid;
- local equivalent commands pass;
- no deployment automation.

### Prompt

```text
Execute milestone A4.

Create a minimal GitHub Actions CI workflow for GitStars.

Required gates:
npm ci
npm run check
npm run lint
npm test
npm run build

If milestone A3 established a reliable local Supabase reset/database-test command, include it. Otherwise leave a clearly documented follow-up instead of inventing CI secrets or unstable commands.

Do not add deployment, release, preview environments, code coverage services, or third-party observability.
```

---

# PHASE B — Security and destructive-data repair

Goal: make the current GitHub-only application safe before domain migration.

This phase modifies data/security behavior. B1/B2 should receive L4 review before production deployment.

---

## B0. L4 security checkpoint

**Tier:** L4  
**Output:** approved corrective migration plan, no bulk feature implementation.

### Review questions

- Which historical migrations have already been deployed?
- What current tables/functions/policies exist on production?
- Can current data contain ownership inconsistencies?
- Which corrective changes are additive vs destructive?
- What backup/recovery point exists?

### Prompt

```text
Act as the L4 architecture/security reviewer for GitStars Phase B.

Read ARCHITECTURE.md and inspect every file under supabase/migrations plus current database-access code.

Produce a concrete corrective migration plan. Do not implement product features.

You must specifically review:
- RLS and GRANT state for every exposed business table;
- the non-timestamped secure_rls.sql situation;
- cleanup_old_users / cleanup_inactive_users or equivalent destructive functions;
- public/authenticated access to shared repository/project rows;
- user identity constraints and cascade effects;
- how to repair existing installations using forward migrations without editing already-applied migration history.

Output exact invariants and acceptance tests that L3 can implement.
```

---

## B1. Create versioned corrective RLS migration

**Tier:** L3 + L4 review  
**Risk:** High  
**Dependencies:** B0

### Scope

Implement only the approved corrective security migration.

Required principles:

- RLS enabled on exposed tables;
- explicit GRANTs;
- ownership policies for user-owned rows;
- browser cannot arbitrarily update globally shared repository facts;
- no unversioned security SQL required for a fresh/updated installation.

### Acceptance criteria

Database tests prove:

```text
anon denied where expected
user A cannot access B-owned rows
authenticated user cannot arbitrarily mutate shared project/repository facts
legitimate own-user CRUD still works
```

### Prompt

```text
Execute milestone B1 exactly from the approved Phase B L4 plan.

Create a new forward Supabase migration using the installed CLI's documented migration creation command. Do not edit historical applied migrations.

Implement the approved RLS/GRANT corrections only.

Add database tests for:
1. anonymous denial;
2. user A vs user B isolation;
3. legitimate own-user CRUD;
4. denial of direct unauthorized writes to shared repository/project facts.

Run database reset/migration tests and all existing application gates.
Do not redesign the schema yet.
```

---

## B2. Remove destructive cleanup/identity repair paths

**Tier:** L3  
**Risk:** High  
**Dependencies:** B1

### Scope

- remove/revoke application-accessible inactive/old-user deletion mechanisms;
- change runtime identity mismatch behavior from delete-and-recreate to fail-closed;
- preserve data and return structured error.

### Acceptance criteria

Test:

```text
same remote identity + unexpected local identity conflict
=> sync aborts
=> no DELETE is executed
=> existing collections/relationships remain
```

### Prompt

```text
Execute milestone B2.

Search the repository for runtime user deletion, cleanup_old_users, cleanup_inactive_users, and identity-conflict repair behavior.

Required behavior:
- an identity conflict aborts synchronization;
- no user row is deleted as repair;
- no collection or relationship is cascade-deleted;
- return/log a structured diagnostic;
- application roles cannot invoke old cleanup functions if those functions remain for administrative history.

Add tests proving the conflict path preserves data.
Do not start the new LibraryItem schema yet.
```

---

## B3. Add permanent RLS regression tests

**Tier:** L2/L3  
**Risk:** Medium  
**Dependencies:** B1, B2

### Scope

Expand tests to cover every current user-owned table and maintenance function.

### Prompt

```text
Execute milestone B3.

Using the security invariants approved in B0/B1, expand database tests so each current business table has an explicit ownership/access test.

Also test that destructive maintenance functions are not callable by anon/authenticated application roles.

Do not change architecture or introduce new tables unless a test reveals the already-approved B1 migration is incomplete; in that case report the gap first.
```

---

# PHASE C — Make current synchronization reliable

Goal: fix correctness before changing the domain model.

---

## C1. Structured sync errors and result type

**Tier:** L3  
**Risk:** Medium  
**Dependencies:** A2, B2

### Scope

Refactor current sync function behavior so database errors cannot be logged-and-ignored.

Introduce a bounded result/error model.

Example concept:

```ts
type SyncResult =
  | { ok: true; ... }
  | { ok: false; code: string; phase: string; cause?: unknown };
```

Exact type can adapt to current code.

### Acceptance criteria

- no `alert()` in low-level sync code;
- no failed DB batch continues to a success return;
- tests cover at least one write failure.

### Prompt

```text
Execute milestone C1.

Refactor only the current GitHub sync error propagation.

Requirements:
- low-level sync code must not call alert();
- a failed database write must stop the affected sync;
- the caller receives a structured failure containing a stable error code and phase;
- existing successful behavior remains unchanged;
- do not introduce Provider abstractions yet.

Add tests for one successful path and at least two failure phases.
```

---

## C2. Introduce per-resource sync state

**Tier:** L3  
**Risk:** High  
**Dependencies:** C1, database tests

### Scope

Add a new additive `sync_states` table for the current GitHub resources.

Do not remove `users.last_synced_at` yet.

Store independent state for at least:

```text
starred
forked
```

### Acceptance criteria

- migration is additive;
- old field remains available;
- sync can read/write new state;
- failed resource does not advance its state.

### Prompt

```text
Execute milestone C2.

Add the additive sync_states table defined by ARCHITECTURE.md, but use it only for current GitHub 'starred' and 'forked' resources.

Do not remove users.last_synced_at.

Implement repository/data-access functions for reading and updating resource state.
Cursor may initially represent the current timestamp-based GitHub behavior, but store it in the generic JSON cursor field.

Add tests proving stars and forks have independent state and that a failed resource update does not advance its cursor.
```

---

## C3. Fix checkpoint transaction semantics

**Tier:** L3  
**Risk:** High  
**Dependencies:** C2

### Scope

Use:

```text
load cursor
capture sync start
fetch
write
advance only after successful write
```

Avoid completion-time checkpoint holes.

### Acceptance criteria

Tests:

- write failure => cursor unchanged;
- repeated same page => no duplicate relation rows;
- data arriving during sync is not skipped by using completion `now()`.

### Prompt

```text
Execute milestone C3.

Correct the existing GitHub incremental checkpoint flow.

Requirements:
- capture a stable sync-start boundary before remote fetching;
- do not set checkpoint to an arbitrary completion-time now();
- cursor advances only after all writes for that resource succeed;
- writes must be idempotent under retry;
- if current timestamp APIs need a small overlap, implement it explicitly and document why.

Add deterministic tests for cursor unchanged on failure and duplicate-safe retry.
```

---

## C4. Implement current-model full reconciliation

**Tier:** L3  
**Risk:** Medium/High  
**Dependencies:** C3

### Scope

Before the LibraryItem migration, add a bounded reconciliation implementation for current Star/Fork relationships.

Do not delete personal collection/AI knowledge.

If the old model makes safe removal impossible, mark stale relationships and defer destructive cleanup rather than improvising.

### Prompt

```text
Execute milestone C4.

Add a full-reconciliation path for the current GitHub starred/forked membership data.

Goal: detect remote removals without deleting user-authored knowledge.

Because the current domain model is legacy, prefer a conservative stale/inactive marker or equivalent safe representation if direct deletion could cascade into collections/metadata.

Do not redesign to LibraryItem yet.
Add tests for a remote unstar case and prove user-created data remains.
```

---

## C5. Centralize GitHub HTTP mechanics

**Tier:** L3  
**Risk:** Medium  
**Dependencies:** C1

### Scope

Create a single GitHub HTTP client responsible for:

```text
auth headers
timeout/abort
pagination helpers
403/429 distinction
Retry-After/reset handling
bounded retry
request scheduling
dedupe
```

Do not generalize it into a forge-independent client yet.

### Prompt

```text
Execute milestone C5.

Extract the repeated GitHub HTTP mechanics from src/utils/github.ts into a GitHub-specific client module.

Required:
- conservative concurrency (default 1);
- timeout/AbortController;
- structured error categories;
- handle rate-limit responses based on actual GitHub headers/status/body rather than assuming every 403 is rate limit;
- support 429;
- bounded retry/backoff for retryable failures;
- request deduplication where identical in-flight requests occur.

Do not create a generic ForgeProvider interface yet.
Add unit tests using mocked fetch.
```

---

## C6. Remove ActivityBadge request storm

**Tier:** L3  
**Risk:** Medium  
**Dependencies:** C5

### Scope

Move network/DB side effects out of `ActivityBadge`.

Add ActivityService with:

```text
TTL
in-flight dedupe
queue
cache decision
```

### Prompt

```text
Execute milestone C6.

Inspect ActivityBadge and current activity analysis code.

Refactor so ActivityBadge is presentation-only. It must not directly call GitHub or write Supabase.

Create a bounded ActivityService using the GitHub client from C5. Preserve the existing activity calculation and 7-day freshness semantics unless tests show a bug.

Required test: multiple consumers requesting the same repository activity concurrently cause one underlying remote request sequence.
Do not redesign the activity algorithm.
```

---

# PHASE D — Introduce the correct Library-first domain model

Goal: migrate without deleting legacy data.

A L4 checkpoint is required before D1.

---

## D0. L4 domain migration checkpoint

**Tier:** L4

### Required output

A reviewed field-level mapping:

```text
old projects -> repositories
old user_projects -> remote_memberships + library_items
old collection_projects -> collection_items
old project AI metadata -> library_items
```

It must specify handling of nulls, duplicates, existing users, and rollback/recovery.

### Prompt

```text
Act as the L4 reviewer for GitStars Phase D.

Read ARCHITECTURE.md and the current migrations/application queries.

Produce a field-level additive migration and backfill design for:
repositories
library_items
remote_memberships
collection_items

Constraints:
- existing data must remain readable;
- no legacy table is dropped in this phase;
- a remote relationship is not allowed to own user knowledge;
- collections must eventually point to LibraryItem;
- identify every cascade that could cause data loss;
- specify unique/FK/NOT NULL constraints and the order in which they can safely be added;
- provide exact verification queries/tests for L3.

Do not implement application features.
```

---

## D1. Add neutral domain tables

**Tier:** L3 + L4 review  
**Risk:** High  
**Dependencies:** D0

### Scope

Create only new tables/constraints/indexes approved by D0.

Do not alter UI read paths yet.

### Prompt

```text
Execute D1 exactly from the approved D0 schema plan.

Create a forward migration adding:
repositories
library_items
remote_memberships
collection_items
and any required supporting constraints/indexes.

Do not drop or rename legacy projects/user_projects/collection_projects fields.
Do not backfill yet unless D0 explicitly requires one atomic operation.

Add RLS/ownership policies at table creation time.
Add database tests for constraints and ownership.
```

---

## D2. Backfill repositories and LibraryItems

**Tier:** L3  
**Risk:** High  
**Dependencies:** D1

### Scope

Backfill existing GitHub data.

Working identity:

```text
provider_type='github'
host='github.com'
remote_id=<existing GitHub id>
```

Create one LibraryItem per user/repository.

### Acceptance criteria

- deterministic row counts;
- rerunning backfill is safe;
- no legacy rows deleted;
- null/duplicate handling tested.

### Prompt

```text
Execute milestone D2.

Using the D0 mapping, backfill current GitHub projects into repositories and current user/project ownership into library_items.

Use the provisional identity:
provider_type = 'github'
host = 'github.com'
remote_id = existing GitHub repository id converted to text

Requirements:
- idempotent migration/backfill;
- no legacy row deletion;
- duplicate conflicts resolved according to D0, not ad hoc;
- verify row counts and sample mappings;
- add tests/verification SQL for rerun safety.
```

---

## D3. Backfill RemoteMemberships

**Tier:** L3  
**Risk:** Medium/High  
**Dependencies:** D2

### Scope

Convert current Star/Fork relationships into active remote memberships.

Create/associate the current GitHub provider connection representation required by D0.

### Prompt

```text
Execute milestone D3.

Backfill legacy star/fork user relationships into remote_memberships linked to the corresponding library/repository identity.

Do not infer relationships not present in legacy data.
Do not delete legacy user_projects.

Make the backfill idempotent and verify:
- starred and forked can coexist;
- one remote membership maps to the correct user/repository;
- LibraryItem count is unaffected by membership kind.
```

---

## D4. Backfill Collections to LibraryItems

**Tier:** L3  
**Risk:** High  
**Dependencies:** D2

### Scope

Populate `collection_items` from legacy `collection_projects`.

Do not remove old links.

### Prompt

```text
Execute milestone D4.

Backfill collection_items so every existing collection membership references the correct library_item.

Requirements:
- preserve all existing collection names/ownership;
- no collection item may point to another user's LibraryItem;
- if legacy inconsistent data exists, report and quarantine/skip it according to the D0 plan rather than guessing;
- do not remove collection_projects.

Add database tests for ownership and duplicate prevention.
```

---

## D5. Move user-authored AI metadata into LibraryItems

**Tier:** L3  
**Risk:** Medium/High  
**Dependencies:** D2

### Scope

Copy existing project-level AI summary/tags into user-owned LibraryItems.

Potential ambiguity when multiple users previously shared one global project value must be handled conservatively: copy the current legacy value to each affected user's LibraryItem rather than lose it.

### Prompt

```text
Execute milestone D5.

Migrate legacy project-level ai_summary/ai_tags into library_items.

Because the old schema stored these globally, preserve data by copying the existing value into each user's LibraryItem that references the repository.

Do not delete the old columns yet.
Update new AI writes to target LibraryItem only after the data backfill is verified.

Add tests showing two users can subsequently hold different summaries/tags for the same Repository.
```

---

## D6. Introduce repositories/data-access modules

**Tier:** L3  
**Risk:** Medium  
**Dependencies:** D2-D5

### Scope

Add bounded data-access modules for:

```text
Repository
LibraryItem
RemoteMembership
Collection
```

Do not rewrite every UI component yet.

### Prompt

```text
Execute milestone D6.

Create small typed data-access modules for the new domain tables.

Rules:
- no React state inside data-access modules;
- no alerts;
- all Supabase errors are returned/thrown explicitly;
- use generated/defined types where available;
- do not create a generic repository-pattern framework or database adapter abstraction.

Migrate one low-risk read path to prove the modules work, but do not perform the full Dashboard refactor yet.
```

---

## D7. Switch Library read path

**Tier:** L3  
**Risk:** High  
**Dependencies:** D6

### Scope

Change the main Library/Dashboard repository read model to:

```text
library_items -> repositories
```

Preserve current user-visible filtering/sorting where possible.

### Prompt

```text
Execute milestone D7.

Switch the primary Library/Dashboard data read path from legacy user_projects/projects to library_items joined with repositories.

Preserve existing visible behavior, filters, sort semantics, collection display, and activity display unless the old behavior depends on a known bug.

Do not remove legacy writes yet.
Add regression tests for data mapping where practical and run all gates.
```

---

## D8. Switch Collection writes

**Tier:** L3  
**Risk:** Medium  
**Dependencies:** D4, D7

### Scope

New collection membership CRUD writes `collection_items`.

### Prompt

```text
Execute milestone D8.

Switch collection add/remove/read membership logic to collection_items -> library_items.

Do not drop collection_projects.

Preserve existing collection UX.
Add tests that:
- users cannot add another user's LibraryItem;
- duplicate add is harmless or returns a clear result;
- removal does not delete LibraryItem or Repository.
```

---

## D9. Switch sync writes to new domain

**Tier:** L3  
**Risk:** High  
**Dependencies:** C3, D3, D7

### Scope

Current GitHub sync becomes:

```text
upsert Repository
upsert/activate RemoteMembership
ensure LibraryItem
```

Remote removal:

```text
RemoteMembership.active=false
LibraryItem untouched
```

### Prompt

```text
Execute milestone D9.

Change current GitHub sync writes to the new domain model:
1. upsert repositories;
2. upsert/activate remote_memberships;
3. ensure one library_item per user/repository;
4. on reconciliation removal, mark membership inactive;
5. never remove LibraryItem due to remote membership loss.

Keep legacy tables intact and, if necessary for temporary compatibility, update them only through a narrowly documented compatibility path.

Add end-to-end service tests for initial star, repeated sync, unstar, and retry after partial failure.
```

---

## D10. Stabilize before legacy removal

**Tier:** L2/L3  
**Risk:** Low  
**Dependencies:** D7-D9

### Scope

No schema removal.

Find all legacy-table reads/writes, classify them, and create a removal checklist.

### Prompt

```text
Execute milestone D10.

Do not remove any legacy table/column.

Search the entire source tree for:
projects
user_projects
collection_projects
legacy ai_summary/ai_tags writes
users.last_synced_at

Produce and commit a LEGACY-MIGRATION-CHECKLIST.md categorizing each reference as:
- migrated;
- compatibility-only;
- still required;
- safe future removal candidate.

Remove only dead application references proven unused; no destructive SQL.
Run all gates.
```

---

# PHASE E — Type safety and modularization

Goal: improve maintainability after the data boundary is correct.

---

## E1. Generate/use Supabase database types

**Tier:** L3  
**Risk:** Medium  
**Dependencies:** D1

### Scope

Use current Supabase-supported type generation workflow.

Type the client.

### Prompt

```text
Execute milestone E1.

Inspect the installed Supabase CLI documentation/help for the supported TypeScript type-generation command.

Generate database types into a stable source file and type the Supabase client.

Do not hand-write a second competing representation of the whole database schema.
Do not fix every resulting TypeScript error with `any`; normalize nullability at data-access boundaries.

Run check/test/build.
```

---

## E2. Enable strict TypeScript incrementally

**Tier:** L3  
**Risk:** Medium  
**Dependencies:** E1, D6

### Scope

Target `strict: true`.

If one-shot conversion is too large, convert module groups and keep a tracked blocker list.

### Prompt

```text
Execute milestone E2.

Move GitStars toward TypeScript strict mode.

First inspect the actual tsconfig structure. Enable `strict: true` if the resulting repair is bounded; otherwise create the smallest staged configuration that lets core/domain/provider/data-access modules compile strictly and document remaining blockers.

Also enable forceConsistentCasingInFileNames and noFallthroughCasesInSwitch if compatible.

Do not silence errors with broad `any`, `@ts-ignore`, or unsafe casts.
Run check/test/build.
```

---

## E3. Extract Dashboard responsibilities

**Tier:** L3  
**Risk:** Medium  
**Dependencies:** D7-D8

### Scope

Split data/orchestration from the large Dashboard while preserving UI.

Recommended bounded hooks/services:

```text
useLibrary
useCollections
useSync
```

Only create modules backed by real current responsibilities.

### Prompt

```text
Execute milestone E3.

Refactor the current large Dashboard without redesigning the UI.

Extract only these already-existing responsibilities where they are currently mixed:
- Library loading/state orchestration;
- Collection loading/CRUD orchestration;
- Sync orchestration.

Keep visual markup and UX behavior stable.
Components/hooks must consume the new domain data-access/services instead of reimplementing Supabase/GitHub calls.

Do not add React Query, Redux, or a new state framework.
```

---

# PHASE F — Extract a provisional Provider boundary

Goal: Core no longer knows GitHub mechanics, while avoiding a fake universal Forge API.

---

## F1. Define minimal provisional provider types

**Tier:** L3  
**Risk:** Medium  
**Dependencies:** D9, E2

### Scope

Create only:

```text
RepositorySnapshot
MembershipRecord
MembershipPage
ProviderConnectionContext
minimal RepositoryProvider seam
```

Mark contract as internal/provisional.

### Prompt

```text
Execute milestone F1.

Read ARCHITECTURE.md Provider policy carefully.

Define the smallest internal/provisional Provider seam needed by the already-working GitHub sync.

Do not include activity, releases, topics, issues, pull requests, generic capability matrices, plugin registration, or stable public SDK concepts.

The interface exists only to decouple SyncEngine from GitHub.
Add type-level/unit tests for repository/membership normalization.
```

---

## F2. Convert current GitHub logic into GitHubProvider

**Tier:** L3  
**Risk:** High  
**Dependencies:** F1, C5

### Scope

Move GitHub repository/membership fetch+normalization behind the provisional seam.

GitHub activity may remain a GitHub-specific extension.

### Prompt

```text
Execute milestone F2.

Move the current GitHub membership/repository synchronization implementation behind the provisional provider seam from F1.

Requirements:
- preserve current authenticated/public behavior unless architecture/security rules changed it earlier;
- reuse the GitHub HTTP client from C5;
- normalize provider responses before Core sees them;
- GitHub-specific rate-limit and pagination rules remain inside GitHub modules;
- activity logic may stay GitHub-specific and must not expand the shared interface.

Run existing sync tests unchanged where possible.
```

---

## F3. Extract Provider-neutral SyncEngine

**Tier:** L3  
**Risk:** High  
**Dependencies:** F2

### Scope

SyncEngine knows:

```text
provider.listMemberships
Repository upsert
RemoteMembership upsert
LibraryItem ensure
SyncState
```

It does not know GitHub endpoints.

### Prompt

```text
Execute milestone F3.

Refactor synchronization orchestration into a provider-neutral SyncEngine.

It may depend on the provisional RepositoryProvider seam and domain data-access modules.

It must not import GitHub API URLs, GitHub response types, GitHub rate-limit headers, or GitHub token helpers.

Preserve all sync invariants:
idempotency;
per-resource cursor;
failure does not advance cursor;
remote removal does not remove LibraryItem.

Prove existing GitHub tests pass through the new SyncEngine.
```

---

## F4. Remove GitHub terminology from Core UI/data model

**Tier:** L2  
**Risk:** Low  
**Dependencies:** F3

### Scope

Rename only generic user-facing/core terminology where it incorrectly implies GitHub-only.

Keep GitHub labels when the UI is specifically describing the GitHub connection/provider.

### Prompt

```text
Execute milestone F4.

Review user-facing/core terminology after the provider extraction.

Replace generic phrases such as 'GitHub projects' with 'repositories' or provider-neutral wording only where the concept is genuinely cross-provider.

Keep 'GitHub' where the UI is explicitly about connecting/syncing GitHub.

Do not redesign navigation or styling.
Do not rename database fields in this milestone.
Run check/test/build.
```

---

# PHASE G — Validate the architecture with GitLab

Goal: use a genuinely different second provider to discover wrong abstractions.

Do not freeze the Provider API before G5.

---

## G0. L4 GitLab validation plan

**Tier:** L4

### Scope

Research current official GitLab API/auth behavior at implementation time.

Select the smallest slice that proves the architecture.

Recommended bounded goal:

```text
gitlab.com connection
+ fetch user-selected membership kinds needed for a useful Library
+ repository metadata
```

Do not promise every GitLab feature.

### Prompt

```text
Act as L4 reviewer for GitStars Phase G.

Using current official GitLab documentation, design the smallest GitLab integration that validates:
- Repository identity;
- provider connection/auth;
- at least one meaningful user-to-repository membership feed;
- pagination/cursor behavior;
- normalization into existing Repository/LibraryItem/RemoteMembership.

Do not expand scope into issues, CI, releases, groups, or self-hosted GitLab administration unless required to validate the core model.

Identify every place where the provisional Provider interface is wrong or GitHub-shaped.
Produce an implementation contract for L3.
```

---

## G1. Add GitLab connection configuration

**Tier:** L3  
**Risk:** Medium/High  
**Dependencies:** G0

### Scope

Implement only auth/connection approach approved by G0.

Do not build generalized credential vaulting.

### Prompt

```text
Execute milestone G1 exactly from the G0 GitLab connection plan.

Implement the minimum GitLab connection/configuration needed for the validation slice.

Keep credentials within the approved trust boundary.
Do not invent long-lived credential persistence, multi-host federation, or background jobs unless G0 explicitly requires it.

Add a connection verification path and structured errors.
```

---

## G2. Implement GitLabProvider repository normalization

**Tier:** L3  
**Risk:** Medium  
**Dependencies:** G1, F1

### Prompt

```text
Execute milestone G2.

Implement GitLab repository fetch/normalization for the approved validation slice.

Map GitLab responses into the existing provisional RepositorySnapshot without changing LibraryItem semantics.

If a required GitLab field cannot be represented without corrupting meaning, do not hide it in a hack. Record the mismatch and propose the smallest provider-contract correction for review.

Add fixtures/tests for nested namespace paths and stable remote identity.
```

---

## G3. Implement GitLab membership sync through SyncEngine

**Tier:** L3  
**Risk:** High  
**Dependencies:** G2, F3

### Prompt

```text
Execute milestone G3.

Implement the GitLab membership feed approved in G0 and run it through the existing provider-neutral SyncEngine.

Do not create a second GitLab-specific sync orchestration path.

Verify:
- GitHub and GitLab can both create LibraryItems;
- remote memberships retain provider_connection identity;
- cursors are independent;
- GitLab failure cannot affect GitHub sync state;
- remote membership removal preserves LibraryItem.
```

---

## G4. Unified mixed-provider Library UI

**Tier:** L2/L3  
**Risk:** Low/Medium  
**Dependencies:** G3

### Scope

Display GitHub + GitLab repositories together.

Add provider indicator/filter only if needed for clarity.

### Prompt

```text
Execute milestone G4.

Update the existing Library UI so GitHub and GitLab LibraryItems render together using the same Repository/LibraryItem view model.

Add a small provider indicator/filter only where needed to distinguish sources.
Do not redesign the full UI, navigation, or collection system.

Collections must accept LibraryItems from either provider without provider-specific branching.
```

---

## G5. Freeze Provider contract

**Tier:** L4  
**Risk:** Architecture checkpoint  
**Dependencies:** G1-G4

### Prompt

```text
Perform the GitStars Provider Contract review after both GitHub and GitLab work end-to-end.

Inspect real implementations and tests.

Classify every shared provider concept as:
KEEP
SIMPLIFY
PROVIDER-SPECIFIC
REMOVE
DEFER

Only now define the stable internal Provider contract.

Do not add capability fields for hypothetical future Forge features.
Update ARCHITECTURE.md with the validated contract and record an ADR explaining the evidence from GitHub + GitLab.
```

---

# PHASE H — Portable List Draft and v1 freeze

Goal: validate portability with real mixed-forge data before creating a public protocol.

---

## H1. Implement List Draft v0 types and validator

**Tier:** L3  
**Risk:** Medium  
**Dependencies:** G3

### Scope

Use the intentionally small draft from ARCHITECTURE.md.

Add runtime validation.

### Prompt

```text
Execute milestone H1.

Implement GitStars List Draft schema_version 0.

Create:
- TypeScript types;
- runtime validation;
- parser that treats input as unknown;
- fixtures for one GitHub-only list and one GitHub+GitLab list.

Do not add lineage, signatures, list forking, Hub IDs, ratings, recommendation metadata, or protocol fields not required for import/export.
```

---

## H2. Export + sanitizer

**Tier:** L3  
**Risk:** High (privacy)  
**Dependencies:** H1

### Scope

Serialize selected LibraryItems/Collection into Draft v0.

Private repositories must be excluded/rejected before file creation.

### Prompt

```text
Execute milestone H2.

Implement List Draft export from selected LibraryItems/Collection.

Security requirements:
- no local UUIDs;
- no user_id;
- no credentials;
- no sync state;
- no internal config;
- private repository identity and notes must not enter the serialized output;
- AI summary is not exported unless an explicit export option already approved by the UI/service contract requests it.

Add tests inspecting the raw exported JSON for forbidden fields.
```

---

## H3. Import preview and safe import

**Tier:** L3  
**Risk:** High  
**Dependencies:** H1

### Scope

Pipeline:

```text
size -> parse -> validate -> sanitize -> preview -> confirm -> import
```

Preserve unknown/unresolved provider items instead of silently dropping them.

### Prompt

```text
Execute milestone H3.

Implement safe List Draft import.

Required:
1. reject oversized/malformed payloads before DB mutation;
2. runtime validate every item;
3. no raw HTML/script execution;
4. no arbitrary automatic URL fetching from the manifest;
5. produce a preview showing existing/new/unresolved entries;
6. only mutate after explicit confirmation from the caller/UI;
7. importing the same List twice must not duplicate an existing LibraryItem.

Unknown provider items must remain representable as unresolved imported entries according to the architecture.
```

---

## H4. Mixed-provider round-trip test suite

**Tier:** L2/L3  
**Risk:** Medium  
**Dependencies:** H2-H3

### Prompt

```text
Execute milestone H4.

Create permanent fixture-based tests for:
- GitHub-only export/import;
- GitLab-only export/import;
- mixed GitHub+GitLab list;
- duplicate import;
- unknown provider item;
- private repository export rejection;
- malicious text payloads treated as data;
- malformed schema.

Do not change the schema merely to make a fixture convenient; report schema problems for H5 review.
```

---

## H5. Freeze List Format v1

**Tier:** L4  
**Dependencies:** H1-H4, G5

### Prompt

```text
Perform the List Protocol v1 review.

Evidence must include real GitHub and GitLab round-trip fixtures and import security tests.

Review:
- repository portable identity;
- required vs optional fields;
- host/path normalization;
- unknown provider behavior;
- private-data guarantees;
- forward/backward compatibility strategy.

Remove unnecessary fields before freezing.
Then define schema_version 1 and create permanent v1 compatibility fixtures.

After this milestone, future versions must continue to read v1.
```

---

# PHASE I — Operational hardening for user-owned deployment

This phase may be partially executed earlier when convenient, but must be complete before a public self-hosted release.

---

## I1. App/database schema compatibility guard

**Tier:** L3  
**Risk:** Medium  
**Dependencies:** D1

### Prompt

```text
Execute milestone I1.

Implement explicit database schema version detection.

Requirements:
- app knows the minimum compatible schema;
- incompatible schema prevents dangerous writes;
- error state explains that migration is required;
- do not attempt automatic destructive schema migration from browser code;
- diagnostics/export/recovery operations remain accessible where technically safe.

Add tests for compatible, too-old, and unexpected-newer schema states.
```

---

## I2. Configuration validation

**Tier:** L2/L3  
**Risk:** Low  
**Dependencies:** none

### Prompt

```text
Execute milestone I2.

Centralize runtime configuration validation for required frontend/server-side settings.

Missing/invalid configuration must produce a specific diagnostic rather than failing later during OAuth/sync.

Keep secrets server-side.
Do not add a large validation framework solely for a handful of environment variables unless an existing lightweight dependency clearly justifies it.

Update .env.example.
```

---

## I3. Backup/restore procedure

**Tier:** L3  
**Risk:** Medium  
**Dependencies:** D9

### Scope

Document/test recovery for non-regenerable user knowledge.

### Prompt

```text
Execute milestone I3.

Design and verify the simplest supported backup/restore procedure for the current user-owned Supabase deployment.

Prioritize non-regenerable data:
library_items and notes/tags/AI metadata;
collections and collection_items;
manual additions;
preferences if present.

Use current supported Supabase dump/restore mechanisms discovered from official CLI/docs.
Do not conflate backup with .gitstars-list export.

Test the procedure against a disposable local/test project and document verification checks.
```

---

## I4. Setup doctor

**Tier:** L3  
**Risk:** Low/Medium  
**Dependencies:** I1-I2

### Prompt

```text
Execute milestone I4.

Add a lightweight GitStars diagnostic/doctor mechanism that checks only facts the application can reliably verify, such as:
- frontend config present;
- Supabase reachable;
- schema compatibility;
- authenticated provider connection status;
- required Edge Functions reachable if applicable.

Return structured pass/fail diagnostics.
Do not add telemetry or a remote support service.
```

---

## I5. Dependency/build/prototype cleanup

**Tier:** L2  
**Risk:** Low  
**Dependencies:** A1

### Scope

Verify use before removal.

Candidates include prototype/IDE tooling and unused dependencies.

### Prompt

```text
Execute milestone I5.

Audit package.json and production build for unused/prototype dependencies and tooling.

For each candidate, prove it has no runtime/source use before removing it.
Pay particular attention to prototype IDE/badge tooling and currently unused generic HTTP/env packages.

Also review source-map production behavior and remove unnecessary production-only development tooling.

Do not perform unrelated library upgrades.
Run npm ci/check/lint/test/build after cleanup.
```

---

## I6. Structured logging and secret redaction

**Tier:** L2/L3  
**Risk:** Medium  
**Dependencies:** C1

### Prompt

```text
Execute milestone I6.

Replace sensitive/noisy sync/provider console logging with a small structured logging utility.

Include useful fields such as operation/provider/phase/error_code.
Never log tokens, PATs, AI keys, Authorization headers, or secret-key lengths/details that aid secret discovery.

No telemetry is sent to GitStars maintainers.
Preserve actionable local diagnostics.
```

---

# PHASE J — Legacy schema retirement

Do not start this phase immediately after D9. Require at least one stable application release or explicit user decision that compatibility is no longer needed.

---

## J0. L4 legacy removal review

**Tier:** L4

### Prompt

```text
Review LEGACY-MIGRATION-CHECKLIST.md after the new domain has been stable.

Prove from code search, tests, and database verification that legacy projects/user_projects/collection_projects fields and old sync checkpoint/AI columns are no longer required.

Produce an exact removal order and backup/rollback plan.
No destructive SQL should be written until this review is approved.
```

---

## J1. Remove legacy reads/writes

**Tier:** L2/L3  
**Dependencies:** J0

### Prompt

```text
Execute J1 from the approved legacy-removal plan.

Remove remaining compatibility code that reads/writes legacy tables/columns.

Do not drop database objects yet.
Run the complete test/CI suite and search the repository for forbidden legacy references.
```

---

## J2. Drop legacy schema

**Tier:** L3 + L4 review  
**Risk:** High  
**Dependencies:** J1

### Prompt

```text
Execute J2 only after an approved backup and J0/J1 evidence.

Create a forward migration removing only the legacy objects explicitly approved by J0.

Before drop:
- verify row-count/data-equivalence checks;
- verify no code references remain;
- verify backup exists.

After drop:
- reset/migrate a clean database;
- run all DB tests;
- run all application tests/build.
```

---

# PHASE K — Optional GitStars Hub

Start only after List Format v1 is frozen.

Hub should preferably begin as a separate bounded project/repository decision; do not force a monorepo beforehand.

---

## K0. L4 Hub minimal architecture review

**Tier:** L4

### Prompt

```text
Design GitStars Hub V0 using the frozen List v1.

Hard boundaries:
- Hub stores only explicitly published sanitized Lists and minimal publisher/account metadata;
- no user Library sync;
- no Forge credential storage;
- no centralized AI;
- no background repository crawling;
- Hub failure cannot affect Core.

Choose the minimum auth/data/deployment design needed for:
publish snapshot;
share URL;
basic List Plaza.

Do not design ranking, federation, list forking, recommendations, or full identity federation yet.
```

---

## K1. Publish API + validation

**Tier:** L3  
**Dependencies:** K0, H5

### Prompt

```text
Implement the Hub V0 publish endpoint exactly from K0.

Every uploaded snapshot must:
- authenticate the publisher;
- enforce payload/item/field limits;
- validate frozen List v1;
- reject invalid/private data according to protocol;
- rate limit publish operations;
- store the sanitized snapshot.

Do not fetch repository URLs from the submitted manifest.
Add abuse/security tests.
```

---

## K2. Share page

**Tier:** L2/L3  
**Dependencies:** K1

### Prompt

```text
Implement a read-only public List share page for one published List snapshot.

Render all user-supplied strings safely as data.
No raw HTML.
No automatic remote-resource fetching except explicitly safe assets approved by K0.

Keep UI simple; this milestone is about reliable public rendering, not Plaza discovery.
```

---

## K3. Basic List Plaza

**Tier:** L3  
**Dependencies:** K1-K2

### Prompt

```text
Implement Hub V0 List Plaza using only published-list metadata approved by K0.

Support a minimal browse/search surface over fields such as title/description/tags/author if present.

Do not normalize every repository item into a central repository index.
Do not add embeddings, recommendation ranking, trending crawlers, or background Forge API refresh.
```

---

## K4. Self-host client publish integration

**Tier:** L3  
**Dependencies:** K1

### Prompt

```text
Add optional Hub publishing to GitStars Core.

Publishing must:
1. build the same sanitized List v1 used by local export;
2. require explicit user action;
3. authenticate to Hub using the K0/K1 flow;
4. upload only that snapshot;
5. remain completely optional.

Core startup/sync/import/export must work when Hub URL is absent or unreachable.
Add failure tests proving Hub outage does not affect Core.
```

---

# PHASE L — Explore / Tell Me More

This phase intentionally begins with discovery. Do not pre-create graph tables or plugin APIs.

---

## L0. L4 Tell Me More V0 design

**Tier:** L4

### Prompt

```text
Design the smallest useful Tell Me More / Explore V0 on top of the now-stable Repository + LibraryItem model.

Start from the user outcome: help the user understand or discover relevant repositories.

Use on-demand execution first.
Do not add:
repository graph DB;
background enrichment of the whole Library;
plugin framework;
central crawling service;
persistent relation schema unless the V0 use case demonstrably requires it.

Define the exact input, output, evidence handling, cost/rate-limit boundary, and what the user must explicitly choose to save.
```

---

## L1+. Implementation

Break the approved Tell Me More V0 into L3 milestones only after L0. Do not pre-author prompts now because the interface is deliberately not frozen.

---

# PHASE M — Forgejo/Gitea and later Providers

Do not copy the GitHub provider mechanically.

Each provider begins with a bounded research/validation milestone and must conform to the validated contract from G5 where semantics genuinely match.

If a provider exposes a concept outside the contract, prefer provider-specific extension over inflating the common interface.

---

# 2. Suggested execution order

For the current repository, use this order:

```text
A1 -> A2 -> A3 -> A4
        ↓
B0 -> B1 -> B2 -> B3
        ↓
C1 -> C2 -> C3 -> C4
C5 -> C6
        ↓
D0 -> D1 -> D2 -> D3 -> D4 -> D5
        ↓
D6 -> D7 -> D8 -> D9 -> D10
        ↓
E1 -> E2 -> E3
        ↓
F1 -> F2 -> F3 -> F4
        ↓
I1/I2/I3/I4/I5/I6 as bounded parallel hardening work
        ↓
G0 -> G1 -> G2 -> G3 -> G4 -> G5
        ↓
H1 -> H2 -> H3 -> H4 -> H5
        ↓
stable release
        ↓
J0 -> J1 -> J2
        ↓
K0 -> K1 -> K2 -> K3 -> K4
        ↓
L0 -> Tell Me More implementation
        ↓
future Providers
```

Do not execute J/K/L merely because earlier tasks finished. They have explicit maturity gates.

---

# 3. Recommended batching for coding agents

To reduce context loss, do not give one L3 agent an entire Phase.

Recommended batches:

```text
Batch 1: A1-A2
Batch 2: A3-A4

Batch 3: B1
Batch 4: B2-B3

Batch 5: C1-C3
Batch 6: C4
Batch 7: C5-C6

Batch 8: D1
Batch 9: D2-D3
Batch 10: D4-D5
Batch 11: D6-D7
Batch 12: D8-D9
Batch 13: D10

Batch 14: E1-E2
Batch 15: E3

Batch 16: F1-F2
Batch 17: F3-F4

Batch 18+: one GitLab milestone per L3 context
```

Never combine a high-risk database migration and a major UI refactor in one L3 task.

---

# 4. Universal L3 prompt wrapper

Use this wrapper when issuing any L3 milestone prompt:

```text
You are implementing GitStars milestone <ID> only.

Authoritative documents:
1. ARCHITECTURE.md
2. ROADMAP.md milestone <ID>
3. current repository code/tests

Priority:
data safety > correctness > compatibility > maintainability > convenience.

Do not redesign architecture.
Do not implement future milestones.
Do not remove working behavior unless this milestone explicitly replaces it.
Do not silently swallow failures.
Do not claim completion without running the milestone's required verification.

Before editing:
- inspect relevant current files;
- identify existing tests/migrations/data flow;
- state any direct contradiction with ARCHITECTURE.md.

Then implement the smallest complete change satisfying the milestone.

Finish with:
Changed:
Files:
Migrations:
Tests added:
Commands run:
Results:
Known limitations:
Architecture deviations:
```

---

# 5. Universal L2 prompt wrapper

```text
You are executing a bounded mechanical GitStars milestone <ID>.

Do not make architecture decisions.
Follow ARCHITECTURE.md and the exact ROADMAP.md scope.

You may:
- perform named mechanical refactors;
- update UI terminology;
- add specified straightforward tests;
- clean proven-unused dependencies/files;
- update documentation.

You may not:
- change database ownership/lifecycle semantics;
- invent Provider abstractions;
- alter List protocol fields;
- add dependencies without clear milestone need;
- redesign UI;
- remove data/migrations.

If the requested task requires one of those decisions, stop and report the blocker.

Run all required verification and return the standard milestone completion report.
```

---

# 6. L4 review checklist

At every L4 checkpoint, require explicit answers:

```text
What evidence changed?
What invariant is being protected?
What data can be lost if wrong?
Is the proposed abstraction proven by >=2 implementations where required?
Can the decision be deferred?
Can the same goal be achieved with fewer tables/interfaces/dependencies?
What tests make the decision enforceable?
What is the rollback/recovery path?
```

The L4 reviewer must not approve architecture based on "future flexibility" alone.

---

# 7. Final completion gate for the architecture migration

The Foundation + Cross-Forge Core is complete only when:

- security/RLS regression tests pass;
- no runtime destructive identity cleanup remains;
- sync partial failure cannot advance cursor;
- GitHub remote unstar does not remove LibraryItem;
- existing user collections/AI metadata survive migration;
- primary Library reads from LibraryItem + Repository;
- GitHub sync runs through provider-neutral SyncEngine;
- GitLab runs through the same SyncEngine;
- GitHub + GitLab coexist in one Collection;
- Provider contract has been reviewed after GitLab;
- mixed-forge List export/import passes round-trip tests;
- List v1 is frozen only after those tests;
- app/database compatibility guard exists;
- backup/restore procedure is verified;
- CI enforces type/lint/test/database/build gates.

Only after this point should GitStars treat Hub and Tell Me More as normal product-development tracks rather than foundation architecture work.
