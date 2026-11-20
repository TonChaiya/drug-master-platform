import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { GuardedTargetClassificationError, classifyGuardedTarget } from "@/modules/phase7/target-classification";
import {
  EXPECTED_MIGRATION_0018_SHA256,
  assertExternalEnvFile,
  splitMigrationStatements,
  type Migration0018Environment,
  type MigrationJournalEntry,
} from "./migration-0018-guard";

export const MIGRATION_0019_FILENAME = "0019_ttmt_source_fidelity.sql";
export const EXPECTED_MIGRATION_0019_SHA256 = "4c9772d57c1786fe5476b7e309b0ebdce41e709914f94697165ae2fae020a04f";
export const MIGRATION_0019_COLUMNS = ["ttmt_type", "change_date", "drug_group_nhso"] as const;
const TABLES = ["ttmt_products", "ttmt_dataset_products"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface Migration0019Request {
  environment: Migration0018Environment;
  envFile: string;
  execute: boolean;
  confirmDatabase?: string;
  confirmMigration?: string;
  confirmHash?: string;
  maintenanceApproved: boolean;
  rehearsalIntent: boolean;
  actorUserId: string;
  reason: string;
}

export interface Migration0019Snapshot {
  host: string;
  port: number;
  database: string;
  serverVersion: string;
  tlsVerified: boolean;
  maintenanceAvailable: boolean;
  maintenanceEnabled: boolean;
  journal: readonly MigrationJournalEntry[];
  tables: readonly string[];
  columns: readonly { table: string; column: string; type: string; nullable: boolean }[];
}

export interface Migration0019Dependencies {
  expectedPriorJournal: readonly MigrationJournalEntry[];
  migrationSql: string;
  migrationHash: string;
  inspectTarget(): Promise<Migration0019Snapshot>;
  executeStatement(sql: string, index: number): Promise<void>;
  verifySchema(): Promise<boolean>;
  recordJournal(filename: string, hash: string): Promise<void>;
}

export class Migration0019GuardError extends Error {
  constructor(readonly code: string, message: string, readonly statementIndex?: number, options?: ErrorOptions) {
    super(message, options);
    this.name = "Migration0019GuardError";
  }
}

function refuse(code: string, message: string): never {
  throw new Migration0019GuardError(code, message);
}

export function parseMigration0019Cli(argv: string[]): Migration0019Request {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({ args: argv, strict: true, allowPositionals: false, options: {
      environment: { type: "string" }, "env-file": { type: "string" }, execute: { type: "boolean" },
      "confirm-db": { type: "string" }, "confirm-migration": { type: "string" }, "confirm-hash": { type: "string" },
      "maintenance-approved": { type: "boolean" }, rehearsal: { type: "boolean" }, "actor-user-id": { type: "string" }, reason: { type: "string" },
    } });
  } catch (error) {
    throw new Migration0019GuardError("ARGUMENT_INVALID", "Migration 0019 arguments are invalid", undefined, { cause: error });
  }
  const environment = parsed.values.environment;
  if (environment !== "local" && environment !== "production") refuse("ENVIRONMENT_INVALID", "Environment must be local or production");
  const text = (value: unknown): string | undefined => typeof value === "string" ? value : undefined;
  const envFile = text(parsed.values["env-file"]);
  if (!envFile?.trim()) refuse("ENV_FILE_REQUIRED", "Explicit --env-file is required");
  return {
    environment, envFile, execute: parsed.values.execute === true,
    confirmDatabase: text(parsed.values["confirm-db"]), confirmMigration: text(parsed.values["confirm-migration"]),
    confirmHash: text(parsed.values["confirm-hash"]), maintenanceApproved: parsed.values["maintenance-approved"] === true,
    rehearsalIntent: parsed.values.rehearsal === true,
    actorUserId: text(parsed.values["actor-user-id"]) ?? "", reason: text(parsed.values.reason) ?? "",
  };
}

