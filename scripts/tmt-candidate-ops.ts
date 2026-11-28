import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { RowDataPacket } from "mysql2/promise";
import { z } from "zod";
import { assertExternalEnvFile, splitMigrationStatements } from "@/db/migration-0018-guard";
import { createOperationalPool, inspectOperationalTarget } from "@/modules/phase7/database";
import { loadExplicitEnvFile } from "@/modules/phase7/env";
import { assertOperationalTarget } from "@/modules/phase7/guards";
import { classifyGuardedTarget } from "@/modules/phase7/target-classification";
import { DatasetReleaseError, prepareBaselineDataset } from "@/modules/standards/dataset-release";
import { standardDatasetLifecycleStoresForPool } from "@/modules/standards/dataset-release-mysql";
import { activateTmtDataset } from "@/modules/tmt/candidate-lifecycle";
import { readTmtV2Readiness } from "@/modules/tmt/readiness";
import { readTmtPointer } from "@/modules/tmt/candidate-pointer";

const name = "0021_tmt_candidate_operations.sql";
const hash = "5b2230a77ab490d6858c8b1f24a35d09f97ce80284f01c2ac989b10fd0ba226a";
const directory = new URL("../src/db/migrations/", import.meta.url);
const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

async function main() {
  const { values } = parseArgs({ strict: true, options: {
    operation: { type: "string" }, "env-file": { type: "string" }, "production-intent": { type: "boolean" },
    execute: { type: "boolean" }, "confirm-db": { type: "string" }, "confirm-action": { type: "string" },
    "maintenance-approved": { type: "boolean" }, "recovery-reference": { type: "string" }, "actor-user-id": { type: "string" },
    "dataset-id": { type: "string" },
  } });
  const operation = z.enum(["migrate-0021", "tmt-candidate"]).parse(values.operation);
  const bootstrap = operation === "tmt-candidate";
  const datasetId = bootstrap ? z.string().uuid().parse(values["dataset-id"]) : undefined;
  const executeRequested = values.execute === true;
  const actor = z.string().uuid().parse(values["actor-user-id"]);
  z.literal(true).parse(values["production-intent"]);
  if (executeRequested) {
    z.literal("drug_master_platform").parse(values["confirm-db"]);
    z.literal(true).parse(values["maintenance-approved"]);
    z.string().trim().min(8).parse(values["recovery-reference"]);
    z.literal(bootstrap ? `BOOTSTRAP ${datasetId}` : `APPLY 0021 ${hash}`).parse(values["confirm-action"]);
  }
  const migration = await readFile(new URL(name, directory));
  if (sha256(migration) !== hash) throw new Error("MIGRATION_HASH_INVALID");
  const prior = (await readdir(directory)).filter((filename) => /^00(?:0[1-9]|1\d|20)_.+\.sql$/.test(filename)).sort();
  if (prior.length !== 20) throw new Error("LOCAL_MIGRATION_CHAIN_INVALID");
  const expected = bootstrap ? [...prior, name] : prior;
  const hashes = await Promise.all(expected.map(async (filename) => sha256(await readFile(new URL(filename, directory)))));
  loadExplicitEnvFile(assertExternalEnvFile(values["env-file"], fileURLToPath(new URL("../", import.meta.url))));
  if (process.env.ACTIVE_STANDARD_RELEASE_ENABLED === "1" || process.env.TMT_CANDIDATE_OPERATIONS_ENABLED === "1"
    || process.env.TMT_INDEPENDENT_DATASET_ENABLED === "1") throw new Error("TMT_CANDIDATE_FLAGS_MUST_BE_OFF");
  const intent = { environment: "production" as const, productionIntent: true, guardedOperation: operation, executeRequested, confirmDatabase: values["confirm-db"] };
  classifyGuardedTarget({ ...intent, host: process.env.DB_HOST ?? "", port: Number(process.env.DB_PORT), database: process.env.DB_DATABASE ?? "",
    serverVersion: "TiDB", provider: "tidb-cloud", driver: "mysql2", tlsVerified: process.env.DB_SSL === "true" });
  const pool = createOperationalPool("production");
  try {
    assertOperationalTarget(await inspectOperationalTarget(pool, intent), { forExecution: executeRequested, requiredMigrations: expected });
    const [journal] = await pool.query<RowDataPacket[]>("SELECT filename,content_hash FROM schema_migrations ORDER BY filename");
    if (journal.length !== expected.length || journal.some((row, index) => row.filename !== expected[index] || row.content_hash !== hashes[index])) throw new Error("JOURNAL_MISMATCH");
    const [[operator]] = await pool.execute<RowDataPacket[]>("SELECT id FROM users WHERE id=? AND role='admin' AND status='active'", [actor]);
    if (!operator) throw new Error("TMT_ADMIN_REQUIRED");
    const [running] = await pool.query<RowDataPacket[]>("SELECT id FROM tmt_sync_runs WHERE status='running' LIMIT 1");
    if (running.length) throw new Error("TMT_LIVE_WRITER_RUNNING");
    if (bootstrap) {
      const pointer = await readTmtPointer(pool);
      if (pointer.datasetId) throw new Error("TMT_BOOTSTRAP_ALREADY_COMPLETE");
      const ready = await readTmtV2Readiness(pool);
      if (!ready.ready) throw new Error("TMT_BASELINE_NOT_READY");
      if (executeRequested) {
        const id = datasetId!;
        await prepareBaselineDataset({ datasetId: id, source: "TMT", sourceVersion: ready.run.tmtVersion,
          tmtSyncRunId: ready.run.id, batchSize: 1000 }, standardDatasetLifecycleStoresForPool(pool).baseline);
        await activateTmtDataset(pool, { actor, datasetId: id, generation: pointer.generation, action: "bootstrap" });
      }
    } else {
      const tables = ["tmt_active_dataset", "tmt_candidate_acceptances", "tmt_candidate_jobs"];
      const readTables = () => pool.execute<RowDataPacket[]>(
        "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?,?,?)", tables);
      if ((await readTables())[0].length !== 0) throw new Error("PARTIAL_OR_UNEXPECTED_SCHEMA");
      if (executeRequested) {
        // TiDB DDL is nontransactional. Never retry after a failed statement or journal write.
        try {
          for (const statement of splitMigrationStatements(migration.toString("utf8"))) await pool.query(statement);
          if ((await readTables())[0].length !== tables.length || (await readTmtPointer(pool)).datasetId !== null) throw new Error("POST_SCHEMA_INVALID");
          const [[singleton]] = await pool.query<RowDataPacket[]>(
            `SELECT c.GENERATION_EXPRESSION AS expression,c.EXTRA AS extra,s.NON_UNIQUE AS non_unique
             FROM information_schema.COLUMNS c JOIN information_schema.STATISTICS s
             ON s.TABLE_SCHEMA=c.TABLE_SCHEMA AND s.TABLE_NAME=c.TABLE_NAME AND s.COLUMN_NAME=c.COLUMN_NAME
             WHERE c.TABLE_SCHEMA=DATABASE() AND c.TABLE_NAME='tmt_active_dataset'
             AND c.COLUMN_NAME='singleton_id' AND s.INDEX_NAME='uq_tmt_active_dataset_singleton'`,
          );
          if (Number(singleton?.non_unique) !== 0 || String(singleton?.expression).replace(/[()\s]/g, "") !== "1"
            || !/stored generated/i.test(String(singleton?.extra))) throw new Error("POST_SINGLETON_GUARD_INVALID");
          await pool.execute("INSERT INTO schema_migrations (filename,content_hash) VALUES (?,?)", [name, hash]);
        } catch { throw new Error("DDL_OR_JOURNAL_FAILED_STOP_DO_NOT_RETRY"); }
      }
    }
    console.log(JSON.stringify({ operation, mode: executeRequested ? "executed" : "dry-run", migration: name, hash, datasetId }));
  } finally { await pool.end(); }
}

main().catch((error: unknown) => {
  const driver = z.object({ code: z.string().regex(/^ER_[A-Z0-9_]+$/), errno: z.number().int(), sqlState: z.string().regex(/^[A-Z0-9]{5}$/) }).safeParse(error);
  const code = error instanceof DatasetReleaseError ? error.code
    : error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : "TMT_CANDIDATE_GUARD_REFUSED";
  console.error(JSON.stringify(driver.success ? driver.data : { code }));
  process.exitCode = 1;
});
