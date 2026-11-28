import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { describe, expect, test, vi } from "vitest";
import {
  EXPECTED_MIGRATION_0019_SHA256,
  MIGRATION_0019_FILENAME,
  executeGuardedMigration0019,
  parseMigration0019Cli,
  type Migration0019Dependencies,
  type Migration0019Request,
  type Migration0019Snapshot,
} from "@/db/migration-0019-guard";
import { EXPECTED_MIGRATION_0018_SHA256, MIGRATION_0018_FILENAME } from "@/db/migration-0018-guard";
import { activeStandardReleaseEnabled } from "@/modules/tmt/feature";

const prior = [
  ...Array.from({ length: 17 }, (_, index) => ({ filename: `${String(index + 1).padStart(4, "0")}_migration.sql`, contentHash: String(index + 1).padStart(64, "0") })),
  { filename: MIGRATION_0018_FILENAME, contentHash: EXPECTED_MIGRATION_0018_SHA256 },
];
const reviewedMigration = readFileSync(new URL("../src/db/migrations/0019_ttmt_source_fidelity.sql", import.meta.url), "utf8");
const request = (overrides: Partial<Migration0019Request> = {}): Migration0019Request => ({
  environment: "production", envFile: "C:\\secure\\production.env", execute: false,
  maintenanceApproved: false, rehearsalIntent: false,
  productionIntent: true, guardedOperation: "migrate-0019",
  actorUserId: "00000000-0000-4000-8000-000000000001", reason: "approved TTMT fidelity migration", ...overrides,
});
const snapshot = (overrides: Partial<Migration0019Snapshot> = {}): Migration0019Snapshot => ({
  host: "gateway.prod.tidbcloud.com", port: 4000, database: "drug_master_platform", serverVersion: "TiDB-v8.5.3",
  tlsVerified: true, maintenanceAvailable: true, maintenanceEnabled: true, journal: prior,
  provider: "tidb-cloud", driver: "mysql2",
  tables: ["ttmt_products", "ttmt_dataset_products"], columns: [], ...overrides,
});
function deps(overrides: Partial<Migration0019Dependencies> = {}): Migration0019Dependencies {
  return {
    expectedPriorJournal: prior,
    migrationSql: reviewedMigration,
    migrationHash: EXPECTED_MIGRATION_0019_SHA256, inspectTarget: vi.fn(async () => snapshot()),
    executeStatement: vi.fn(async () => undefined), verifySchema: vi.fn(async () => true), recordJournal: vi.fn(async () => undefined), ...overrides,
  };
}