function assertTarget(request: Migration0019Request, target: Migration0019Snapshot): void {
  try {
    const targetClass = classifyGuardedTarget({
      environment: request.environment, host: target.host, port: target.port, database: target.database,
      serverVersion: target.serverVersion, rehearsalIntent: request.rehearsalIntent,
      testOptIn: process.env.NODE_ENV === "test" && process.env.ALLOW_DB_INTEGRATION_TESTS === "1",
    });
    if (targetClass === "PRODUCTION" && !target.tlsVerified) refuse("PRODUCTION_TLS_ENGINE_INVALID", "Verified TiDB TLS is required");
  } catch (error) {
    if (error instanceof GuardedTargetClassificationError) refuse(error.code, error.message);
    throw error;
  }
}

function assertJournal(actual: readonly MigrationJournalEntry[], expected: readonly MigrationJournalEntry[]): void {
  if (actual.some((entry) => entry.filename === MIGRATION_0019_FILENAME)) refuse("MIGRATION_ALREADY_APPLIED", "Migration 0019 is already recorded");
  if (actual.length !== expected.length) refuse("JOURNAL_INCOMPLETE", "Journal must contain exactly 0001-0018");
  expected.forEach((entry, index) => {
    const current = actual[index];
    if (current?.filename !== entry.filename) refuse("JOURNAL_INCOMPLETE", "Journal order or filename mismatch");
    if (current.contentHash.toLowerCase() !== entry.contentHash.toLowerCase()) refuse("JOURNAL_HASH_MISMATCH", `Journal hash mismatch at ${entry.filename}`);
  });
  const migration0018 = actual.at(-1);
  if (migration0018?.filename !== "0018_versioned_standard_dataset_foundation.sql"
    || migration0018.contentHash.toLowerCase() !== EXPECTED_MIGRATION_0018_SHA256) {
    refuse("MIGRATION_0018_REQUIRED", "Reviewed Migration 0018 must immediately precede 0019");
  }
}

function assertPreSchema(snapshot: Migration0019Snapshot): void {
  if (TABLES.some((table) => !snapshot.tables.includes(table))) refuse("DEPENDENCY_TABLE_MISSING", "Migration 0019 dependency table is missing");
  if (snapshot.columns.length !== 0) refuse("PARTIAL_SCHEMA", "Migration 0019 columns already exist without a journal entry");
}

export async function executeGuardedMigration0019(request: Migration0019Request, dependencies: Migration0019Dependencies) {
  if (dependencies.migrationHash.toLowerCase() !== EXPECTED_MIGRATION_0019_SHA256) refuse("MIGRATION_HASH_INVALID", "Migration 0019 hash differs from reviewed release");
  const statements = splitMigrationStatements(dependencies.migrationSql);
  if (statements.length !== 2) refuse("MIGRATION_SQL_INVALID", "Migration 0019 must contain exactly two statements");
  const target = await dependencies.inspectTarget();
  assertTarget(request, target);
  assertJournal(target.journal, dependencies.expectedPriorJournal);
  assertPreSchema(target);
  if (!UUID.test(request.actorUserId)) refuse("ACTOR_REQUIRED", "A valid actor UUID is required");
  if (!request.reason.trim()) refuse("REASON_REQUIRED", "A reason is required");
  if (!request.execute) return {
    mode: "dry-run" as const, database: target.database, migration: MIGRATION_0019_FILENAME,
    migrationHash: dependencies.migrationHash, statementCount: statements.length,
    actorUserId: request.actorUserId, reasonSha256: createHash("sha256").update(request.reason).digest("hex"),
  };
  if (request.confirmDatabase !== target.database) refuse("EXECUTE_CONFIRM_DB_REQUIRED", "Exact database confirmation is required");
  if (request.confirmMigration !== "0019") refuse("EXECUTE_CONFIRM_MIGRATION_REQUIRED", "Exact --confirm-migration 0019 is required");
  if (request.confirmHash?.toLowerCase() !== EXPECTED_MIGRATION_0019_SHA256) refuse("EXECUTE_CONFIRM_HASH_REQUIRED", "Exact migration hash confirmation is required");
  if (!request.maintenanceApproved || !target.maintenanceAvailable || !target.maintenanceEnabled) refuse("MAINTENANCE_REQUIRED", "Approved active maintenance window is required");
  for (let index = 0; index < statements.length; index += 1) {
    try {
      await dependencies.executeStatement(statements[index], index + 1);
    } catch (error) {
      throw new Migration0019GuardError("PARTIAL_DDL_FAILURE", `Migration 0019 stopped after statement ${index + 1}; do not retry automatically`, index + 1, { cause: error });
    }
  }
  if (!await dependencies.verifySchema()) refuse("POST_SCHEMA_INVALID", "Migration 0019 schema verification failed; journal was not written");
  await dependencies.recordJournal(MIGRATION_0019_FILENAME, dependencies.migrationHash);
  return {
    mode: "executed" as const, database: target.database, migration: MIGRATION_0019_FILENAME,
    migrationHash: dependencies.migrationHash, statementCount: statements.length,
    actorUserId: request.actorUserId, reasonSha256: createHash("sha256").update(request.reason).digest("hex"),
  };
}

