import { basename } from "node:path";
import { readFile, stat } from "node:fs/promises";
import { parseArgs } from "node:util";
import { z } from "zod";
import { createOperationalPool, inspectOperationalTarget } from "@/modules/phase7/database";
import { assertOperationalTarget } from "@/modules/phase7/guards";
import { loadExplicitEnvFile } from "@/modules/phase7/env";
import { importMasterTtmtV2, ttmtV2ImportStoreForPool } from "@/modules/standards/ttmt-v2-import";

const args = parseArgs({ options: {
  environment: { type: "string" }, "env-file": { type: "string" }, file: { type: "string" }, version: { type: "string" },
  "imported-by": { type: "string" }, "dry-run": { type: "boolean" }, execute: { type: "boolean" }, "confirm-db": { type: "string" },
}, strict: true });
loadExplicitEnvFile(args.values["env-file"]);
const environment = z.enum(["local", "production"]).parse(args.values.environment);
const file = z.string().min(1).parse(args.values.file);
const version = z.string().min(1).parse(args.values.version);
const execute = args.values.execute === true;
if (execute && args.values["dry-run"] === true) throw new Error("Choose --dry-run or --execute, not both");
if (!(await stat(file)).isFile()) throw new Error("MasterTTMT input is not a file");
const data = await readFile(file);

const pool = createOperationalPool(environment);
try {
  const target = await inspectOperationalTarget(pool, { environment, executeRequested: execute, confirmDatabase: args.values["confirm-db"] });
  assertOperationalTarget(target, { forExecution: execute, requiredMigrations: ["0015_ttmt_data_model_v2.sql"] });
  const importedBy = execute ? z.string().uuid().parse(args.values["imported-by"]) : "00000000-0000-0000-0000-000000000000";
  const result = await importMasterTtmtV2({ filename: basename(file), version, data, importedBy, dryRun: !execute }, ttmtV2ImportStoreForPool(pool));
  console.log(JSON.stringify({ environment, database: target.database, maintenance: target.maintenanceEnabled, ...result }));
} finally {
  await pool.end();
}
