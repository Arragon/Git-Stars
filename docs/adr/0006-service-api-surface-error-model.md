# ADR-0006: Service API Surface, Error Model and Compatibility Contract

- Status: Accepted (frozen)
- Date: 2026-09-05
- Linear: [INH-315](https://linear.app/inhandy/issue/INH-315/freeze-service-api-surface-error-model-and-compatibility-contract)
- Milestone: M0 - Architecture Contracts
- Depends on: ADR-0002, ADR-0003, ADR-0004, ADR-0005. Blocks: ADR-0007, M1/M2/M3 routes.

## Context

The client<->server API must be a stable contract covering Repository queries,
Library/Lists user state, sync, and (later) sharing. Provider-native payloads are never
exposed directly. The contract must be machine-checkable so CI can catch breaking
changes.

## Decision

### D1. API surface by domain (endpoint ownership table)

Base path `/api`. Principal: `anon` | `user` (session) | `share` (M5). "Idem" = supports
`Idempotency-Key` (ADR-0004). All `user` endpoints scope by session userId.

| Domain      | Method + Path                                          | Principal | Permission                             | Idem | Notes                        |
| ----------- | ------------------------------------------------------ | --------- | -------------------------------------- | ---- | ---------------------------- |
| health      | GET `/api/health`                                      | anon      | public                                 | -    | versions + capabilities (D6) |
| auth        | GET `/api/auth/github`                                 | anon      | start OAuth                            | -    | existing                     |
| auth        | GET `/api/auth/github/callback`                        | anon      | complete OAuth                         | -    | existing                     |
| auth        | POST `/api/auth/dev-login`                             | anon      | dev only (ADR-0005 D1)                 | -    | existing                     |
| auth        | POST `/api/auth/logout`                                | user      | own session                            | -    |                              |
| auth        | GET `/api/auth/me`                                     | user      | self                                   | -    |                              |
| providers   | GET `/api/providers`                                   | user      | list own connections                   | -    | no tokens                    |
| providers   | POST `/api/providers/:type/connect`                    | user      | create provider_account                | yes  |                              |
| providers   | POST `/api/providers/:type/revoke`                     | user      | revoke (ADR-0005 D3)                   | yes  |                              |
| sync        | POST `/api/sync/:provider`                             | user      | run membership sync                    | yes  | structured SyncResult        |
| sync        | GET `/api/changes?since=`                              | user      | pull change feed                       | -    | ADR-0004 D6                  |
| repository  | GET `/api/repositories/:id`                            | user      | normalized read                        | -    | ADR-0002                     |
| repository  | GET `/api/repositories/:id/readme`                     | user      | if capability                          | -    |                              |
| repository  | GET `/api/repositories/:id/tree`                       | user      | if capability                          | -    |                              |
| repository  | GET `/api/repositories/:id/file`                       | user      | if capability                          | -    |                              |
| repository  | GET `/api/repositories/:id/releases`                   | user      | if capability                          | -    |                              |
| repository  | GET `/api/repositories/:id/releases/:assetId/download` | user      | server-proxied; token server-side only | -    | ADR-0005                     |
| discover    | GET `/api/discover/search?q=&provider=`                | user      | provider-aware search                  | -    |                              |
| library     | GET `/api/library`                                     | user      | list saved (filter/sort)               | -    | D3                           |
| library     | POST `/api/library`                                    | user      | save a repository                      | yes  |                              |
| library     | GET `/api/library/:id`                                 | user      | read one                               | -    |                              |
| library     | PUT `/api/library/:id`                                 | user      | update note/status (`If-Match`)        | yes  | ADR-0004                     |
| library     | DELETE `/api/library/:id`                              | user      | soft delete (tombstone)                | yes  |                              |
| tags        | GET/POST `/api/tags`                                   | user      | list/create                            | yes  |                              |
| tags        | PUT/DELETE `/api/library/:id/tags/:tagId`              | user      | attach/detach (set)                    | yes  |                              |
| lists       | GET/POST `/api/lists`                                  | user      | list/create                            | yes  |                              |
| lists       | GET/PUT/DELETE `/api/lists/:id`                        | user      | read/update/soft-delete                | yes  |                              |
| lists       | PUT `/api/lists/:id/items`                             | user      | add/remove/reorder (set + fractional)  | yes  | ADR-0004 D4                  |
| preferences | GET/PUT `/api/preferences`                             | user      | read/merge                             | yes  |                              |
| io          | POST `/api/lists/:id/export`                           | user      | sanitized List export                  | -    | INH-384/402                  |
| io          | POST `/api/library/import`                             | user      | dry-run then import                    | yes  | INH-402                      |

### D2. Normalized DTOs (no provider pass-through)

Responses use GitStars DTOs mapped from ADR-0002 normalized shapes. Example
`RepositoryView`:

```json
{
  "id": "...",
  "identity": {
    "providerType": "github",
    "host": "github.com",
    "remoteId": "1"
  },
  "name": "hono",
  "namespacePath": "honojs",
  "webUrl": "https://github.com/honojs/hono",
  "description": "...",
  "visibility": "public",
  "primaryLanguage": "TypeScript",
  "starsCount": 20000,
  "forksCount": 800,
  "status": "active",
  "capabilities": { "readme": true, "releases": true, "search": true }
}
```

Client renders core Repository/Library/List state without knowing any provider payload.

### D3. Pagination, filter, sort, conditional requests

- Cursor pagination: `?cursor=<opaque>&limit=<n<=200>`; response `{ items, nextCursor, hasMore }`.
- Filter/sort (Library): `?provider=&tag=&status=&sort=added_at|stars|name&order=asc|desc`.
- Conditional writes: `If-Match: "<etag>"` on user-state mutations; mismatch -> 409.
- Conditional reads (optional): `ETag`/`If-None-Match` -> 304 for cached projections.

### D4. Request id + idempotency

- `X-Request-Id`: client-provided or server-generated; echoed on every response and in
  every error envelope; used in logs/audit (ADR-0005 D7).
- `Idempotency-Key`: required-to-be-honored on mutations marked Idem; replay returns the
  stored response (ADR-0004 D2).

### D5. Standard error envelope + code catalog

Every error (4xx/5xx) returns:

```json
{
  "code": "VERSION_CONFLICT",
  "message": "human-readable",
  "details": {},
  "request_id": "..."
}
```

| code                     | HTTP | When                           | details                 |
| ------------------------ | ---- | ------------------------------ | ----------------------- |
| VALIDATION               | 400  | bad input                      | fields                  |
| UNAUTHENTICATED          | 401  | no/invalid session             | -                       |
| FORBIDDEN                | 403  | not owner / insufficient scope | -                       |
| NOT_FOUND                | 404  | missing entity                 | -                       |
| VERSION_CONFLICT         | 409  | stale `If-Match`               | `{current}`             |
| CONFLICT                 | 409  | uniqueness (e.g. list name)    | -                       |
| STALE_CLIENT             | 426  | protocol too old               | `{minimum}`             |
| RATE_LIMITED             | 429  | provider/api rate limit        | `{resetAt}`             |
| PROVIDER_NOT_IMPLEMENTED | 501  | GitLab/Gitee stub              | `{provider,capability}` |
| PROVIDER_ERROR           | 502  | upstream forge failure         | `{provider,code}`       |
| INTERNAL_ERROR           | 500  | unexpected                     | -                       |

Distinct, machine-decidable codes for auth failure, provider rate-limit, provider
not-found (NOT_FOUND/PROVIDER_ERROR), conflict, and stale client are mandatory.

### D6. Versioning, compatibility, capability negotiation

- Versions tracked independently (ARCHITECTURE.md 32): `APP_VERSION`,
  `DATABASE_SCHEMA_VERSION`, `LIST_SCHEMA_VERSION`, plus `PROTOCOL_VERSION` (ADR-0004).
- `GET /api/health` returns:
  ```json
  { "ok":true, "env":"development", "appVersion":"...", "schemaVersion":3,
    "minAppVersion":"...", "listSchemaVersion":0, "protocolVersion":1,
    "providers":{"github":{"configured":true,"capabilities":{...}},
                 "gitlab":{"configured":false},"gitee":{"configured":false}} }
  ```
- Compatibility: additive changes allowed without a bump; breaking changes bump
  `PROTOCOL_VERSION` with a deprecation window supporting `N` and `N-1` (ADR-0004 D5).
- Schema compatibility guard: if `DATABASE_SCHEMA_VERSION` < app's minimum, refuse
  unsafe writes and return a "migration required" state (ARCHITECTURE.md 12, Roadmap I1).

### D7. Machine-checkable schema + CI

- Maintain `server/openapi.yaml` (OpenAPI 3.1) as the contract source for the endpoints
  above; DTO components mirror ADR-0002/0003.
- CI runs a breaking-change check against the previous committed `openapi.yaml`
  (ADR-0007). Contract-test fixtures assert the error envelope and key DTO shapes.

## Acceptance (INH-315)

- Client renders core state without provider-specific payloads: D2.
- Mutation endpoints support idempotency: D1 (Idem) + D4.
- auth failure / provider rate-limit / provider not-found / conflict / stale client have
  distinct machine-decidable errors: D5.
- API schema supports CI breaking-change detection: D7.
