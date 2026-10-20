# Release Checklist (operator)

Applies to the release pipeline in `.github/workflows/release.yml` (INH-494/528).
All artifact names/versions in this document come from the generated
`manifest.json` — do not hand-edit them.

## Preconditions

- [ ] Tag the release commit: `git tag v<version> && git push origin v<version>`.
- [ ] The tag commit passed CI on `main` (format / typecheck / lint / tests / API
      contract / build).

## Pipeline gates (blocking — the job fails before producing artifacts)

- [ ] format, typecheck, lint
- [ ] `npm test` (unit / contract / integration / sync-conformance)
- [ ] `npm run api:check` (contract valid; PRs additionally diffed vs base)
- [ ] `npm run build`
- [ ] `npm run migration:check` — migrations apply cleanly on a throwaway DB
- [ ] `npm run drill:backup` — backup/restore/rollback drill passes (M7-11)

## Artifacts

- [ ] `gitstars-<version>-server.tar.gz` — server deploy artifact (dist/ + server/ +
      package manifests + openapi.yaml)
- [ ] `checksums.txt` — sha256 of every artifact
- [ ] `manifest.json` — version, commit, protocol/list-schema versions, per-artifact
      sha256, `signedStatus`
- [ ] Confirm `manifest.json` reads `"signedStatus": "unsigned-test-artifact"`.
      Signing/notarization is **External-Block** (INH-494): only produce signed
      artifacts from an environment with real credentials, and never mark an
      unsigned artifact as signed.

## Deploy (server)

1. Back up the current deployment and its `data/` directory BEFORE unpacking the
   new artifact. Checkpoint first so the copy is consistent:
   `sqlite3 data/gitstars.db 'PRAGMA wal_checkpoint(TRUNCATE)'`, then copy
   `data/gitstars.db`, `data/gitstars.db-wal` and `data/gitstars.db-shm` together.
   (`node:sqlite` exposes no online backup API; checkpoint + file copy is the
   supported method — see `scripts/drill-backup-restore.ts`.)
2. Unpack `gitstars-<version>-server.tar.gz`; keep the existing `data/` directory.
3. Set required env (`SESSION_SECRET`, optionally `CREDENTIAL_KEY`,
   `GITHUB_CLIENT_ID/SECRET`, `ADMIN_TOKEN`). See docs/DEVELOPMENT.md.
4. `npm ci --omit=dev` and start: `npm start` (single process serves API + dist/).
5. Verify version provenance against the manifest (M7-09):
   `jq -r '.version' manifest.json` must equal
   `curl -s localhost:3001/api/health | jq -r '.appVersion'`, and
   `schemaVersion` must match the expected latest value.
6. Confirm the process serves both API and static UI: `curl -I http://localhost:3001/`
   returns the SPA HTML.

## Upgrade / data retention

- Migrations are additive and versioned (`server/migrations.ts`); user data in
  `data/gitstars.db` survives upgrades. Uninstalling the app does not delete
  `data/gitstars.db` — remove it manually to purge local data (document this to
  self-hosting users).

## Rollback

1. Stop the server process.
2. Restore the previous artifact and the backed-up `data/` directory (migrations
   are not reversible in place — rollback means restoring the pre-upgrade DB
   backup; see docs/runbooks/db-migration-failure.md).
3. Restart and verify `GET /api/health` reports the previous version set.
4. If a migration itself failed mid-upgrade, follow
   docs/runbooks/db-migration-failure.md (per-migration transactions mean the DB
   stays at the previous version on failure).

## Observability after deploy

- Watch `http_request` / `sync_run` / `auth_failure` structured logs (server/lib/obs.ts).
- Runbook entry points: docs/runbooks/ (provider-outage, db-migration-failure,
  sync-backlog, credential-issue, hub-abuse-spike).
- Drill evidence: docs/runbooks/DRILL-LOG.md (append the run after each release).
