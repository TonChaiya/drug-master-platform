import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { assertExternalEnvFile } from "@/db/migration-0018-guard";
import { createOperationalPool, inspectOperationalTarget } from "@/modules/phase7/database";
import { assertOperationalTarget } from "@/modules/phase7/guards";
import { loadExplicitEnvFile } from "@/modules/phase7/env";
import { runTtmtBaselineReplacement, ttmtBaselineReplacementStoreForPool } from "@/modules/standards/ttmt-baseline-replacement";

async function main() {
  const args = parseArgs({ strict: true, allowPositionals: false, options: {
    environment: { type: "string" }, "env-file": { type: "string" }, file: { type: "string" }, execute: { type: "boolean" },
    "confirm-db": { type: "string" }, "confirm-action": { type: "string" }, "actor-user-id": { type: "string" }, reason: { type: "string" },
    "expected-current-hash": { type: "string" }, rehearsal: { type: "boolean" },
  } });
  const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
  loadExplicitEnvFile(assertExternalEnvFile(z.string().min(1).parse(args.values["env-file"]), repositoryRoot));
  const environment = z.enum(["local", "production"]).parse(args.values.environment);
  const file = z.string().min(1).parse(args.values.file);
  const expectedCurrentHash = z.string().regex(/^[a-f0-9]{64}$/i).parse(args.values["expected-current-hash"]);
  const execute = args.values.execute === true;
  if (!(await stat(file)).isFile()) throw new Error("MasterTTMT input is not a file");
  const pool = createOperationalPool(environment);
  try {
    const target = await inspectOperationalTarget(pool, {
      environment, executeRequested: execute, confirmDatabase: args.values["confirm-db"], rehearsalIntent: args.values.rehearsal === true,
    });
    assertOperationalTarget(target, { forExecution: execute, requiredMigrations: [
      "0015_ttmt_data_model_v2.sql", "0017_tmt_run_validations.sql",
      "0018_versioned_standard_dataset_foundation.sql", "0019_ttmt_source_fidelity.sql",
    ] });
    const result = await runTtmtBaselineReplacement({
      filename: file, data: await readFile(file), execute, confirmation: args.values["confirm-action"],
      actorUserId: typeof args.values["actor-user-id"] === "string" ? args.values["actor-user-id"] : "",
      reason: typeof args.values.reason === "string" ? args.values.reason : "",
      expectedCurrentHash,
    }, ttmtBaselineReplacementStoreForPool(pool));
    console.log(JSON.stringify({
      mode: result.mode, database: target.database, version: result.analysis.version, contentHash: result.analysis.contentHash,
      rowCount: result.analysis.rowCount, currentProductCount: result.preflight.currentProductCount,
      succeededImportCount: result.preflight.succeededImportCount, ttmtMappingCount: result.preflight.ttmtMappingCount,
      validationReferenceCount: result.preflight.validationReferenceCount, datasetReferenceCount: result.preflight.datasetReferenceCount,
      productForeignKeyCount: result.preflight.productForeignKeys.length, importForeignKeyCount: result.preflight.importForeignKeys.length,
      missingMappedCodeCount: result.preflight.missingMappedCodes.length, missingMappedCodes: result.preflight.missingMappedCodes,
      ...(result.mode === "executed" ? { importId: result.importId, archivedImportId: result.archivedImportId } : {}),
    }));
  } finally { await pool.end(); }
}

try { await main(); } catch (error) {
  const code = error instanceof Error && "code" in error ? String(error.code) : "TTMT_BASELINE_REPLACEMENT_FAILED";
  console.error(JSON.stringify({ code, message: "TTMT baseline replacement stopped; inspect operator logs without exposing credentials" }));
  process.exitCode = 1;
}
