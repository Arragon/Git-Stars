// scripts/check-api-contract.test.mjs
// M7-10 / INH-1706: the compatibility gate must fail truly breaking changes and pass
// relaxations. Previously the parameter loop skipped every optional param (and every
// $ref'd param), so "optional became required" was never detected.

import { describe, expect, it } from "vitest";
import { diffBreaking } from "./check-api-contract.mjs";

const COMPONENTS = {
  schemas: {
    ErrorEnvelope: { properties: { code: { enum: ["A", "B"] } } },
  },
};

function spec(paths) {
  return {
    openapi: "3.0.0",
    info: { title: "test", version: "1" },
    paths,
    components: JSON.parse(JSON.stringify(COMPONENTS)),
  };
}

const OK = { 200: { description: "ok" } };

describe("diffBreaking · parameters", () => {
  it("detects optional -> required", () => {
    const base = spec({
      "/items": {
        get: {
          parameters: [
            { name: "cursor", in: "query", required: false, schema: {} },
          ],
          responses: OK,
        },
      },
    });
    const next = spec({
      "/items": {
        get: {
          parameters: [
            { name: "cursor", in: "query", required: true, schema: {} },
          ],
          responses: OK,
        },
      },
    });

    expect(diffBreaking(base, next)).toContain(
      "parameter cursor became required in GET /items",
    );
  });

  it("detects a newly added required parameter", () => {
    const base = spec({ "/items": { get: { responses: OK } } });
    const next = spec({
      "/items": {
        get: {
          parameters: [{ name: "q", in: "query", required: true, schema: {} }],
          responses: OK,
        },
      },
    });

    expect(diffBreaking(base, next)).toContain(
      "new required parameter q added to GET /items",
    );
  });

  it("resolves $ref'd parameters instead of silently ignoring them", () => {
    const base = spec({
      "/items": {
        get: {
          parameters: [{ $ref: "#/components/parameters/Cursor" }],
          responses: OK,
        },
      },
    });
    const next = spec({
      "/items": {
        get: {
          parameters: [{ $ref: "#/components/parameters/Cursor" }],
          responses: OK,
        },
      },
    });
    base.components.parameters = {
      Cursor: { name: "cursor", in: "query", required: false, schema: {} },
    };
    next.components.parameters = {
      Cursor: { name: "cursor", in: "query", required: true, schema: {} },
    };

    expect(diffBreaking(base, next)).toContain(
      "parameter cursor became required in GET /items",
    );
  });

  it("passes when a required parameter becomes optional (relaxation)", () => {
    const base = spec({
      "/items": {
        get: {
          parameters: [
            { name: "cursor", in: "query", required: true, schema: {} },
          ],
          responses: OK,
        },
      },
    });
    const next = spec({
      "/items": {
        get: {
          parameters: [
            { name: "cursor", in: "query", required: false, schema: {} },
          ],
          responses: OK,
        },
      },
    });

    expect(diffBreaking(base, next)).toEqual([]);
  });
});

describe("diffBreaking · request bodies", () => {
  const withBody = (required, properties) =>
    spec({
      "/items": {
        post: {
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: { type: "object", required, properties },
              },
            },
          },
          responses: OK,
        },
      },
    });

  it("detects optional -> required", () => {
    const base = withBody([], { note: { type: "string" } });
    const next = withBody(["note"], { note: { type: "string" } });
    expect(diffBreaking(base, next)).toContain(
      'request field "note" became required in POST /items',
    );
  });

  it("detects a newly required field", () => {
    const base = withBody(["note"], { note: { type: "string" } });
    const next = withBody(["note", "status"], {
      note: { type: "string" },
      status: { type: "string" },
    });
    expect(diffBreaking(base, next)).toContain(
      'request field "status" became required in POST /items',
    );
  });

  it("passes when a required field becomes optional", () => {
    const base = withBody(["note"], { note: { type: "string" } });
    const next = withBody([], { note: { type: "string" } });
    expect(diffBreaking(base, next)).toEqual([]);
  });

  it("still flags a required field removed from the schema", () => {
    const base = withBody(["note"], { note: { type: "string" } });
    const next = withBody([], { other: { type: "string" } });
    expect(diffBreaking(base, next)).toContain(
      'required request field "note" removed from POST /items',
    );
  });

  it("detects requestBody.required flipping to true", () => {
    const base = spec({
      "/items": {
        post: {
          requestBody: {
            required: false,
            content: {
              "application/json": { schema: { type: "object" } },
            },
          },
          responses: OK,
        },
      },
    });
    const next = spec({
      "/items": {
        post: {
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { type: "object" } },
            },
          },
          responses: OK,
        },
      },
    });
    expect(diffBreaking(base, next)).toContain(
      "request body became required in POST /items",
    );
  });
});

describe("diffBreaking · existing rules stay intact", () => {
  it("flags removed operations and shrinking error catalogs", () => {
    const base = spec({
      "/a": { get: { responses: OK } },
      "/b": { get: { responses: OK } },
    });
    const next = spec({ "/a": { get: { responses: OK } } });
    next.components.schemas.ErrorEnvelope = {
      properties: { code: { enum: ["A"] } },
    };
    const breaking = diffBreaking(base, next);
    expect(breaking).toContain("operation removed: GET /b");
    expect(breaking).toContain("error code removed from catalog: B");
  });
});
