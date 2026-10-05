// scripts/check-api-contract.mjs
// Machine check for the service API contract (ADR-0006 D7, INH-315).
//
// 1. Structural validation of server/openapi.yaml (parses, versions present,
//    every operation documents responses, error envelope exists, no dead $refs).
// 2. Breaking-change diff against a base revision when OPENAPI_BASE is set
//    (CI passes the previous committed spec on PRs). Exit 1 on any breaking
//    change so the release gate can block it.
//
// Usage:
//   node scripts/check-api-contract.mjs                 # validation only
//   OPENAPI_BASE=/tmp/openapi.base.yaml node scripts/... # validation + diff

import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const yaml = require("js-yaml");

const SPEC_PATH = "server/openapi.yaml";
const HTTP_METHODS = new Set([
  "get",
  "put",
  "post",
  "delete",
  "patch",
  "head",
  "options",
  "trace",
]);

function fail(messages) {
  for (const m of messages) console.error(`  ✗ ${m}`);
  console.error(
    `API contract check failed with ${messages.length} problem(s).`,
  );
  process.exit(1);
}

function loadSpec(path) {
  if (!existsSync(path)) {
    console.error(`✗ Spec not found: ${path}`);
    process.exit(1);
  }
  return yaml.load(readFileSync(path, "utf8"));
}

function resolveRef(spec, ref) {
  const parts = ref.replace(/^#\//, "").split("/");
  let node = spec;
  for (const part of parts) node = node?.[part];
  return node;
}

// --- 1. Structural validation ---

function validate(spec) {
  const problems = [];

  if (!/^3\.\d+\.\d+$/.test(String(spec.openapi ?? ""))) {
    problems.push("openapi field must be a 3.x version string");
  }
  if (!spec.info?.title || !spec.info?.version) {
    problems.push("info.title and info.version are required");
  }
  if (!spec.paths || Object.keys(spec.paths).length === 0) {
    problems.push("paths must not be empty");
  }

  // Collect every $ref target to catch dead references.
  const refs = [];
  const walk = (node, path) => {
    if (node == null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${path}/${i}`));
      return;
    }
    if (typeof node.$ref === "string") refs.push([node.$ref, path]);
    for (const [key, value] of Object.entries(node))
      walk(value, `${path}/${key}`);
  };
  walk(spec, "");

  for (const op of Object.values(spec.paths ?? {})) {
    for (const method of Object.keys(op)) {
      if (!HTTP_METHODS.has(method)) continue;
      const operation = op[method];
      if (
        !operation.responses ||
        Object.keys(operation.responses).length === 0
      ) {
        problems.push(`${method.toUpperCase()} ${op} documents no responses`);
      }
    }
  }

  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    for (const method of Object.keys(item)) {
      if (!HTTP_METHODS.has(method)) continue;
      const responses = item[method]?.responses ?? {};
      for (const [status, response] of Object.entries(responses)) {
        // A $ref'd component response carries its own description — resolve it.
        const resolved = response.$ref
          ? resolveRef(spec, response.$ref)
          : response;
        if (!resolved?.description) {
          problems.push(
            `${method.toUpperCase()} ${path} response ${status} has no description`,
          );
        }
      }
    }
  }

  for (const [ref, at] of refs) {
    if (!ref.startsWith("#/")) continue;
    if (resolveRef(spec, ref) === undefined) {
      problems.push(`dead $ref ${ref} (at ${at})`);
    }
  }

  return problems;
}

// --- 2. Breaking-change diff ---

function operations(spec) {
  const map = new Map(); // "GET /path" -> operation object
  for (const [path, item] of Object.entries(spec?.paths ?? {})) {
    for (const method of Object.keys(item)) {
      if (HTTP_METHODS.has(method))
        map.set(`${method.toUpperCase()} ${path}`, item[method]);
    }
  }
  return map;
}

function requiredBodyFields(spec, op) {
  const schema = op?.requestBody?.content?.["application/json"]?.schema;
  const resolved =
    schema?.$ref && spec ? resolveRef(spec, schema.$ref) : schema;
  return new Set(resolved?.required ?? []);
}

function responseStatuses(op) {
  return new Set(Object.keys(op?.responses ?? {}));
}

function errorCodes(spec) {
  const envelope = resolveRef(spec, "#/components/schemas/ErrorEnvelope");
  const codeProp = envelope?.properties?.code;
  return new Set(codeProp?.enum ?? []);
}

function diffBreaking(base, next) {
  const breaking = [];

  const baseOps = operations(base);
  const nextOps = operations(next);
  for (const key of baseOps.keys()) {
    if (!nextOps.has(key)) breaking.push(`operation removed: ${key}`);
  }
  for (const key of baseOps.keys()) {
    const before = responseStatuses(baseOps.get(key));
    const after = nextOps.get(key);
    if (!after) continue;
    for (const status of before) {
      if (!responseStatuses(after).has(status)) {
        breaking.push(`response ${status} removed from ${key}`);
      }
    }
    // A parameter that was optional becoming required breaks existing clients.
    const beforeParams = baseOps.get(key).parameters ?? [];
    const afterParams = after.parameters ?? [];
    for (const p of beforeParams) {
      if (!p.required) continue;
      const match = afterParams.find((q) => q.name === p.name && q.in === p.in);
      if (!match)
        breaking.push(`required parameter ${p.name} removed from ${key}`);
    }
    const beforeBody = requiredBodyFields(base, baseOps.get(key));
    const afterBody = requiredBodyFields(next, after);
    for (const field of beforeBody) {
      if (!afterBody.has(field)) {
        breaking.push(`required request field "${field}" removed from ${key}`);
      }
    }
  }

  // The error code catalog may only grow.
  const beforeCodes = errorCodes(base);
  const afterCodes = errorCodes(next);
  for (const code of beforeCodes) {
    if (!afterCodes.has(code))
      breaking.push(`error code removed from catalog: ${code}`);
  }

  return breaking;
}

// --- main ---

const spec = loadSpec(SPEC_PATH);
const validationProblems = validate(spec);
if (validationProblems.length > 0) fail(validationProblems);
console.log(
  `✓ ${SPEC_PATH} is structurally valid (${Object.keys(spec.paths).length} paths)`,
);

const basePath = process.env.OPENAPI_BASE;
if (basePath) {
  const base = loadSpec(basePath);
  const breaking = diffBreaking(base, spec);
  if (breaking.length > 0) {
    console.error(
      `\nBreaking API contract changes vs ${basePath}:\n` +
        breaking.map((b) => `  ✗ ${b}`).join("\n"),
    );
    process.exit(1);
  }
  console.log(`✓ no breaking changes vs ${basePath}`);
} else {
  console.log("ℹ OPENAPI_BASE not set — skipping breaking-change diff.");
}
