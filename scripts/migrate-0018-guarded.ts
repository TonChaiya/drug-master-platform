import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  Migration0018GuardError,
  assertExternalEnvFile,
  createMigration0018PoolDependencies,
  executeGuardedMigration0018,
  parseMigration0018Cli,
  readMigrationFile,
  redactMigration0018Error,
  type MigrationJournalEntry,
} from "@/db/migration-0018-guard";
import { maintenanceStoreForPool, readMaintenanceState } from "@/modules/maintenance/service";
import { createOperationalPool } from "@/modules/phase7/database";
import { loadExplicitEnvFile } from "@/modules/phase7/env";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const migrationsDirectory = new URL("../src/db/migrations/", import.meta.url);
const migration0018Path = fileURLToPath(new URL("0018_versioned_standard_dataset_foundation.sql", migrationsDirectory));

const connectionEnvSchema = z.object({
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().min(1).max(65535),
  DB_SSL: z.enum(["true", "false"]),
});

async function expectedPriorJournal(): Promise<MigrationJournalEntry[]> {
  const filenames = (await readdir(migrationsDirectory))
    .filter((filename) => /^00(?:0[1-9]|1[0-7])_.+\.sql$/.test(filename))
    .sort();
  if (filenames.length !== 17 || filenames.some((filename, index) => !filename.startsWith(`${String(index + 1).padStart(4, "0")}_`))) {
    throw new Migration0018GuardError("LOCAL_MIGRATION_CHAIN_INVALID", "Repository must contain the exact migration chain 0001-0017");
  }
  return Promise.all(filenames.map(async (filename) => {
    const content = await readFile(new URL(filename, migrationsDirectory), "utf8");
    return { filename, contentHash: createHash("sha256").update(content).digest("hex") };
  }));
}

async function main(): Promise<void> {
  const request = parseMigration0018Cli(process.argv.slice(2));
  const envFile = assertExternalEnvFile(request.envFile, repositoryRoot);
  loadExplicitEnvFile(envFile);
  const env = connectionEnvSchema.parse(process.env);
  const pool = createOperationalPool(request.environment);
  try {
    const migration = readMigrationFile(migration0018Path);
    const dependencies = createMigration0018PoolDependencies({
      pool,
      environment: request.environment,
      host: env.DB_HOST,
      port: env.DB_PORT,
      tlsVerified: request.environment === "production" && env.DB_SSL === "true",
      expectedPriorJournal: await expectedPriorJournal(),
      migrationSql: migration.sql,
      migrationHash: migration.hash,
      maintenanceState: async () => {
        const state = await readMaintenanceState(maintenanceStoreForPool(pool));
        return { available: state.available, enabled: state.enabled };
      },
      onStatementComplete: ({ index, total }) => console.log(JSON.stringify({ event: "migration_statement_complete", index, total })),
    });
    const result = await executeGuardedMigration0018(request, dependencies);
    console.log(JSON.stringify(result));
  } finally {
    await pool.end();
  }
}

try {
  await main();
} catch (error) {
  const code = error instanceof Migration0018GuardError ? error.code : "MIGRATION_0018_FAILED";
  const statementIndex = error instanceof Migration0018GuardError ? error.statementIndex : undefined;
  console.error(JSON.stringify({ code, statementIndex, message: redactMigration0018Error(error) }));
  process.exitCode = 1;
}
