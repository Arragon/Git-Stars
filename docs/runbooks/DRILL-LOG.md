# Instance backup / restore / rollback drill log

Append-only. Add one entry per drill run (`npm run drill:backup`) after each release.
Every entry must name the commit, the command, and the PASS/FAIL per scenario.

## 2026-10-19 · working tree on `8a7b988` (M7 batch)

- Command: `SESSION_SECRET=drill-only-not-a-real-secret npm run drill:backup`
- Scope: throwaway instance, schema 4, seeded `users` / `repositories` /
  `saved_repositories` / `lists` / `list_items` (1 row each)
- Results:
  - `seed` OK — schema=4, counts `{users:1, repositories:1, saved_repositories:1, lists:1, list_items:1}`
  - `backup` OK — `gitstars.db` copied after `PRAGMA wal_checkpoint(TRUNCATE)`, sha256 recorded
  - `restore` OK — `integrity_check=ok`, schema version equal, row counts equal
  - `fault-A-migration-rollback` OK — injected failure rolled back, table absent, schema 4→4
  - `fault-B-missing-wal` OK — DB opens without `-wal`, `integrity_check=ok`, saved row intact
  - `fault-C-newer-schema` OK — schema=5 vs binary=4; `server/index.ts` guard would exit 1
- Verdict: **PASS (6/6)**
- Notes:
  - `node:sqlite` exposes no online backup API; checkpoint + file copy is the supported
    method (documented in the script header and RELEASE-CHECKLIST).
  - After a TRUNCATE checkpoint and clean close, `-wal`/`-shm` may be absent; the backup
    step records exactly which files existed.
  - RPO/RTO are not claimed here; this drill proves recoverability, not a service target.
