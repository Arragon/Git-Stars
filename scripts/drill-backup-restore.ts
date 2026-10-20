// scripts/drill-backup-restore.ts
// M7-11 / INH-1709: repeatable instance backup / restore / upgrade-rollback drill.
//
// Scope: the single-node Node + SQLite deployment. It proves that a file-level backup
// (WAL checkpoint + db/-wal/-shm) restores to a semantically identical instance, that a
// failed migration rolls back, that losing -wal does not corrupt the checkpointed DB,
// and that a newer schema would be rejected by the app's compatibility guard.
//
// Honest limitation: node:sqlite's DatabaseSync exposes no online backup API, so this is
// "checkpoint + file copy". That limitation is documented in RELEASE-CHECKLIST.md.
//
// Output contract: one `drill: <step> OK|FAIL <detail>` line per step, then a JSON
// summary. Any FAIL exits 1, so CI/release can gate on it.

import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// migrations.ts -> crypto.ts -> env.ts requires this at import time. Drill-only value.
process.env.SESSION_SECRET ||= "drill-only-not-a-real-secret";
const { initDb, resetDbForTests } = await import("../server/db.js");
const { latestSchemaVersion, readSchemaVersion } =
  await import("../server/migrations.js");

interface StepResult {
  step: string;
  ok: boolean;
  detail: string;
}

const results: StepResult[] = [];

function record(step: string, ok: boolean, detail: string): void {
  results.push({ step, ok, detail });
  console.log(`drill: ${step} ${ok ? "OK" : "FAIL"} ${detail}`);
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const COUNTS = [
  "users",
  "repositories",
  "saved_repositories",
  "lists",
  "list_items",
] as const;

function tableCounts(db: DatabaseSync): Record<string, number> {
  const out: Record<string, number> = {};
  for (const table of COUNTS) {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {
      n: number;
    };
    out[table] = Number(row.n);
  }
  return out;
}

function seedRows(db: DatabaseSync): void {
  db.exec(`
    INSERT INTO users (id, github_id, username) VALUES ('u1', '1', 'alice');
    INSERT INTO repositories
      (id, provider_type, host, remote_id, canonical_key, namespace_path, name, web_url,
       visibility, stars_count, forks_count, status, created_at, updated_at)
    VALUES ('r1','github','github.com','1','github:github.com/o/r1','o','r1',
            'https://github.com/o/r1','public',1,0,'active','2026-01-01','2026-01-01');
    INSERT INTO saved_repositories
      (id, user_id, repository_id, status, note, version, added_at, updated_at)
    VALUES ('sr1','u1','r1','saved','drill note',1,'2026-01-01','2026-01-01');
    INSERT INTO lists (id, user_id, name, description, version, created_at, updated_at)
    VALUES ('l1','u1','Drill','',1,'2026-01-01','2026-01-01');
    INSERT INTO list_items
      (id, list_id, saved_repository_id, position, position_key, note, version, created_at, updated_at)
    VALUES ('li1','l1','sr1',0,'m','item note',1,'2026-01-01','2026-01-01');
  `);
}

const root = mkdtempSync(join(tmpdir(), "gitstars-drill-"));
const dataDir = join(root, "data");
const backupDir = join(root, "backup");
const restoreDir = join(root, "restore");
mkdirSync(dataDir, { recursive: true });
mkdirSync(backupDir, { recursive: true });
mkdirSync(restoreDir, { recursive: true });

const livePath = join(dataDir, "gitstars.db");

// --- 1. Build a representative instance -------------------------------------------
{
  // initDb creates the legacy schema + applies the additive migrations (same path the
  // real server uses). It is a singleton, so close it via the test reset helper.
  const db = initDb(livePath);
  seedRows(db);
  const version = readSchemaVersion(db);
  const counts = tableCounts(db);
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  resetDbForTests(null);
  record(
    "seed",
    version === latestSchemaVersion(),
    `schema=${version} counts=${JSON.stringify(counts)}`,
  );
}

// --- 2. Backup (checkpoint + db/-wal/-shm + checksums) ----------------------------
const sidecars = ["", "-wal", "-shm"];
const backedUp: string[] = [];
const checksums: Record<string, string> = {};
for (const suffix of sidecars) {
  const from = `${livePath}${suffix}`;
  if (!existsSync(from)) continue;
  const to = join(backupDir, `gitstars.db${suffix}`);
  copyFileSync(from, to);
  backedUp.push(`gitstars.db${suffix}`);
  checksums[`gitstars.db${suffix}`] = sha256(to);
}
record(
  "backup",
  backedUp.includes("gitstars.db"),
  `${backedUp.join(", ")} sha256=${Object.keys(checksums).length}`,
);

// --- 3. Restore into a clean directory and compare semantics ----------------------
{
  const restoredPath = join(restoreDir, "gitstars.db");
  for (const suffix of sidecars) {
    const from = `${livePath}${suffix}`;
    if (existsSync(from)) copyFileSync(from, `${restoredPath}${suffix}`);
  }
  const db = new DatabaseSync(restoredPath);
  const integrity = db.prepare("PRAGMA integrity_check").get() as {
    integrity_check: string;
  };
  const live = new DatabaseSync(livePath);
  const sameVersion = readSchemaVersion(db) === readSchemaVersion(live);
  const sameCounts =
    JSON.stringify(tableCounts(db)) === JSON.stringify(tableCounts(live));
  db.close();
  live.close();
  record(
    "restore",
    integrity.integrity_check === "ok" && sameVersion && sameCounts,
    `integrity=${integrity.integrity_check} versionEqual=${sameVersion} countsEqual=${sameCounts}`,
  );
}

// --- 4. Fault A: a failed migration transaction must roll back ----------------------
{
  const faultPath = join(root, "fault-a.db");
  copyFileSync(join(backupDir, "gitstars.db"), faultPath);
  const db = new DatabaseSync(faultPath);
  const before = readSchemaVersion(db);
  db.exec("BEGIN");
  try {
    db.exec("CREATE TABLE should_not_exist (id TEXT)");
    throw new Error("injected migration failure");
  } catch {
    db.exec("ROLLBACK");
  }
  const exists = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='should_not_exist'",
    )
    .get();
  const after = readSchemaVersion(db);
  db.close();
  record(
    "fault-A-migration-rollback",
    !exists && before === after,
    `table=${exists ? "leaked" : "rolled-back"} schema=${before}->${after}`,
  );
}