describe("guarded Migration 0019", () => {
  test("Migration 0018 is additive schema only and does not activate release reads", async () => {
    const migration = await readFile(new URL("../src/db/migrations/0018_versioned_standard_dataset_foundation.sql", import.meta.url), "utf8");
    assert.doesNotMatch(migration, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|DROP)\b/i);
    assert.equal(activeStandardReleaseEnabled({}), false);
  });

  test("requires reviewed 0018 immediately before 0019 and keeps Dataset Release off by default", async () => {
    assert.equal(activeStandardReleaseEnabled({}), false);
    await expect(executeGuardedMigration0019(request(), deps({
      inspectTarget: vi.fn(async () => snapshot({ journal: prior.slice(0, 17) })),
    }))).rejects.toMatchObject({ code: "JOURNAL_INCOMPLETE" });
    await expect(executeGuardedMigration0019(request(), deps({
      inspectTarget: vi.fn(async () => snapshot({ journal: [...prior, { filename: MIGRATION_0019_FILENAME, contentHash: EXPECTED_MIGRATION_0019_SHA256 }] })),
    }))).rejects.toMatchObject({ code: "MIGRATION_ALREADY_APPLIED" });
  });

  test("dry-run plans only 0019 without DDL or journal writes", async () => {
    const dependencies = deps();
    const result = await executeGuardedMigration0019(request(), dependencies);
    assert.equal(result.mode, "dry-run");
    assert.equal(result.migration, MIGRATION_0019_FILENAME);
    expect(dependencies.executeStatement).not.toHaveBeenCalled();
    expect(dependencies.recordJournal).not.toHaveBeenCalled();
  });

  test.each([
    ["DEPENDENCY_TABLE_MISSING", { tables: ["ttmt_products"] }],
    ["PARTIAL_SCHEMA", { columns: [{ table: "ttmt_products", column: "ttmt_type", type: "varchar(64)", nullable: true }] }],
    ["PRODUCTION_DATABASE_INVALID", { database: "other" }],
  ] as const)("refuses %s", async (code, target) => {
    const dependencies = deps({ inspectTarget: vi.fn(async () => snapshot(target)) });
    await expect(executeGuardedMigration0019(request(), dependencies)).rejects.toMatchObject({ code });
    expect(dependencies.executeStatement).not.toHaveBeenCalled();
  });

  test("TiDB executes ordered single-column DDL and journals the original hash after verification", async () => {
    const events: string[] = [];
    const dependencies = deps({
      executeStatement: vi.fn(async (sql, index) => { events.push(`sql:${index}`); assert.doesNotMatch(sql, /,/); }),
      verifySchema: vi.fn(async () => { events.push("verify"); return true; }),
      recordJournal: vi.fn(async () => { events.push("journal"); }),
    });
    const result = await executeGuardedMigration0019(request({
      execute: true, confirmDatabase: "drug_master_platform", confirmMigration: "0019",
      confirmHash: EXPECTED_MIGRATION_0019_SHA256, maintenanceApproved: true,
    }), dependencies);
    assert.equal(result.mode, "executed");
    assert.deepEqual(events, ["sql:1", "sql:2", "sql:3", "sql:4", "sql:5", "sql:6", "verify", "journal"]);
    expect(dependencies.executeStatement).toHaveBeenNthCalledWith(2, "ALTER TABLE ttmt_products ADD COLUMN change_date VARCHAR(64) NULL AFTER ttmt_type", 2);
    expect(dependencies.executeStatement).toHaveBeenNthCalledWith(6, "ALTER TABLE ttmt_dataset_products ADD COLUMN drug_group_nhso VARCHAR(120) NULL AFTER change_date", 6);
    expect(dependencies.recordJournal).toHaveBeenCalledWith(MIGRATION_0019_FILENAME, EXPECTED_MIGRATION_0019_SHA256);
  });

  test("isolated MySQL rehearsal keeps the two original statements", async () => {
    const dependencies = deps({ inspectTarget: vi.fn(async () => snapshot({
      host: "127.0.0.1", port: 3306, serverVersion: "8.4.3", provider: "local-mysql", tlsVerified: false,
    })) });
    const result = await executeGuardedMigration0019(request({
      environment: "local", productionIntent: false, rehearsalIntent: true, guardedOperation: undefined,
    }), dependencies);
    assert.equal(result.statementCount, 2);
  });

  test("partial DDL failure stops without journal write", async () => {
    const dependencies = deps({ executeStatement: vi.fn(async (_sql, index) => { if (index === 2) throw new Error("failed"); }) });
    await expect(executeGuardedMigration0019(request({
      execute: true, confirmDatabase: "drug_master_platform", confirmMigration: "0019",
      confirmHash: EXPECTED_MIGRATION_0019_SHA256, maintenanceApproved: true,
    }), dependencies)).rejects.toMatchObject({ code: "PARTIAL_DDL_FAILURE", statementIndex: 2 });
    expect(dependencies.recordJournal).not.toHaveBeenCalled();
  });

  test("CLI has no implicit env and executor never creates databases", async () => {
    expect(() => parseMigration0019Cli(["--environment", "production"])).toThrowError();
    const source = await readFile(new URL("../scripts/migrate-0019-guarded.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /\.env\.local|CREATE\s+DATABASE|process\.loadEnvFile/i);
    const migration0018 = await readFile(new URL("../src/db/migrations/0018_versioned_standard_dataset_foundation.sql", import.meta.url), "utf8");
    assert.doesNotMatch(migration0018, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|DROP)\b/i);
    const migration0019 = await readFile(new URL("../src/db/migrations/0019_ttmt_source_fidelity.sql", import.meta.url), "utf8");
    assert.equal(createHash("sha256").update(migration0019).digest("hex"), EXPECTED_MIGRATION_0019_SHA256);
  });
});
