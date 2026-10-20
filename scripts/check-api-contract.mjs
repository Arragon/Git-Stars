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

export function validate(spec) {
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
  const map = new Map(); // "GET /path" -> { op, item }
  for (const [path, item] of Object.entries(spec?.paths ?? {})) {
    for (const method of Object.keys(item)) {
      if (HTTP_METHODS.has(method)) {
        map.set(`${method.toUpperCase()} ${path}`, {
          op: item[method],
          item,
        });
      }
    }
  }
  return map;
}

// Merge path-item and operation parameters, resolving $ref. Without this the parameter
// gate silently ignores every $ref'd parameter (the common case in our spec).
function paramsOf(spec, item, op) {
  const merged = new Map(); // "in:name" -> param
  for (const raw of [...(item?.parameters ?? []), ...(op?.parameters ?? [])]) {
    const param = raw?.$ref ? resolveRef(spec, raw.$ref) : raw;
    if (!param?.name || !param?.in) continue;
    merged.set(`${param.in}:${param.name}`, param);
  }
  return merged;
}

function requiredBodyFields(spec, op) {
  const schema = op?.requestBody?.content?.["application/json"]?.schema;
  const resolved =
    schema?.$ref && spec ? resolveRef(spec, schema.$ref) : schema;
  return new Set(resolved?.required ?? []);
}

function bodyPropertyNames(spec, op) {
  const schema = op?.requestBody?.content?.["application/json"]?.schema;
  const resolved =
    schema?.$ref && spec ? resolveRef(spec, schema.$ref) : schema;
  return new Set(Object.keys(resolved?.properties ?? {}));
}

function responseStatuses(op) {
  return new Set(Object.keys(op?.responses ?? {}));
}

function errorCodes(spec) {
  const envelope = resolveRef(spec, "#/components/schemas/ErrorEnvelope");
  const codeProp = envelope?.properties?.code;
  return new Set(codeProp?.enum ?? []);
}

export function diffBreaking(base, next) {
  const breaking = [];

  const baseOps = operations(base);
  const nextOps = operations(next);
  for (const key of baseOps.keys()) {
    if (!nextOps.has(key)) breaking.push(`operation removed: ${key}`);
  }
  for (const key of baseOps.keys()) {
    const before = baseOps.get(key);
    const after = nextOps.get(key);
    if (!after) continue;
    const beforeOp = before.op;
    const afterOp = after.op;

    for (const status of responseStatuses(beforeOp)) {
      if (!responseStatuses(afterOp).has(status)) {
        breaking.push(`response ${status} removed from ${key}`);
      }
    }

    // Parameters: removal of a required one, optional -> required, and newly required.
    const beforeParams = paramsOf(base, before.item, beforeOp);
    const afterParams = paramsOf(next, after.item, afterOp);
    for (const [id, param] of beforeParams) {
      const match = afterParams.get(id);
      if (param.required && !match) {
        breaking.push(`required parameter ${param.name} removed from ${key}`);
      } else if (!param.required && match?.required) {
        breaking.push(`parameter ${param.name} became required in ${key}`);
      }
    }
    for (const [id, param] of afterParams) {
      if (param.required && !beforeParams.has(id)) {
        breaking.push(`new required parameter ${param.name} added to ${key}`);
      }
    }

    // Request body: required fields may only shrink if they were optional; a field that
    // was optional becoming required (or a newly required field) breaks old clients.
    const beforeBody = requiredBodyFields(base, beforeOp);
    const afterBody = requiredBodyFields(next, afterOp);
    const afterAllFields = bodyPropertyNames(next, afterOp);
    for (const field of beforeBody) {
      // Removed from the schema entirely is breaking; becoming optional is a relaxation.
      if (!afterAllFields.has(field)) {
        breaking.push(`required request field "${field}" removed from ${key}`);
      }
    }
    for (const field of afterBody) {
      if (!beforeBody.has(field)) {
        breaking.push(`request field "${field}" became required in ${key}`);
      }
    }
    if (
      beforeOp.requestBody &&
      afterOp.requestBody &&
      !beforeOp.requestBody.required &&
      afterOp.requestBody.required
    ) {
      breaking.push(`request body became required in ${key}`);
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

function main() {
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
}

// Only run when invoked as a CLI (the test file imports the pure functions instead).
if (process.argv[1] && process.argv[1].endsWith("check-api-contract.mjs")) {
  main();
}
