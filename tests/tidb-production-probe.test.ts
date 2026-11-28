import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "vitest";
import {
  TidbProductionProbeError,
  assertNoProbeCollisions,
  assertProbeOwnership,
  buildTidbProbePlan,
} from "@/modules/phase7/tidb-production-probe";

const operationId = "00000000-0000-4000-8000-000000000099";
const ownerToken = "a".repeat(64);

describe("ownership-guarded TiDB Production probe", () => {
  test("builds only isolated SQL needed by migrations and replacement locking", () => {
    const plan = buildTidbProbePlan(operationId, ownerToken);
    assert.match(plan.parentTable, /^dm_probe_[a-f0-9]{12}_parent$/);
    assert.match(plan.createParent, /CHAR\(36\).*utf8mb4_unicode_ci.*PRIMARY KEY.*UNIQUE KEY/is);
    assert.match(plan.createChild, /FOREIGN KEY.*REFERENCES/is);
    assert.match(plan.alterNullable, /ALTER TABLE.*ADD COLUMN.*NULL/is);
    assert.match(plan.alterLegacyEvidenceNullable, /MODIFY COLUMN evidence_import_id CHAR\(36\).*utf8mb4_unicode_ci NULL.*MODIFY COLUMN evidence_hash CHAR\(64\) NULL.*MODIFY COLUMN evidence_rows INT UNSIGNED NULL/is);
    assert.match(plan.ownerComment, /^dm_probe_owner:[a-f0-9]{64}$/);
  });

  test("rejects collisions and unowned objects before cleanup", () => {
    const plan = buildTidbProbePlan(operationId, ownerToken);
    assert.throws(
      () => assertNoProbeCollisions([plan.parentTable]),
      (error: unknown) => error instanceof TidbProductionProbeError && error.code === "PROBE_OBJECT_COLLISION",
    );
    assert.throws(
      () => assertProbeOwnership([{ tableName: plan.parentTable, tableComment: "other-owner" }], plan),
      (error: unknown) => error instanceof TidbProductionProbeError && error.code === "PROBE_OWNERSHIP_MISMATCH",
    );
    assert.doesNotThrow(() => assertProbeOwnership([
      { tableName: plan.parentTable, tableComment: plan.ownerComment },
      { tableName: plan.childTable, tableComment: plan.ownerComment },
    ], plan));
  });

  test("probe source covers rollback, FK enforcement, row locking and ownership-only cleanup", async () => {
    const source = await readFile(new URL("../src/modules/phase7/tidb-production-probe.ts", import.meta.url), "utf8");
    assert.match(source, /beginTransaction/);
    assert.match(source, /rollback/);
    assert.match(source, /FOREIGN KEY/);
    assert.match(source, /FOR UPDATE/);
    assert.match(source, /innodb_lock_wait_timeout/);
    assert.match(source, /TABLE_COMMENT/);
    assert.doesNotMatch(source, /\b(?:drug_mappings|ttmt_products|tmt_concept|schema_migrations)\b/);
    assert.doesNotMatch(source, /CASCADE|CREATE DATABASE/i);
  });
});
