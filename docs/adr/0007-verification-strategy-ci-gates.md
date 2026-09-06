# ADR-0007: Verification Strategy, Fixtures and CI Quality Gates

- Status: Accepted (frozen; final freeze after INH-315 per its dependency note)
- Date: 2026-09-05
- Linear: [INH-319](https://linear.app/inhandy/issue/INH-319/define-verification-strategy-fixtures-and-ci-quality-gates)
- Milestone: M0 - Architecture Contracts
- Depends on: ADR-0002..0006. Blocks: every M1-M3 "Done" claim.

## Context

"Code changed" must not equal "done". Every downstream agent needs one reusable
verification contract: what each test layer proves, what fixtures exist, how to make
tests deterministic, what CI blocks on, and what evidence an issue must show. Baseline
harness already exists: Vitest (`server/db.test.ts`, `server/routes/auth.test.ts`,
`src/utils/*.test.ts`) and CI at `.github/workflows/ci.yml` (Node 22+).

## Decision

### D1. Test layer responsibilities

| Layer            | Proves                                                                                               | Runs against                              | Network               |
| ---------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------- | --------------------- |
| unit             | pure domain/service logic (identity rules, conflict resolution, sanitizer, fractional index)         | functions                                 | none                  |
| contract         | API matches `server/openapi.yaml`; error envelope; DTO shapes; provider adapter conforms to ADR-0002 | Hono app + fixtures                       | none (mock transport) |
| integration      | routes + SQLite (in-memory) end-to-end: auth, CRUD, ownership, migrations/backfill                   | real app + `:memory:` db                  | none                  |
| sync-conformance | ADR-0004 D8 cases (idempotency, tombstone, concurrent note/order, stale client, partial batch)       | app + deterministic multi-client fixtures | none                  |
| e2e              | user flows in a browser (login/sync/save/list/export)                                                | built app                                 | none (mocked forge)   |
| visual           | UI conformance for `验收·视觉模型` issues                                                            | screenshots vs baseline                   | none                  |

Boundary rule: a layer never duplicates a lower layer's job; provider HTTP is always
mocked below e2e.

### D2. Provider fixtures (deterministic, no real network)

Layout:

```
server/providers/__fixtures__/
  github/  repo.success.json  repo.private.json  repo.notfound.json
           memberships.starred.json  rate_limit.403.json  rate_limit.429.json
           rename.json  transfer.json  releases.with_assets.json
           readme.md  tree.json  file.json  search.json
  gitlab/  ... (contract-only samples)
  gitee/   ... (contract-only samples)
```

A mock transport driver (`server/providers/shared/__mocks__/fetch.ts`) serves these by
(URL, headers) match so adapters run offline. Fixtures must cover: success, private,
not-found, rate-limit (403 with `x-ratelimit-*` AND 429 with `Retry-After`), rename,
transfer, release-assets - matching ADR-0002 D5/D7.

### D3. Deterministic clock/id + seed

- Inject a `Clock` (`now()`) and `IdGen` (`uuid()`) into services; tests supply fixed
  values. No `Date.now()`/`randomUUID()` directly in testable domain code.
- DB/service seed: `server/infra/db/seed.ts` builds a known dataset (2 users, N repos
  across providers, memberships, saved repos, tags, lists) for integration/sync tests.
- SQLite tests use `:memory:` (existing `resetDbForTests`).

### D4. CI gate matrix (blocking)

`.github/workflows/ci.yml` runs, in order, all must pass:

```
npm ci
format:check      (prettier --check)
lint              (eslint)
typecheck         (tsc / npm run check)
unit              (vitest run --project unit)
contract          (openapi diff + adapter/API contract tests)
integration       (vitest run --project integration, :memory: db)
schema-breaking   (fail on removed/renamed columns or narrowed types vs committed baseline)
build             (vite build)
```

Appended later (not blocking M1-M3 core): `visual` gate for UI issues, `e2e`.
Node stays 22+ (node:sqlite). Existing lint baseline errors must not increase.

### D5. Evidence required per issue type (completion report)

Every issue moved to Done posts a Linear comment (see plan's Linear protocol) with:

```
Changed:      <what>
Files:        <paths>
Migrations:   <version(s) or none>
Tests added:  <names + layer>
Commands run: <exact>
Results:      <pass/fail counts, key assertions>
Known limits: <deliberate simplifications>
Arch deviations: none / describe
```

`Contract·Freeze` issues additionally reference the ADR file. `验收·视觉模型` issues
attach a screenshot. `安全` issues attach the relevant security test names/results.

### D6. Base harness status

Vitest + the two existing server tests are the harness skeleton; no new framework is
added (no Playwright/Cypress/Jest/coverage service now). Adding `@vitest` project
splitting (unit/contract/integration) and the mock transport + seed are the only new
pieces, implemented in M1/M2 as the code they test lands.

## Acceptance (INH-319)

- Provider adapters run deterministic tests with no real external API: D2/D3.
- Sync conflicts have a deterministic multi-client fixture design: D1 sync-conformance + ADR-0004 D8.
- API contract breaking change is CI-detectable: D4 (`contract` + `schema-breaking`).
- Downstream issues reference one test command/evidence format: D5.
