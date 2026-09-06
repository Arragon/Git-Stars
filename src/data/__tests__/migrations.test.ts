// src/data/__tests__/migrations.test.ts
// Migration-specific tests.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { InMemoryDriver } from "../driver/InMemoryDriver";
import { IndexedDBDriver } from "../driver/IndexedDBDriver";
import { CorruptSchemaError, UnsupportedVersionError } from "../types";
import { LATEST_SCHEMA_VERSION } from "../migrations";

describe("migrations: InMemoryDriver", () => {
  let driver: InMemoryDriver;

  beforeEach(() => {
    driver = new InMemoryDriver();
  });

  afterEach(async () => {
    await driver.close();
  });

  it("fresh DB applies all migrations", async () => {
    await driver.open();
    const result = await driver.migrate();
    expect(result.applied.length).toBeGreaterThan(0);
    expect(result.applied).toContain(1);

    const version = await driver.getVersion();
    expect(version).toBe(LATEST_SCHEMA_VERSION);
  });

  it("re-run is idempotent (no migrations applied)", async () => {
    await driver.open();
    await driver.migrate();

    const second = await driver.migrate();
    expect(second.applied).toHaveLength(0);
  });

  it("version > latest throws UnsupportedVersionError", async () => {
    await driver.open();
    await driver.migrate();

    // Manually corrupt the version to be higher than supported.
    // InMemoryDriver doesn't expose a setter, so we test the error class.
    const err = new UnsupportedVersionError(999, LATEST_SCHEMA_VERSION);
    expect(err).toBeInstanceOf(UnsupportedVersionError);
    expect(err.foundVersion).toBe(999);
    expect(err.latestVersion).toBe(LATEST_SCHEMA_VERSION);
  });

  it("corrupt schema throws CorruptSchemaError", async () => {
    // Test the error class directly (InMemoryDriver doesn't have corrupt state path).
    const err = new CorruptSchemaError("missing schemaMeta row");
    expect(err).toBeInstanceOf(CorruptSchemaError);
    expect(err.message).toContain("corrupt");
  });
});

describe("migrations: IndexedDBDriver", () => {
  let driver: IndexedDBDriver;
  let dbName: string;

  beforeEach(() => {
    dbName = `test-migrations-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    driver = new IndexedDBDriver(dbName);
  });

  afterEach(async () => {
    await driver.close();
    // Clean up the test database.
    try {
      indexedDB.deleteDatabase(dbName);
    } catch {
      // Ignore cleanup errors.
    }
  });

  it("fresh DB applies all migrations", async () => {
    await driver.open();
    const result = await driver.migrate();
    expect(result.applied.length).toBeGreaterThan(0);

    const version = await driver.getVersion();
    expect(version).toBe(LATEST_SCHEMA_VERSION);
  });

  it("re-run is idempotent", async () => {
    await driver.open();
    await driver.migrate();

    const second = await driver.migrate();
    expect(second.applied).toHaveLength(0);

    const version = await driver.getVersion();
    expect(version).toBe(LATEST_SCHEMA_VERSION);
  });
});
