// scripts/migration-check.ts
// Migration dry-run for the release pipeline (INH-494): applies the legacy schema
// and every pending migration to a THROWAWAY file database in the OS temp dir,
// never touching data/gitstars.db. Fails the release job on any migration error.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initDb, getDb } from "../server/db.js";
import {
  readSchemaVersion,
  latestSchemaVersion,
} from "../server/migrations.js";

const dir = mkdtempSync(join(tmpdir(), "gitstars-migration-check-"));
const dbPath = join(dir, "gitstars.db");

initDb(dbPath);
const db = getDb();
const version = readSchemaVersion(db);
const tables = (
  db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as Array<{
    name: string;
  }>
)
  .map((r) => r.name)
  .sort();

console.log(`migration dry-run OK: ${dbPath}`);
console.log(
  `schema_version: ${version} (latest known: ${latestSchemaVersion()})`,
);
console.log(`tables: ${tables.join(", ")}`);

if (version !== latestSchemaVersion()) {
  console.error("schema version mismatch after migration dry-run");
  process.exit(1);
}
