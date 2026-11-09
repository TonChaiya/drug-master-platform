import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { loadExplicitEnvFile } from "@/modules/phase7/env";
import { Phase7GuardError, assertOperationalTarget } from "@/modules/phase7/guards";

const migrations = [
  "0014_tmt_data_model_v2.sql",
  "0015_ttmt_data_model_v2.sql",
  "0016_mapping_v2_identity.sql",
];

const production = {
  environment: "production" as const,
  host: "gateway01.ap-southeast-1.prod.aws.tidbcloud.com",
  port: 4000,
  database: "drug_master_platform",
  serverVersion: "8.0.11-TiDB-v8.5.3-serverless",
  appliedMigrations: ["0013_shared_rate_limits.sql", ...migrations],
  maintenanceEnabled: true,
  executeRequested: true,
  confirmDatabase: "drug_master_platform",
};

test("production execution requires every explicit identity and maintenance guard", () => {
  assert.doesNotThrow(() => assertOperationalTarget(production, { forExecution: true, requiredMigrations: migrations }));

  for (const [field, value, code] of [
    ["host", "127.0.0.1", "PRODUCTION_HOST_INVALID"],
    ["port", 3306, "PRODUCTION_PORT_INVALID"],
    ["database", "jhcisdb", "DATABASE_FORBIDDEN"],
    ["database", "other", "PRODUCTION_DATABASE_INVALID"],
    ["serverVersion", "8.4.3 MySQL", "PRODUCTION_ENGINE_INVALID"],
    ["maintenanceEnabled", false, "MAINTENANCE_REQUIRED"],
    ["executeRequested", false, "EXECUTE_FLAG_REQUIRED"],
    ["confirmDatabase", "other", "DATABASE_CONFIRMATION_MISMATCH"],
  ] as const) {
    assert.throws(
      () => assertOperationalTarget({ ...production, [field]: value }, { forExecution: true, requiredMigrations: migrations }),
      (error: unknown) => error instanceof Phase7GuardError && error.code === code,
    );
  }
});
test("dry-run validates readiness without requiring execute or confirmation", () => {
  assert.doesNotThrow(() => assertOperationalTarget(
    { ...production, executeRequested: false, confirmDatabase: undefined },
    { forExecution: false, requiredMigrations: migrations },
  ));
});
test("maintenance control may validate identity before maintenance is enabled", () => {
  assert.doesNotThrow(() => assertOperationalTarget(
    { ...production, maintenanceEnabled: false },
    { forExecution: true, requiredMigrations: ["0013_shared_rate_limits.sql"], requireMaintenance: false },
  ));
});

test("missing migration and unsafe local target fail closed", () => {
  assert.throws(
    () => assertOperationalTarget({ ...production, appliedMigrations: migrations.slice(0, 2) }, { forExecution: false, requiredMigrations: migrations }),
    (error: unknown) => error instanceof Phase7GuardError && error.code === "MIGRATION_REQUIRED",
  );
  assert.throws(
    () => assertOperationalTarget({ ...production, environment: "local", host: "localhost", port: 3307, database: "drug_master_local" }, { forExecution: false, requiredMigrations: migrations }),
    (error: unknown) => error instanceof Phase7GuardError && error.code === "LOCAL_DATABASE_INVALID",
  );
});

test("explicit env loading replaces inherited values instead of falling back to .env.local", () => {
  const directory = mkdtempSync(join(tmpdir(), "phase7-env-"));
  const path = join(directory, "explicit.env");
  writeFileSync(path, "DB_DATABASE=drug_master_phase7_readiness_test\n");
  const previous = process.env.DB_DATABASE;
  process.env.DB_DATABASE = "drug_master_platform";
  try {
    loadExplicitEnvFile(path);
    assert.equal(process.env.DB_DATABASE, "drug_master_phase7_readiness_test");
  } finally {
    if (previous === undefined) delete process.env.DB_DATABASE;
    else process.env.DB_DATABASE = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
