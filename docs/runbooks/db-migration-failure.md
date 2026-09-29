# Runbook: Database migration failure

Covers: `runMigrations` failing at startup (server exits), or a migration applying
partially (guarded by its per-migration transaction).

## Detection

- Server process exits on boot; log contains the migration error before exit.
- `schema_meta.schema_version` below the expected `latestSchemaVersion()` for the
  deployed binary (check via `sqlite3 data/gitstars.db "SELECT * FROM schema_meta;"`).

## Triage / isolation

1. Identify the failing migration version from the error (each migration runs in its
   own transaction; a failure leaves `migrations` without that version and the DB at
   the previous version — no partial state).
2. Back up before any manual action: copy the whole `data/` directory (including
   `-wal`/`-shm`) while the server is stopped.
3. Common causes: disk full (`SQLITE_FULL`), corrupted WAL (`SQLITE_CORRUPT`),
   a schema conflict introduced by an out-of-tree edit.

## Recovery

- Disk full: free space, restart the server; the migration retries from scratch.
- WAL corruption: stop the server, restore the backup taken in triage, restart.
- Bad migration code: fix forward with a corrected migration version — never edit an
  already-applied migration; document the fix in the ADR changelog.

## Do NOT

- Do not delete `data/gitstars.db` to "reset" — that destroys user-owned state
  (library, lists, tags, notes). Only provider metadata cache is rebuildable.
- Do not hand-edit `migrations` / `schema_meta` rows.
