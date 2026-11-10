import { parseArgs } from "node:util";
import { z } from "zod";
import { createOperationalPool, inspectOperationalTarget } from "@/modules/phase7/database";
import { loadExplicitEnvFile } from "@/modules/phase7/env";
import { assertOperationalTarget } from "@/modules/phase7/guards";
import { revalidateTmtRun } from "@/modules/tmt/validation";

const args = parseArgs({ options: {
  environment: { type: "string" }, "env-file": { type: "string" }, "run-id": { type: "string" },
  "dry-run": { type: "boolean" }, execute: { type: "boolean" }, "confirm-db": { type: "string" },
}, strict: true });
loadExplicitEnvFile(args.values["env-file"]);
const environment = z.enum(["local", "production"]).parse(args.values.environment);
const runId = z.string().uuid().parse(args.values["run-id"]);
const execute = args.values.execute === true;
if (execute && args.values["dry-run"] === true) throw new Error("Choose --dry-run or --execute, not both");

const pool = createOperationalPool(environment);
try {
  const target = await inspectOperationalTarget(pool, {
    environment, executeRequested: execute, confirmDatabase: args.values["confirm-db"],
  });
  assertOperationalTarget(target, {
    forExecution: execute,
    requiredMigrations: [
      "0014_tmt_data_model_v2.sql", "0015_ttmt_data_model_v2.sql",
      "0016_mapping_v2_identity.sql", "0017_tmt_run_validations.sql",
    ],
  });
  const result = await revalidateTmtRun(pool, { runId, execute });
  console.log(JSON.stringify({
    environment, database: target.database, maintenance: target.maintenanceEnabled,
    runId: result.runId, policyVersion: result.policyVersion, status: result.status,
    requiredCheckpointCount: result.requiredCheckpointCount,
    requiredSucceededCount: result.requiredSucceededCount,
    optionalFailureCount: result.optionalFailureCount,
    blockingInvariantCount: result.blockingInvariantCount,
    gpu764169Passed: result.gpu764169Passed,
    ttmtImportId: result.ttmtImportId, ttmtContentHash: result.ttmtContentHash,
    ttmtRowCount: result.ttmtRowCount, evidenceSha256: result.evidenceSha256,
    validatedAt: result.validatedAt.toISOString(), executed: result.executed,
  }));
} finally {
  await pool.end();
}
