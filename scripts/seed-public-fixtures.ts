// scripts/seed-public-fixtures.ts
// One-command build/destroy of the public Share/Hub fixture environment (INH-524).
//
// Build:  npm run seed:public
//   -> creates data/share-fixtures.db with every publication state and prints
//      how to run the server against it plus the share/HUB URLs.
// Destroy: npm run seed:public -- --destroy
//   -> deletes the fixture database files. Never touches data/gitstars.db.

import { existsSync, rmSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { initDb, getDb } from "../server/db.js";
import { cookieFor } from "../server/testing/bootstrap.js";
import { seedShareFixtures } from "../server/testing/shareFixtures.js";

const FIXTURE_DB = resolve("data/share-fixtures.db");
const DESTROY = process.argv.includes("--destroy");

const sidecars = ["", "-wal", "-shm"].map((s) => FIXTURE_DB + s);

if (DESTROY) {
  for (const file of sidecars) {
    if (existsSync(file)) rmSync(file);
  }
  console.log(`destroyed fixture environment: ${FIXTURE_DB}`);
  process.exit(0);
}

mkdirSync(dirname(FIXTURE_DB), { recursive: true });
for (const file of sidecars) {
  if (existsSync(file)) rmSync(file); // start clean every build
}

initDb(FIXTURE_DB);
const fixtures = seedShareFixtures("fixture-owner", cookieFor);

// Sanity: the fixture DB must contain the full publication set.
const count = (
  getDb().prepare("SELECT COUNT(*) AS n FROM list_publications").get() as {
    n: number;
  }
).n;
if (count !== 6) {
  console.error(`expected 6 publications, found ${count}`);
  process.exit(1);
}

console.log(`fixture environment ready: ${FIXTURE_DB}`);
console.log("");
console.log("Run the server against it:");
console.log("  DATABASE_PATH=data/share-fixtures.db npm run dev:server");
console.log("");
console.log("Share links (anonymous):");
[
  ["hub normal         ", fixtures.hubNormal],
  ["hub empty          ", fixtures.hubEmpty],
  ["hub cross-provider ", fixtures.hubCrossProvider],
  ["link-only partial  ", fixtures.linkOnlyPartial],
  ["revoked (404)      ", fixtures.revoked],
  ["takedown (404)     ", fixtures.takenDown],
].forEach(([label, shareId]) => {
  console.log(`  ${label} /s/${shareId}`);
});
console.log("");
console.log("Hub browse:  http://localhost:5173/hub  (search: hub|Fixture)");
console.log(
  "Owner login: set LOCAL_DEV_USER=fixture-owner, or POST /api/auth/dev-login.",
);
