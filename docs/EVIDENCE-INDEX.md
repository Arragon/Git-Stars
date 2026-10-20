# GitStars · Evidence Index

Every claim in the trusted baseline should point at reproducible evidence. Add an entry
when a new artifact is produced; keep the command next to it so it can be regenerated.

| Evidence                                  | Produced by                                         | Covers                                     | Last generated |
| ----------------------------------------- | --------------------------------------------------- | ------------------------------------------ | -------------- |
| `docs/SUPPORT-MATRIX.md`                  | manual, on capability changes                       | platform/provider/runtime/env truth        | 2026-10-19     |
| `docs/LINEAR-VS-CODE-AUDIT-2026-10-18.md` | manual audit (Linear MCP + code)                    | Linear status vs implementation            | 2026-10-18     |
| `docs/PERF-BASELINE.md`                   | `npm run bench` (`scripts/bench.ts`)                | performance baseline                       | 2026-10-04     |
| `docs/SECURITY-REVIEW-v1.md`              | manual review (INH-489)                             | auth, secrets, sharing, client storage     | 2026-10-04     |
| `docs/runbooks/DRILL-LOG.md`              | `npm run drill:backup`                              | backup/restore/rollback evidence (M7-11)   | 2026-10-19     |
| `manifest.json` (release artifact)        | release workflow (tag `v*`)                         | version, commit, checksums, signed status  | per release    |
| CI run on `main`                          | `.github/workflows/ci.yml`                          | format/typecheck/lint/test/api/build gates | per push       |
| `npm run api:check` output                | `scripts/check-api-contract.mjs`                    | OpenAPI validity + breaking-change gate    | per PR         |
| `npm test` output                         | Vitest (unit/contract/integration/sync-conformance) | behavioural regressions                    | per push       |

## Reading the evidence

- **Support claims** → `SUPPORT-MATRIX.md` (never a README promise).
- **Version provenance** → release `manifest.json` + `/api/health` comparison in
  `RELEASE-CHECKLIST.md`.
- **Recoverability** → `DRILL-LOG.md`; the drill script states its own limitation
  (`node:sqlite` has no online backup API).
- **Security boundaries** → `SECURITY-REVIEW-v1.md` plus the dual-user regression suite
  (`server/routes/library.security.test.ts`).

## Regenerating

```bash
npm run bench            # PERF-BASELINE.md inputs
npm run drill:backup     # DRILL-LOG.md entry
npm run api:check        # contract gate
npm test                 # full behavioural suite
```
