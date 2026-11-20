import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, test } from "vitest";
import { loadExplicitEnvFile } from "@/modules/phase7/env";
import {
  APPROVED_TTMT_WORKBOOK_SHA256,
  ProductionReadinessError,
  assertExternalOperatorFile,
  assertProductionReadiness,
  loadProductionReadinessFile,
  redactOperatorMessage,
  type ProductionReadinessEvidence,
} from "@/modules/phase7/production-readiness";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function evidence(overrides: Partial<ProductionReadinessEvidence> = {}): ProductionReadinessEvidence {
  return {
    provider: "tidb-cloud",
    database: "drug_master_platform",
    storage: {
      observationTimestamp: "2026-11-20T20:00:00+07:00",
      currentUsageBytes: 1_000,
      quotaBytes: 10_000,
      availableBytes: 9_000,
      headroomEvidence: "TiDB Console Starter usage and spending-limit observation",
      adequateForOperations: ["preflight", "maintenance", "tidb-probe", "migrate-0018", "migrate-0019", "ttmt-replacement"],
      operatorConfirmedAdequate: true,
    },
    backup: {
      exportId: "exp-5cdjkve5g5cklkxyb4ucfciplm",
      manifestSha256: "f1424e623621be1c001aa862f89edaadbfcd86008e7aa34c2efa4d89432b7362",
      recoveryRehearsal: "PASS",
      rehearsedAt: "2026-11-20T21:00:00+07:00",
    },
    workbook: { sha256: APPROVED_TTMT_WORKBOOK_SHA256, rowCount: 9_654, verifiedAt: "2026-11-20T18:00:00+07:00" },
    probe: {
      operationId: "00000000-0000-4000-8000-000000000099",
      result: "PASS",
      completedAt: "2026-11-20T21:30:00+07:00",
      cleanup: "PASS",
    },
    maintenance: {
      windowId: "mw-20261120-phase2",
      approved: true,
      active: true,
      operatorId: "00000000-0000-4000-8000-000000000001",
      approvedAt: "2026-11-20T21:15:00+07:00",
      approvedOperations: ["preflight", "maintenance", "tidb-probe", "migrate-0018", "migrate-0019", "ttmt-replacement"],
    },
    ...overrides,
  };
}

test("loads readiness evidence only from an external strict file", () => {
  const directory = mkdtempSync(join(tmpdir(), "production-readiness-"));
  directories.push(directory);
  const path = join(directory, "readiness.json");
  writeFileSync(path, JSON.stringify(evidence()));
  assert.equal(loadProductionReadinessFile(path, resolve(".")).database, evidence().database);
});

test("requires storage, maintenance, and successful probe evidence for Production writes", () => {
  assert.doesNotThrow(() => assertProductionReadiness(evidence(), "migrate-0018", { requireProbe: true }));
  assert.throws(
    () => assertProductionReadiness(evidence({ probe: undefined }), "migrate-0018", { requireProbe: true }),
    (error: unknown) => error instanceof ProductionReadinessError && error.code === "TIDB_PROBE_REQUIRED",
  );
  assert.throws(
    () => assertProductionReadiness(evidence({
      storage: { ...evidence().storage, adequateForOperations: ["preflight"] },
    }), "migrate-0018", { requireProbe: true }),
    (error: unknown) => error instanceof ProductionReadinessError && error.code === "STORAGE_EVIDENCE_MISSING",
  );
});

test("rejects repository env files and clears inherited database values", () => {
  assert.throws(() => assertExternalOperatorFile(join(resolve("."), ".env.local"), resolve("."), "Production environment"));
  const directory = mkdtempSync(join(tmpdir(), "explicit-production-env-"));
  directories.push(directory);
  const path = join(directory, "production.env");
  writeFileSync(path, "DB_DATABASE=drug_master_platform\n");
  const previousHost = process.env.DB_HOST;
  const previousDatabase = process.env.DB_DATABASE;
  process.env.DB_HOST = "inherited.example";
  try {
    loadExplicitEnvFile(path);
    assert.equal(process.env.DB_HOST, undefined);
    assert.equal(process.env.DB_DATABASE, "drug_master_platform");
  } finally {
    if (previousHost === undefined) delete process.env.DB_HOST;
    else process.env.DB_HOST = previousHost;
    if (previousDatabase === undefined) delete process.env.DB_DATABASE;
    else process.env.DB_DATABASE = previousDatabase;
  }
});

test("operator output redacts credentials and URLs", () => {
  const output = redactOperatorMessage("password=secret token=abc mysql://user:pass@example/db");
  assert.doesNotMatch(output, /secret|abc|user:pass/);
  assert.match(output, /\[REDACTED\]/);
});