export function createMigration0019PoolDependencies(input: {
  pool: Pool; host: string; port: number; tlsVerified: boolean; expectedPriorJournal: readonly MigrationJournalEntry[];
  migrationSql: string; migrationHash: string; maintenanceState(): Promise<{ available: boolean; enabled: boolean }>;
}): Migration0019Dependencies {
  const columnSql = "TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('ttmt_products','ttmt_dataset_products') AND COLUMN_NAME IN ('ttmt_type','change_date','drug_group_nhso')";
  const readColumns = async () => {
    const [result] = await input.pool.query<RowDataPacket[]>(`SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE ${columnSql}`);
    return result.map((row) => ({ table: String(row.TABLE_NAME), column: String(row.COLUMN_NAME), type: String(row.COLUMN_TYPE).toLowerCase(), nullable: String(row.IS_NULLABLE) === "YES" }));
  };
  return {
    expectedPriorJournal: input.expectedPriorJournal, migrationSql: input.migrationSql, migrationHash: input.migrationHash,
    async inspectTarget() {
      const [identity] = await input.pool.query<RowDataPacket[]>("SELECT DATABASE() AS databaseName,VERSION() AS serverVersion");
      const [journal] = await input.pool.query<RowDataPacket[]>("SELECT filename,content_hash FROM schema_migrations ORDER BY filename");
      const [tables] = await input.pool.query<RowDataPacket[]>("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('ttmt_products','ttmt_dataset_products')");
      const maintenance = await input.maintenanceState();
      return {
        host: input.host, port: input.port, database: String(identity[0]?.databaseName ?? ""), serverVersion: String(identity[0]?.serverVersion ?? ""),
        tlsVerified: input.tlsVerified, maintenanceAvailable: maintenance.available, maintenanceEnabled: maintenance.enabled,
        journal: journal.map((row) => ({ filename: String(row.filename), contentHash: String(row.content_hash) })),
        tables: tables.map((row) => String(row.TABLE_NAME)), columns: await readColumns(),
      };
    },
    executeStatement: async (sql) => { await input.pool.query(sql); },
    async verifySchema() {
      const columns = await readColumns();
      const expected = new Map<string, string>([["ttmt_type", "varchar(64)"], ["change_date", "varchar(64)"], ["drug_group_nhso", "varchar(120)"]]);
      return TABLES.every((table) => MIGRATION_0019_COLUMNS.every((column) => columns.some((item) => item.table === table && item.column === column && item.type === expected.get(column) && item.nullable)));
    },
    recordJournal: async (filename, hash) => { await input.pool.execute("INSERT INTO schema_migrations (filename,content_hash) VALUES (?,?)", [filename, hash]); },
  };
}

export { assertExternalEnvFile };
