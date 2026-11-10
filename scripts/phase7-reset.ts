import { parseArgs } from "node:util";
import { z } from "zod";
import { createOperationalPool, inspectOperationalTarget, tableCounts } from "@/modules/phase7/database";
import { assertOperationalTarget } from "@/modules/phase7/guards";
import { loadExplicitEnvFile } from "@/modules/phase7/env";
import { mysqlResetStore, preservedTablesForMode, runPhase7Reset } from "@/modules/phase7/reset";

const args = parseArgs({ options: {
  environment: { type: "string" }, "env-file": { type: "string" }, "backup-reference": { type: "string" },
  mode: { type: "string" }, "dry-run": { type: "boolean" }, execute: { type: "boolean" }, "confirm-db": { type: "string" },
}, strict: true });
loadExplicitEnvFile(args.values["env-file"]);
const environment = z.enum(["local", "production"]).parse(args.values.environment);
const mode = z.enum(["full", "tmt-v2-only"]).parse(args.values.mode);
const execute = args.values.execute === true;
if (execute && args.values["dry-run"] === true) throw new Error("Choose --dry-run or --execute, not both");
const backupReference = z.string().min(1).parse(args.values["backup-reference"]);
const pool = createOperationalPool(environment);
try {
  const target = await inspectOperationalTarget(pool, { environment, executeRequested: execute, confirmDatabase: args.values["confirm-db"] });
  assertOperationalTarget(target, { forExecution: execute, requiredMigrations: ["0014_tmt_data_model_v2.sql", "0015_ttmt_data_model_v2.sql", "0016_mapping_v2_identity.sql"] });
  const preservedTables = preservedTablesForMode(mode);
  const preservedBefore = await tableCounts(pool, preservedTables);
  const result = await runPhase7Reset({ mode, execute, backupReference }, mysqlResetStore(pool, mode));
  const preservedAfter = execute ? await tableCounts(pool, preservedTables) : preservedBefore;
  if (JSON.stringify(preservedBefore) !== JSON.stringify(preservedAfter)) {
    throw new Error("Hard-denied table counts changed; reset is unsafe");
  }
  console.log(JSON.stringify({ environment, database: target.database, maintenance: target.maintenanceEnabled, preservedTables, preserved: true, ...result }));
} finally {
  await pool.end();
}
