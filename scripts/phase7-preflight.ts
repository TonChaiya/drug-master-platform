import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import type { RowDataPacket } from "mysql2/promise";
import { z } from "zod";
import { resolveTmtCredentialsFromPool } from "@/modules/standards/tmt-credentials";
import { createOperationalPool, inspectOperationalTarget, tableCounts } from "@/modules/phase7/database";
import { evaluatePhase7Preflight } from "@/modules/phase7/inventory";
import { loadExplicitEnvFile } from "@/modules/phase7/env";
import { KEEP_TABLES, RESET_TABLES } from "@/modules/phase7/reset";

const args = parseArgs({ options: {
  environment: { type: "string" }, "env-file": { type: "string" }, "master-ttmt": { type: "string" }, "backup-reference": { type: "string" },
}, strict: true });
loadExplicitEnvFile(args.values["env-file"]);
const environment = z.enum(["local", "production"]).parse(args.values.environment);
const pool = createOperationalPool(environment);
try {
  const target = await inspectOperationalTarget(pool, { environment, executeRequested: false });
  const required = ["0014_tmt_data_model_v2.sql", "0015_ttmt_data_model_v2.sql", "0016_mapping_v2_identity.sql"];
  const missingMigrations = required.filter((migration) => !target.appliedMigrations.includes(migration));
  const expectedTables = [...KEEP_TABLES, ...RESET_TABLES];
  const [tableRows] = await pool.query<RowDataPacket[]>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN (${expectedTables.map(() => "?").join(",")})`,
    expectedTables,
  );
  const existing = new Set(tableRows.map((row) => String(row.TABLE_NAME ?? row.table_name)));
  const keepCounts = await tableCounts(pool, KEEP_TABLES.filter((table) => existing.has(table)));
  const resetCounts = await tableCounts(pool, RESET_TABLES.filter((table) => existing.has(table)));
  const masterPath = args.values["master-ttmt"];
  const masterTtmtPresent = masterPath ? (await stat(masterPath).catch(() => null))?.isFile() === true : false;
  const masterTtmtHash = masterTtmtPresent ? createHash("sha256").update(await readFile(masterPath!)).digest("hex") : null;
  const flags = {
    browser: process.env.TMT_V2_BROWSER_ENABLED === "1", mapping: process.env.TMT_V2_MAPPING_ENABLED === "1",
    catalog: process.env.TMT_V2_CATALOG_ENABLED === "1", export: process.env.TMT_V2_EXPORT_ENABLED === "1",
  };
  const credentialPresent = (await resolveTmtCredentialsFromPool(pool)) !== null;
  const report = evaluatePhase7Preflight({
    missingMigrations, maintenanceEnabled: target.maintenanceEnabled, credentialPresent,
    tmtTablesPresent: existing.has("tmt_sync_runs") && existing.has("tmt_mastertmt"),
    ttmtTablesPresent: existing.has("ttmt_imports") && existing.has("ttmt_products"),
    masterTtmtPresent, featureFlags: flags,
  });
  const gitSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  console.log(JSON.stringify({
    environment, database: target.database, serverVersion: target.serverVersion, migrations: target.appliedMigrations,
    maintenance: target.maintenanceEnabled, backupReference: args.values["backup-reference"] ?? null,
    keepCounts, resetCounts, credentialPresent,
    masterTtmt: { present: masterTtmtPresent, hash: masterTtmtHash }, featureFlags: flags, gitSha, ...report,
  }));
  if (!report.ready) process.exitCode = 1;
} finally {
  await pool.end();
}
