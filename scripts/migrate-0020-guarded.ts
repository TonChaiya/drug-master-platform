import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { RowDataPacket } from "mysql2/promise";
import { z } from "zod";
import { EXPECTED_MIGRATION_0019_SHA256, MIGRATION_0019_FILENAME } from "@/db/migration-0019-guard";
import { createOperationalPool, inspectOperationalTarget } from "@/modules/phase7/database";
import { loadExplicitEnvFile } from "@/modules/phase7/env";
import { assertOperationalTarget } from "@/modules/phase7/guards";
import { assertExternalOperatorFile, assertProductionReadiness, loadProductionReadinessFile } from "@/modules/phase7/production-readiness";
import { classifyGuardedTarget } from "@/modules/phase7/target-classification";

const filename = "0020_tmt_independent_validation.sql";
const expectedHash = "4fe0509575fac3e4c967be8508d26fd27159e253148a984d7ebdf7e3abb54039";
const directory = new URL("../src/db/migrations/", import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
const sha256 = (value: Buffer) => createHash("sha256").update(value).digest("hex");
const expectedColumns = new Map([
  ["ttmt_import_id", "char(36)"],
  ["ttmt_content_hash", "char(64)"],
  ["ttmt_row_count", "int unsigned"],
]);
const columnsSql = "SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLLATION_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tmt_run_validations' AND COLUMN_NAME IN ('ttmt_import_id','ttmt_content_hash','ttmt_row_count')";

function assertColumns(rows: RowDataPacket[], nullable: boolean) {
  if (rows.length !== expectedColumns.size || rows.some((row) =>
    String(row.COLUMN_TYPE).replace(/^int\(\d+\)/, "int") !== expectedColumns.get(row.COLUMN_NAME)
    || row.IS_NULLABLE !== (nullable ? "YES" : "NO")
    || (row.COLUMN_NAME === "ttmt_import_id" && row.COLLATION_NAME !== "utf8mb4_unicode_ci"))) {
    throw new Error(nullable ? "POST_SCHEMA_INVALID" : "PARTIAL_OR_UNEXPECTED_SCHEMA");
  }
}

async function main() {
  const { values } = parseArgs({ strict: true, options: {
    environment: { type: "string" }, "env-file": { type: "string" }, "readiness-file": { type: "string" },
    "production-intent": { type: "boolean" }, operation: { type: "string" }, execute: { type: "boolean" },
    "confirm-db": { type: "string" }, "confirm-migration": { type: "string" }, "confirm-hash": { type: "string" },
    "maintenance-approved": { type: "boolean" }, "actor-user-id": { type: "string" }, reason: { type: "string" },
  } });
  const environment = z.literal("production").parse(values.environment);
  const guardedOperation = z.literal("migrate-0020").parse(values.operation);
  z.literal(true).parse(values["production-intent"]);
  const actor = z.string().uuid().parse(values["actor-user-id"]);
  z.string().trim().min(1).parse(values.reason);
  const executeRequested = values.execute === true;
  if (executeRequested) {
    z.literal("drug_master_platform").parse(values["confirm-db"]);
    z.literal("0020").parse(values["confirm-migration"]);
    z.literal(expectedHash).parse(values["confirm-hash"]);
    z.literal(true).parse(values["maintenance-approved"]);
  }
  const evidence = loadProductionReadinessFile(values["readiness-file"], root);
  assertProductionReadiness(evidence, guardedOperation, { requireProbe: true });
  if (actor !== evidence.maintenance.operatorId) throw new Error("OPERATOR_MISMATCH");
  const migration = await readFile(new URL(filename, directory));
  if (sha256(migration) !== expectedHash) throw new Error("MIGRATION_HASH_INVALID");
  const names = (await readdir(directory)).filter((name) => /^00(?:0[1-9]|1[0-9])_.+\.sql$/.test(name)).sort();
  if (names.length !== 19 || names.at(-1) !== MIGRATION_0019_FILENAME) throw new Error("LOCAL_MIGRATION_CHAIN_INVALID");
  const hashes = await Promise.all(names.map(async (name) => sha256(await readFile(new URL(name, directory)))));
  if (hashes.at(-1) !== EXPECTED_MIGRATION_0019_SHA256) throw new Error("MIGRATION_0019_HASH_INVALID");
  loadExplicitEnvFile(assertExternalOperatorFile(values["env-file"], root, "Production environment"));
  const intent = { environment, executeRequested, confirmDatabase: values["confirm-db"], productionIntent: true, guardedOperation };
  classifyGuardedTarget({ ...intent, host: process.env.DB_HOST ?? "", port: Number(process.env.DB_PORT),
    database: process.env.DB_DATABASE ?? "", serverVersion: "TiDB", provider: "tidb-cloud", driver: "mysql2",
    tlsVerified: process.env.DB_SSL === "true" });
  if (process.env.ACTIVE_STANDARD_RELEASE_ENABLED === "1") throw new Error("DATASET_RELEASE_ENABLED");
  const pool = createOperationalPool(environment);
  try {
    const target = await inspectOperationalTarget(pool, intent);
    assertOperationalTarget(target, { forExecution: executeRequested, requiredMigrations: names });
    const [journal] = await pool.query<RowDataPacket[]>("SELECT filename,content_hash FROM schema_migrations ORDER BY filename");
    if (journal.length !== names.length || journal.some((row, i) => row.filename !== names[i] || row.content_hash !== hashes[i])) {
      throw new Error("JOURNAL_MISMATCH");
    }
    assertColumns((await pool.query<RowDataPacket[]>(columnsSql))[0], false);
    if (executeRequested) {
      try {
        await pool.query(migration.toString("utf8"));
        assertColumns((await pool.query<RowDataPacket[]>(columnsSql))[0], true);
        const [relations] = await pool.query<RowDataPacket[]>("SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='tmt_run_validations' AND REFERENCED_TABLE_NAME='ttmt_imports' AND CONSTRAINT_NAME='fk_tmt_run_validation_ttmt_import'");
        if (relations.length !== 1) throw new Error("HISTORICAL_FOREIGN_KEY_MISSING");
        await pool.execute("INSERT INTO schema_migrations (filename,content_hash) VALUES (?,?)", [filename, expectedHash]);
      } catch {
        throw new Error("DDL_OR_JOURNAL_FAILED_STOP_DO_NOT_RETRY");
      }
    }
    console.log(JSON.stringify({ migration: filename, mode: executeRequested ? "executed" : "dry-run", hash: expectedHash }));
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : "MIGRATION_0020_GUARD_REFUSED";
  console.error(JSON.stringify({ code: message }));
  process.exitCode = 1;
});
