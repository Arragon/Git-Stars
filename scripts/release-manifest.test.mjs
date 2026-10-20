// scripts/release-manifest.test.mjs
// M7-09: the manifest must be cwd-independent (release runs it from release/) and must
// refuse a placeholder version.

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "release-manifest.mjs",
);

function run(cwd, env) {
  return execFileSync(process.execPath, [SCRIPT, "artifact.tar.gz"], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

describe("release manifest (M7-09)", () => {
  it("runs from any cwd and reports the tag-derived version", () => {
    const dir = mkdtempSync(join(tmpdir(), "manifest-"));
    writeFileSync(join(dir, "artifact.tar.gz"), "x");

    const manifest = JSON.parse(run(dir, { RELEASE_VERSION: "0.1.0" }));
    expect(manifest.version).toBe("0.1.0");
    expect(manifest.appVersion).toBe("0.1.0");
    expect(manifest.artifacts).toHaveLength(1);
    expect(manifest.artifacts[0].name).toBe("artifact.tar.gz");
    expect(manifest.signed).toBe(false);
  });

  it("refuses a placeholder version when RELEASE_VERSION is absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "manifest-"));
    writeFileSync(join(dir, "artifact.tar.gz"), "x");

    expect(() => run(dir, { RELEASE_VERSION: "" })).toThrow();
  });
});
