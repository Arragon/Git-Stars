# GitStars Architecture Decision Records (M0)

Frozen contracts from Linear milestone **M0 - Architecture Contracts**. Downstream
implementers (M1-M3) MUST build inside these boundaries and escalate rather than
redefine them (ADR-0001 D6).

| ADR                                                       | Linear  | Title                                                | Gates                  |
| --------------------------------------------------------- | ------- | ---------------------------------------------------- | ---------------------- |
| [0001](0001-core-domain-boundaries.md)                    | INH-300 | Core domain boundaries & module map                  | M1-M3 module placement |
| [0002](0002-repository-identity-and-provider-contract.md) | INH-304 | Repository identity & Provider Adapter contract      | M2 adapters            |
| [0003](0003-cloud-data-model-and-ownership.md)            | INH-307 | Cloud data model & ownership (+ deployment profiles) | M1 schema/migrations   |
| [0004](0004-sync-protocol-versioning-conflicts.md)        | INH-310 | Sync protocol, versioning & conflict semantics       | M1 change feed         |
| [0005](0005-authn-authz-secret-handling.md)               | INH-312 | AuthN/AuthZ & secret handling                        | M1 auth/vault          |
| [0006](0006-service-api-surface-error-model.md)           | INH-315 | Service API surface, error model & compatibility     | M1-M3 routes           |
| [0007](0007-verification-strategy-ci-gates.md)            | INH-319 | Verification strategy, fixtures & CI gates           | every "Done" claim     |
| [0008](0008-v1-client-platform-matrix.md)                 | INH-458 | v1 client platform matrix (Web-only)                 | M2/M3 UI, M6 packaging |

## Scope decisions for this effort

- **Local-first deployment preserved**: the authoritative service runs as a single local
  Node process (Hono + SQLite, `LOCAL_DEV_USER`) and is cloud-deployable by config
  without contract change (ADR-0003 D5). "Cloud core" = user-owned authoritative server,
  not a GitStars-operated multi-tenant SaaS.
- **Client**: Web only; desktop/mobile frozen as deferred contracts (ADR-0008).
- **Providers**: GitHub implemented; GitLab/Gitee frozen as contract + stub
  (ADR-0002 D4/D7). Provider contract stays provisional until a second live provider
  (ARCHITECTURE.md 13.2).

M0 dependency order (from Linear): INH-300 -> {INH-304, INH-307} -> INH-310 -> INH-312
-> INH-315 -> INH-319; INH-458 after INH-300/INH-310.
