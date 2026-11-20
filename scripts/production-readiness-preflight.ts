import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { RowDataPacket } from "mysql2/promise";
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

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

async function main(): Promise<void> {
  const args = parseArgs({ strict: true, allowPositionals: false, options: {
    environment: { type: "string" }, "env-file": { type: "string" }, "readiness-file": { type: "string" },
    "production-intent": { type: "boolean" }, operation: { type: "string" },
  } });
  z.literal("production").parse(args.values.environment);
  z.literal("preflight").parse(args.values.operation);
  if (args.values["production-intent"] !== true) throw new Error("Explicit --production-intent is required");
  const evidence = loadProductionReadinessFile(args.values["readiness-file"], repositoryRoot);
  assertProductionReadiness(evidence, "preflight", { requireProbe: false });
  const envFile = assertExternalOperatorFile(args.values["env-file"], repositoryRoot, "Production environment");
  loadExplicitEnvFile(envFile);
  const pool = createOperationalPool("production");
  try {
    const target = await inspectOperationalTarget(pool, {
      environment: "production", executeRequested: false, productionIntent: true, guardedOperation: "preflight",
    });
    assertOperationalTarget(target, {
      forExecution: false,
      requiredMigrations: ["0017_tmt_run_validations.sql"],
      requireMaintenance: false,
    });
    const [tables] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE()",
    );
    console.log(JSON.stringify({
      operation: "preflight", result: "PASS", database: target.database, serverVersion: target.serverVersion,
      tlsVerified: target.tlsVerified, migration: target.appliedMigrations.at(-1) ?? null,
      tableCount: Number(tables[0]?.total ?? 0), maintenanceEnabled: target.maintenanceEnabled,
      storageEvidence: "PASS", recoveryEvidence: evidence.backup.recoveryRehearsal,
      probeEvidence: evidence.probe?.result ?? "NOT_RECORDED",
    }));
  } finally {
    await pool.end();
  }
}

try {
  await main();
} catch (error) {
  console.error(JSON.stringify({ operation: "preflight", result: "FAIL", message: redactOperatorMessage(error) }));
  process.exitCode = 1;
}