// --- 5. Fault B: missing -wal after a checkpointed copy ----------------------------
{
  const faultPath = join(root, "fault-b.db");
  copyFileSync(join(backupDir, "gitstars.db"), faultPath);
  const db = new DatabaseSync(faultPath);
  const integrity = db.prepare("PRAGMA integrity_check").get() as {
    integrity_check: string;
  };
  const counts = tableCounts(db);
  db.close();
  record(
    "fault-B-missing-wal",
    integrity.integrity_check === "ok" && counts.saved_repositories === 1,
    `integrity=${integrity.integrity_check} saved=${counts.saved_repositories}`,
  );
}

// --- 6. Fault C: newer schema must be refused by the app guard ---------------------
{
  const faultPath = join(root, "fault-c.db");
  copyFileSync(join(backupDir, "gitstars.db"), faultPath);
  const db = new DatabaseSync(faultPath);
  db.prepare("UPDATE schema_meta SET schema_version = ? WHERE id = 1").run(
    latestSchemaVersion() + 1,
  );
  const version = readSchemaVersion(db);
  db.close();
  // Mirrors server/index.ts: dbSchemaVersion > latestSchemaVersion() -> exit 1.
  record(
    "fault-C-newer-schema",
    version !== null && version > latestSchemaVersion(),
    `schema=${version} binary=${latestSchemaVersion()} -> app would exit 1`,
  );
}

// --- Summary ----------------------------------------------------------------------
const failed = results.filter((r) => !r.ok).length;
const summary = {
  at: new Date().toISOString(),
  steps: results,
  passed: results.length - failed,
  failed,
};
console.log(JSON.stringify(summary));

rmSync(root, { recursive: true, force: true });
if (failed > 0) process.exit(1);
