// scripts/release-manifest.mjs
// Release manifest generator (INH-494/528): machine-readable provenance for a
// release — version, commit, contract/protocol versions, artifact names with
// sha256 checksums, and an explicit signed/unsigned status. Deterministic for a
// given commit + artifacts; CI embeds the output in the release job summary.
//
// Usage: node scripts/release-manifest.mjs <artifact>...
// Environment overrides: RELEASE_VERSION (defaults to package.json version).

import { readFileSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";

function sh(cmd) {
  return execSync(cmd, { encoding: "utf8" }).trim();
}

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const version = process.env.RELEASE_VERSION ?? pkg.version;
const commit = sh("git rev-parse HEAD");
const commitShort = commit.slice(0, 12);

// Protocol/contract versions come from server/versions.ts (single source of truth).
const versionsSrc = readFileSync("server/versions.ts", "utf8");
function constant(name) {
  const match = new RegExp(`export const ${name}\\s*=\\s*"?([^"\\n;]+)"?`).exec(
    versionsSrc,
  );
  return match ? match[1] : null;
}

const artifacts = [];
for (const path of process.argv.slice(2)) {
  if (!existsSync(path)) {
    console.error(`artifact not found: ${path}`);
    process.exit(1);
  }
  const buf = readFileSync(path);
  artifacts.push({
    name: path,
    sha256: createHash("sha256").update(buf).digest("hex"),
    bytes: statSync(path).size,
  });
}

const manifest = {
  name: "gitstars",
  version,
  commit,
  generatedAt: new Date().toISOString(),
  protocolVersion: Number(constant("PROTOCOL_VERSION")),
  listSchemaVersion: Number(constant("LIST_SCHEMA_VERSION")),
  minAppVersion: constant("MIN_APP_VERSION"),
  appVersion: constant("APP_VERSION") ?? version,
  artifacts,
  // Signing/notarization requires real credentials (External-Block, INH-494).
  // The pipeline NEVER claims a signed release without them.
  signed: false,
  signedStatus: "unsigned-test-artifact",
};

console.log(JSON.stringify(manifest, null, 2));
