import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { createOperationalPool, inspectOperationalTarget } from "@/modules/phase7/database";
import { loadExplicitEnvFile } from "@/modules/phase7/env";
import { assertOperationalTarget } from "@/modules/phase7/guards";
import {
  assertExternalOperatorFile,
  assertProductionReadiness,
  loadProductionReadinessFile,
  redactOperatorMessage,
} from "@/modules/phase7/production-readiness";
import { runTidbProductionProbe, tidbProbeDiagnostic } from "@/modules/phase7/tidb-production-probe";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

async function main(): Promise<void> {
  const args = parseArgs({ strict: true, allowPositionals: false, options: {
    environment: { type: "string" }, "env-file": { type: "string" }, "readiness-file": { type: "string" },
    "production-intent": { type: "boolean" }, operation: { type: "string" }, "operation-id": { type: "string" },
    execute: { type: "boolean" }, "confirm-db": { type: "string" }, "maintenance-approved": { type: "boolean" },
    "actor-user-id": { type: "string" }, reason: { type: "string" },
  } });
  z.literal("production").parse(args.values.environment);
  z.literal("tidb-probe").parse(args.values.operation);
  if (args.values["production-intent"] !== true) throw new Error("Explicit --production-intent is required");
  const execute = args.values.execute === true;
  const operationId = z.string().uuid().parse(args.values["operation-id"]);
  const evidence = loadProductionReadinessFile(args.values["readiness-file"], repositoryRoot);
  assertProductionReadiness(evidence, "tidb-probe", { requireProbe: false });
  const envFile = assertExternalOperatorFile(args.values["env-file"], repositoryRoot, "Production environment");
  loadExplicitEnvFile(envFile);
  if (execute) {
    z.literal("drug_master_platform").parse(args.values["confirm-db"]);
    if (args.values["maintenance-approved"] !== true) throw new Error("Explicit maintenance approval is required");
    z.string().uuid().parse(args.values["actor-user-id"]);
    z.string().min(1).parse(args.values.reason);
  }
  const pool = createOperationalPool("production");
  try {
    const target = await inspectOperationalTarget(pool, {
      environment: "production", executeRequested: execute, confirmDatabase: args.values["confirm-db"],
      productionIntent: true, guardedOperation: "tidb-probe",
    });
    assertOperationalTarget(target, {
      forExecution: execute,
      requiredMigrations: ["0017_tmt_run_validations.sql"],
    });
    const result = await runTidbProductionProbe({ pool, operationId, execute });
    console.log(JSON.stringify({
      ...result,
      database: target.database,
      actorUserId: execute ? args.values["actor-user-id"] : undefined,
      reasonSha256: execute ? createHash("sha256").update(String(args.values.reason)).digest("hex") : undefined,
    }));
  } finally {
    await pool.end();
  }
}

try {
  await main();
} catch (error) {
  console.error(JSON.stringify({
    operation: "tidb-probe", result: "FAIL", ...tidbProbeDiagnostic(error), message: redactOperatorMessage(error),
  }));
  process.exitCode = 1;
}
