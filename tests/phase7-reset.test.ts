import assert from "node:assert/strict";
import { test } from "vitest";
import {
  KEEP_TABLES,
  RESET_TABLES,
  TMT_V2_RESET_TABLES,
  assertResetTable,
  resetTablesForMode,
  runPhase7Reset,
  type ResetStore,
} from "@/modules/phase7/reset";

test("Phase 7 reset uses an exact allowlist and hard-denies KEEP tables", () => {
  assert.ok(RESET_TABLES.includes("source_drugs"));
  assert.ok(RESET_TABLES.includes("ttmt_products"));
  assert.ok(KEEP_TABLES.includes("users"));
  assert.throws(() => assertResetTable("users", "full"), /KEEP/);
  assert.throws(() => assertResetTable("unknown_table", "full"), /allowlist/);
});

test("TMT-v2-only reset has the exact 17-table allowlist and hard-denies other namespaces", () => {
  assert.deepEqual(resetTablesForMode("tmt-v2-only"), TMT_V2_RESET_TABLES);
  assert.equal(TMT_V2_RESET_TABLES.length, 17);
  for (const table of ["users", "source_drugs", "drug_mappings", "ttmt_products", "standard_products"]) {
    assert.throws(() => assertResetTable(table, "tmt-v2-only"), /hard-denied|allowlist/);
  }
  assert.doesNotThrow(() => assertResetTable("tmt_sync_runs", "tmt-v2-only"));
});

test("reset dry-run reads counts but performs zero deletes", async () => {
  let deletes = 0;
  const store: ResetStore = { counts: async () => ({ source_drugs: 2 }), execute: async () => { deletes += 1; } };
  const result = await runPhase7Reset({ mode: "tmt-v2-only", execute: false, backupReference: "backup-1" }, store);
  assert.equal(result.executed, false);
  assert.equal(deletes, 0);
});

test("reset execute requires backup reference and delegates one atomic operation", async () => {
  let deletes = 0;
  const store: ResetStore = { counts: async () => ({}), execute: async () => { deletes += 1; } };
  await assert.rejects(() => runPhase7Reset({ mode: "tmt-v2-only", execute: true, backupReference: "" }, store), /backup/i);
  await runPhase7Reset({ mode: "tmt-v2-only", execute: true, backupReference: "backup-1" }, store);
  assert.equal(deletes, 1);
});
