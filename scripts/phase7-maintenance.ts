import { parseArgs } from "node:util";
import type { RowDataPacket } from "mysql2/promise";
import { z } from "zod";
import { maintenanceStoreForPool, readMaintenanceState, setMaintenanceMode } from "@/modules/maintenance/service";
import { createOperationalPool } from "@/modules/phase7/database";
import { assertOperationalTarget, type OperationalEnvironment } from "@/modules/phase7/guards";
import { loadExplicitEnvFile } from "@/modules/phase7/env";

const args = parseArgs({
  options: {
    environment: { type: "string" }, "env-file": { type: "string" }, status: { type: "boolean" },
    enable: { type: "boolean" }, disable: { type: "boolean" }, execute: { type: "boolean" },
    "confirm-db": { type: "string" }, "actor-user-id": { type: "string" }, reason: { type: "string" },
  },
  strict: true,
});

loadExplicitEnvFile(args.values["env-file"]);
const environment = z.enum(["local", "production"]).parse(args.values.environment) as OperationalEnvironment;
if ([args.values.status, args.values.enable, args.values.disable].filter(Boolean).length !== 1) {
  throw new Error("Choose exactly one of --status, --enable, or --disable");
}

const env = z.object({ DB_HOST: z.string().min(1), DB_PORT: z.coerce.number().int(), DB_DATABASE: z.string().min(1) }).parse(process.env);
const pool = createOperationalPool(environment);
try {
  const [identityRows] = await pool.query<RowDataPacket[]>("SELECT DATABASE() AS databaseName, VERSION() AS serverVersion");
  const [journal] = await pool.query<RowDataPacket[]>("SELECT filename FROM schema_migrations ORDER BY filename");
  const identity = identityRows[0];
  const store = maintenanceStoreForPool(pool);
  const current = await readMaintenanceState(store);
  const target = {
    environment, host: env.DB_HOST, port: env.DB_PORT, database: identity?.databaseName ?? env.DB_DATABASE,
    serverVersion: identity?.serverVersion ?? "", appliedMigrations: journal.map((row) => row.filename),
    maintenanceEnabled: current.enabled, executeRequested: args.values.execute === true,
    confirmDatabase: args.values["confirm-db"],
  };
  assertOperationalTarget(target, {
    forExecution: args.values.status !== true,
    requiredMigrations: ["0013_shared_rate_limits.sql"],
    requireMaintenance: false,
  });

  if (args.values.status) {
    console.log(JSON.stringify({ database: target.database, environment, maintenance: current }));
  } else {
    const actorUserId = z.string().uuid().parse(args.values["actor-user-id"]);
    const result = await setMaintenanceMode({ enabled: args.values.enable === true, reason: args.values.reason ?? null, actorUserId }, store);
    console.log(JSON.stringify({ database: target.database, changed: result.changed, maintenance: result.state }));
  }
} finally {
  await pool.end();
}
