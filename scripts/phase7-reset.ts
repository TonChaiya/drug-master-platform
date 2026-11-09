import { parseArgs } from "node:util";
import { z } from "zod";
import { createOperationalPool, inspectOperationalTarget, tableCounts } from "@/modules/phase7/database";
import { assertOperationalTarget } from "@/modules/phase7/guards";
import { loadExplicitEnvFile } from "@/modules/phase7/env";
import { KEEP_TABLES, mysqlResetStore, runPhase7Reset } from "@/modules/phase7/reset";

const args = parseArgs({ options: {
  environment: { type: "string" }, "env-file": { type: "string" }, "backup-reference": { type: "string" },
  "dry-run": { type: "boolean" }, execute: { type: "boolean" }, "confirm-db": { type: "string" },
}, strict: true });
loadExplicitEnvFile(args.values["env-file"]);
const environment = z.enum(["local", "production"]).parse(args.values.environment);
const execute = args.values.execute === true;
if (execute && args.values["dry-run"] === true) throw new Error("Choose --dry-run or --execute, not both");
const backupReference = z.string().min(1).parse(args.values["backup-reference"]);
const pool = createOperationalPool(environment);
try {
  const target = await inspectOperationalTarget(pool, { environment, executeRequested: execute, confirmDatabase: args.values["confirm-db"] });
  assertOperationalTarget(target, { forExecution: execute, requiredMigrations: ["0014_tmt_data_model_v2.sql", "0015_ttmt_data_model_v2.sql", "0016_mapping_v2_identity.sql"] });
  const keepBefore = await tableCounts(pool, KEEP_TABLES);
  const result = await runPhase7Reset({ execute, backupReference }, mysqlResetStore(pool));
  const keepAfter = execute ? await tableCounts(pool, KEEP_TABLES) : keepBefore;
  if (JSON.stringify(keepBefore) !== JSON.stringify(keepAfter)) throw new Error("KEEP table counts changed; reset is unsafe");
  console.log(JSON.stringify({ environment, database: target.database, maintenance: target.maintenanceEnabled, keepPreserved: true, ...result }));
} finally {
  await pool.end();
}
