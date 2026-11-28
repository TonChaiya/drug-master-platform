import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  EXPECTED_MIGRATION_0019_SHA256,
  Migration0019GuardError,
  assertExternalEnvFile,
  createMigration0019PoolDependencies,
  executeGuardedMigration0019,
  parseMigration0019Cli,
} from "@/db/migration-0019-guard";
import { maintenanceStoreForPool, readMaintenanceState } from "@/modules/maintenance/service";
import { createOperationalPool } from "@/modules/phase7/database";
import { loadExplicitEnvFile } from "@/modules/phase7/env";
import { assertProductionReadiness, loadProductionReadinessFile } from "@/modules/phase7/production-readiness";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const migrationsDirectory = new URL("../src/db/migrations/", import.meta.url);
const envSchema = z.object({ DB_HOST: z.string().min(1), DB_PORT: z.coerce.number().int(), DB_SSL: z.enum(["true", "false"]) });

async function priorJournal() {
  const filenames = (await readdir(migrationsDirectory)).filter((name) => /^00(?:0[1-9]|1[0-8])_.+\.sql$/.test(name)).sort();
  if (filenames.length !== 18) throw new Migration0019GuardError("LOCAL_MIGRATION_CHAIN_INVALID", "Repository must contain exact chain 0001-0018");
  return Promise.all(filenames.map(async (filename) => ({
    filename, contentHash: createHash("sha256").update(await readFile(new URL(filename, migrationsDirectory), "utf8")).digest("hex"),
  })));
}

async function main() {
  const request = parseMigration0019Cli(process.argv.slice(2));
  if (request.environment === "production") {
    const evidence = loadProductionReadinessFile(request.readinessFile, repositoryRoot);
    assertProductionReadiness(evidence, "migrate-0019", { requireProbe: true });
  }
  loadExplicitEnvFile(assertExternalEnvFile(request.envFile, repositoryRoot));
  const env = envSchema.parse(process.env);
  const pool = createOperationalPool(request.environment);
  try {
    const migrationSql = await readFile(new URL("0019_ttmt_source_fidelity.sql", migrationsDirectory), "utf8");
    const migrationHash = createHash("sha256").update(migrationSql).digest("hex");
    if (migrationHash !== EXPECTED_MIGRATION_0019_SHA256) throw new Migration0019GuardError("MIGRATION_HASH_INVALID", "Reviewed Migration 0019 changed");
    const result = await executeGuardedMigration0019(request, createMigration0019PoolDependencies({
      pool, host: env.DB_HOST, port: env.DB_PORT, tlsVerified: request.environment === "production" && env.DB_SSL === "true",
      provider: request.environment === "production" ? "tidb-cloud" : "local-mysql", driver: "mysql2",
      expectedPriorJournal: await priorJournal(), migrationSql, migrationHash,
      maintenanceState: async () => {
        const state = await readMaintenanceState(maintenanceStoreForPool(pool));
        return { available: state.available, enabled: state.enabled };
      },
    }));
    console.log(JSON.stringify(result));
  } finally { await pool.end(); }
}

try { await main(); } catch (error) {
  const code = error instanceof Migration0019GuardError ? error.code : "MIGRATION_0019_FAILED";
  const statementIndex = error instanceof Migration0019GuardError ? error.statementIndex : undefined;
  const cause = error instanceof Migration0019GuardError ? error.cause as { code?: string; sqlState?: string } | undefined : undefined;
  const publicCode = (value: unknown) => typeof value === "string" && /^[A-Z0-9_]+$/.test(value) ? value : undefined;
  console.error(JSON.stringify({ code, statementIndex, mysqlCode: publicCode(cause?.code), sqlState: publicCode(cause?.sqlState),
    message: "Guarded Migration 0019 failed; inspect schema and journal before continuing" }));
  process.exitCode = 1;
}
