import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Pool, RowDataPacket } from "mysql2/promise";

export const MIGRATION_0018_FILENAME = "0018_versioned_standard_dataset_foundation.sql";
export const EXPECTED_MIGRATION_0018_SHA256 = "95d21cae6ded4f5f24b05f9caaab9338599f404ca904a404940001547b02c57e";

export const MIGRATION_0018_TABLES = [
  "standard_datasets", "standard_releases", "standard_dataset_pointers", "standard_dataset_manifests",
  "tmt_dataset_subs", "tmt_dataset_vtm", "tmt_dataset_gp", "tmt_dataset_gpu", "tmt_dataset_gpp",
  "tmt_dataset_tp", "tmt_dataset_tpu", "tmt_dataset_tpp", "tmt_dataset_nlem", "tmt_dataset_atc",
  "tmt_dataset_regno", "tmt_dataset_mastertmt", "tmt_dataset_concepts", "tmt_dataset_relationships",
  "ttmt_dataset_products",
] as const;

const SHADOW_TABLES = MIGRATION_0018_TABLES.slice(4);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type Migration0018Environment = "local" | "production";

export interface MigrationJournalEntry {
  filename: string;
  contentHash: string;
}

export interface Migration0018Request {
  environment: Migration0018Environment;
  envFile: string;
  execute: boolean;
  confirmDatabase?: string;
  confirmMigration?: string;
  confirmHash?: string;
  maintenanceApproved: boolean;
  actorUserId: string;
  reason: string;
}

export interface Migration0018TargetSnapshot {
  host: string;
  port: number;
  database: string;
  serverVersion: string;
  tlsVerified: boolean;
  maintenanceAvailable: boolean;
  maintenanceEnabled: boolean;
  journalTablePresent: boolean;
  journal: readonly MigrationJournalEntry[];
  datasetReleaseTables: readonly string[];
}

export interface Migration0018SchemaVerification {
  valid: boolean;
  missingTables: readonly string[];
  invalidPrimaryKeys: readonly string[];
  invalidForeignKeys: readonly string[];
}

export interface Migration0018Dependencies {
  expectedPriorJournal: readonly MigrationJournalEntry[];
  migrationSql: string;
  migrationHash: string;
  inspectTarget(): Promise<Migration0018TargetSnapshot>;
  executeStatement(sql: string, index: number): Promise<void>;
  verifySchema(): Promise<Migration0018SchemaVerification>;
  recordJournal(filename: string, hash: string): Promise<void>;
  onStatementComplete?(input: { index: number; total: number }): void;
}

export interface Migration0018Result {
  mode: "dry-run" | "executed";
  database: string;
  migration: typeof MIGRATION_0018_FILENAME;
  migrationHash: string;
  statementCount: number;
  actorUserId: string;
  reasonSha256: string;
}

export class Migration0018GuardError extends Error {
  constructor(readonly code: string, message: string, readonly statementIndex?: number, options?: ErrorOptions) {
    super(message, options);
    this.name = "Migration0018GuardError";
  }
}

export function parseMigration0018Cli(argv: string[]): Migration0018Request {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        environment: { type: "string" },
        "env-file": { type: "string" },
        execute: { type: "boolean" },
        "confirm-db": { type: "string" },
        "confirm-migration": { type: "string" },
        "confirm-hash": { type: "string" },
        "maintenance-approved": { type: "boolean" },
        "actor-user-id": { type: "string" },
        reason: { type: "string" },
      },
    });
  } catch (error) {
    throw new Migration0018GuardError("ARGUMENT_INVALID", "Migration 0018 arguments are invalid", undefined, { cause: error });
  }
  const environment = parsed.values.environment;
  if (environment !== "local" && environment !== "production") refuse("ENVIRONMENT_INVALID", "Environment must be local or production");
  const stringValue = (value: unknown): string | undefined => typeof value === "string" ? value : undefined;
  const envFile = stringValue(parsed.values["env-file"]);
  if (typeof envFile !== "string" || !envFile.trim()) refuse("ENV_FILE_REQUIRED", "Explicit --env-file is required");
  return {
    environment,
    envFile,
    execute: parsed.values.execute === true,
    confirmDatabase: stringValue(parsed.values["confirm-db"]),
    confirmMigration: stringValue(parsed.values["confirm-migration"]),
    confirmHash: stringValue(parsed.values["confirm-hash"]),
    maintenanceApproved: parsed.values["maintenance-approved"] === true,
    actorUserId: stringValue(parsed.values["actor-user-id"]) ?? "",
    reason: stringValue(parsed.values.reason) ?? "",
  };
}

function refuse(code: string, message: string): never {
  throw new Migration0018GuardError(code, message);
}

function sameJournal(actual: readonly MigrationJournalEntry[], expected: readonly MigrationJournalEntry[]): void {
  if (actual.some((entry) => entry.filename === MIGRATION_0018_FILENAME)) {
    refuse("MIGRATION_ALREADY_APPLIED", "Migration 0018 is already recorded");
  }
  if (actual.length !== expected.length) refuse("JOURNAL_INCOMPLETE", "Migration journal must contain exactly 0001-0017");
  for (let index = 0; index < expected.length; index += 1) {
    const actualEntry = actual[index];
    const expectedEntry = expected[index];
    if (actualEntry?.filename !== expectedEntry?.filename) refuse("JOURNAL_INCOMPLETE", "Migration journal order or filename mismatch");
    if (actualEntry.contentHash.toLowerCase() !== expectedEntry.contentHash.toLowerCase()) {
      refuse("JOURNAL_HASH_MISMATCH", `Migration journal hash mismatch at ${expectedEntry.filename}`);
    }
  }
}

function assertTarget(request: Migration0018Request, target: Migration0018TargetSnapshot): void {
  if (target.database.toLowerCase() === "jhcisdb") refuse("DATABASE_FORBIDDEN", "jhcisdb is never an allowed target");
  if (request.environment === "production") {
    if (!target.host.toLowerCase().endsWith(".tidbcloud.com")) refuse("PRODUCTION_HOST_INVALID", "Production host is not TiDB Cloud");
    if (target.port !== 4000) refuse("PRODUCTION_PORT_INVALID", "Production port must be 4000");
    if (target.database !== "drug_master_platform") refuse("PRODUCTION_DATABASE_INVALID", "Production database identity mismatch");
    if (!/tidb/i.test(target.serverVersion)) refuse("PRODUCTION_ENGINE_INVALID", "Production engine is not TiDB");
    if (!target.tlsVerified) refuse("TLS_REQUIRED", "Verified TLS is required for Production");
  } else {
    if (process.env.NODE_ENV !== "test" || process.env.ALLOW_DB_INTEGRATION_TESTS !== "1") {
      refuse("LOCAL_TEST_OPT_IN_REQUIRED", "Local execution requires the explicit integration-test opt-in");
    }
    if (target.host !== "127.0.0.1" || target.port !== 3306) refuse("LOCAL_TARGET_INVALID", "Local target must be 127.0.0.1:3306");
    if (target.database !== "drug_master_mapping_v2_test") refuse("LOCAL_DATABASE_INVALID", "Local target database identity mismatch");
    if (!/^8\.4\.3(?:\D|$)/.test(target.serverVersion)) refuse("LOCAL_ENGINE_INVALID", "Local target must be MySQL 8.4.3");
  }
}

function assertExecution(request: Migration0018Request, target: Migration0018TargetSnapshot): void {
  if (request.confirmDatabase !== target.database) refuse("EXECUTE_CONFIRM_DB_REQUIRED", "Exact --confirm-db is required");
  if (request.confirmMigration !== "0018") refuse("EXECUTE_CONFIRM_MIGRATION_REQUIRED", "Exact --confirm-migration 0018 is required");
  if (request.confirmHash?.toLowerCase() !== EXPECTED_MIGRATION_0018_SHA256) refuse("EXECUTE_CONFIRM_HASH_REQUIRED", "Exact migration hash confirmation is required");
  if (!request.maintenanceApproved) refuse("MAINTENANCE_APPROVAL_REQUIRED", "Explicit maintenance-window approval is required");
  if (!target.maintenanceAvailable) refuse("MAINTENANCE_STATE_UNAVAILABLE", "Maintenance state cannot be verified");
  if (!target.maintenanceEnabled) refuse("MAINTENANCE_MODE_REQUIRED", "Maintenance mode must be enabled");
}

function assertOperatorContext(request: Migration0018Request): void {
  if (!UUID.test(request.actorUserId)) refuse("ACTOR_REQUIRED", "A valid actor UUID is required");
  if (!request.reason.trim()) refuse("REASON_REQUIRED", "A non-empty reason is required");
}

export function migration0018Sha256(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

export function assertExternalEnvFile(path: string | undefined, repositoryRoot: string): string {
  if (!path?.trim()) refuse("ENV_FILE_REQUIRED", "Explicit --env-file outside the repository is required");
  const resolvedPath = resolve(path);
  const resolvedRoot = resolve(repositoryRoot);
  const relativePath = relative(resolvedRoot, resolvedPath);
  if (!relativePath.startsWith("..") || basename(resolvedPath).toLowerCase() === ".env.local") {
    refuse("ENV_FILE_UNSAFE", "Environment file must be outside the repository and must not be .env.local");
  }
  if (!existsSync(resolvedPath)) refuse("ENV_FILE_MISSING", "Environment file does not exist");
  return resolvedPath;
}

export function splitMigrationStatements(sql: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let quote: "'" | "\"" | "`" | null = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && sql[index + 1] === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\" && quote !== "`") escaped = true;
      else if (character === quote) {
        if (sql[index + 1] === quote) index += 1;
        else quote = null;
      }
      continue;
    }
    if (character === "#" || (character === "-" && sql[index + 1] === "-" && /\s/.test(sql[index + 2] ?? ""))) {
      lineComment = true;
      if (character === "-") index += 1;
      continue;
    }
    if (character === "/" && sql[index + 1] === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === "'" || character === "\"" || character === "`") {
      quote = character;
      continue;
    }
    if (character === ";") {
      const statement = sql.slice(start, index).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
  }
  if (quote) refuse("MIGRATION_SQL_INVALID", "Migration contains an unterminated quoted value");
  const tail = sql.slice(start).trim();
  if (tail) statements.push(tail);
  return statements;
}

export async function executeGuardedMigration0018(
  request: Migration0018Request,
  dependencies: Migration0018Dependencies,
): Promise<Migration0018Result> {
  if (dependencies.migrationHash.toLowerCase() !== EXPECTED_MIGRATION_0018_SHA256) {
    refuse("MIGRATION_HASH_INVALID", "Migration 0018 file hash differs from the reviewed release");
  }
  const statements = splitMigrationStatements(dependencies.migrationSql);
  if (statements.length === 0) refuse("MIGRATION_SQL_INVALID", "Migration 0018 contains no SQL statements");
  const target = await dependencies.inspectTarget();
  assertTarget(request, target);
  if (!target.journalTablePresent) refuse("JOURNAL_MISSING", "Existing schema_migrations table is required");
  sameJournal(target.journal, dependencies.expectedPriorJournal);
  if (target.datasetReleaseTables.length !== 0) refuse("PARTIAL_SCHEMA", "Unexpected Dataset Release tables already exist");
  assertOperatorContext(request);

  if (!request.execute) {
    return {
      mode: "dry-run", database: target.database, migration: MIGRATION_0018_FILENAME,
      migrationHash: dependencies.migrationHash, statementCount: statements.length,
      actorUserId: request.actorUserId, reasonSha256: migration0018Sha256(request.reason),
    };
  }
  assertExecution(request, target);

  for (let index = 0; index < statements.length; index += 1) {
    try {
      await dependencies.executeStatement(statements[index], index + 1);
      dependencies.onStatementComplete?.({ index: index + 1, total: statements.length });
    } catch (error) {
      throw new Migration0018GuardError(
        "PARTIAL_DDL_FAILURE",
        `Migration 0018 stopped after DDL statement ${index + 1}; do not retry automatically`,
        index + 1,
        { cause: error },
      );
    }
  }

  const schema = await dependencies.verifySchema();
  if (!schema.valid) {
    throw new Migration0018GuardError("POST_SCHEMA_INVALID", "Migration 0018 schema verification failed; journal was not written");
  }
  try {
    await dependencies.recordJournal(MIGRATION_0018_FILENAME, dependencies.migrationHash);
  } catch (error) {
    throw new Migration0018GuardError("JOURNAL_WRITE_FAILED", "DDL completed but journal write failed; do not retry automatically", undefined, { cause: error });
  }
  return {
    mode: "executed", database: target.database, migration: MIGRATION_0018_FILENAME,
    migrationHash: dependencies.migrationHash, statementCount: statements.length,
    actorUserId: request.actorUserId, reasonSha256: migration0018Sha256(request.reason),
  };
}

function rows(result: unknown): RowDataPacket[] {
  return Array.isArray(result) ? result as RowDataPacket[] : [];
}

export function createMigration0018PoolDependencies(input: {
  pool: Pool;
  environment: Migration0018Environment;
  host: string;
  port: number;
  tlsVerified: boolean;
  expectedPriorJournal: readonly MigrationJournalEntry[];
  migrationSql: string;
  migrationHash: string;
  maintenanceState(): Promise<{ available: boolean; enabled: boolean }>;
  onStatementComplete?(input: { index: number; total: number }): void;
}): Migration0018Dependencies {
  const tablePlaceholders = MIGRATION_0018_TABLES.map(() => "?").join(",");
  return {
    expectedPriorJournal: input.expectedPriorJournal,
    migrationSql: input.migrationSql,
    migrationHash: input.migrationHash,
    async inspectTarget() {
      const [identityResult] = await input.pool.query<RowDataPacket[]>("SELECT DATABASE() AS databaseName,VERSION() AS serverVersion");
      const [journalTableResult] = await input.pool.execute<RowDataPacket[]>(
        "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='schema_migrations'",
      );
      const journalTablePresent = rows(journalTableResult).length === 1;
      const journal = journalTablePresent
        ? (await input.pool.execute<RowDataPacket[]>("SELECT filename,content_hash FROM schema_migrations ORDER BY filename"))[0].map((row) => ({
          filename: String(row.filename), contentHash: String(row.content_hash),
        }))
        : [];
      const [datasetTableResult] = await input.pool.execute<RowDataPacket[]>(
        `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${tablePlaceholders}) ORDER BY TABLE_NAME`,
        [...MIGRATION_0018_TABLES],
      );
      const maintenance = await input.maintenanceState();
      return {
        host: input.host,
        port: input.port,
        database: String(identityResult[0]?.databaseName ?? ""),
        serverVersion: String(identityResult[0]?.serverVersion ?? ""),
        tlsVerified: input.tlsVerified,
        maintenanceAvailable: maintenance.available,
        maintenanceEnabled: maintenance.enabled,
        journalTablePresent,
        journal,
        datasetReleaseTables: datasetTableResult.map((row) => String(row.TABLE_NAME)),
      };
    },
    async executeStatement(sql) {
      await input.pool.query(sql);
    },
    async verifySchema() {
      const [tableResult] = await input.pool.execute<RowDataPacket[]>(
        `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${tablePlaceholders})`,
        [...MIGRATION_0018_TABLES],
      );
      const present = new Set(tableResult.map((row) => String(row.TABLE_NAME)));
      const missingTables = MIGRATION_0018_TABLES.filter((table) => !present.has(table));
      const [primaryResult] = await input.pool.execute<RowDataPacket[]>(
        `SELECT TABLE_NAME,COLUMN_NAME,SEQ_IN_INDEX FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND INDEX_NAME='PRIMARY' AND TABLE_NAME IN (${SHADOW_TABLES.map(() => "?").join(",")}) ORDER BY TABLE_NAME,SEQ_IN_INDEX`,
        [...SHADOW_TABLES],
      );
      const firstPrimary = new Map<string, string>();
      for (const row of primaryResult) if (Number(row.SEQ_IN_INDEX) === 1) firstPrimary.set(String(row.TABLE_NAME), String(row.COLUMN_NAME));
      const invalidPrimaryKeys = SHADOW_TABLES.filter((table) => firstPrimary.get(table) !== "dataset_id");
      const [foreignResult] = await input.pool.execute<RowDataPacket[]>(
        `SELECT TABLE_NAME,REFERENCED_TABLE_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND COLUMN_NAME='dataset_id' AND REFERENCED_TABLE_NAME IS NOT NULL AND TABLE_NAME IN (${SHADOW_TABLES.map(() => "?").join(",")})`,
        [...SHADOW_TABLES],
      );
      const datasetForeignKeys = new Map(foreignResult.map((row) => [String(row.TABLE_NAME), String(row.REFERENCED_TABLE_NAME)]));
      const invalidForeignKeys = SHADOW_TABLES.filter((table) => datasetForeignKeys.get(table) !== "standard_datasets");
      return {
        valid: missingTables.length === 0 && invalidPrimaryKeys.length === 0 && invalidForeignKeys.length === 0,
        missingTables,
        invalidPrimaryKeys,
        invalidForeignKeys,
      };
    },
    async recordJournal(filename, hash) {
      await input.pool.execute("INSERT INTO schema_migrations (filename,content_hash) VALUES (?,?)", [filename, hash]);
    },
    onStatementComplete: input.onStatementComplete,
  };
}

export function redactMigration0018Error(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/(password|secret|token|credential|authorization|DB_PASSWORD)\s*[=:]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/mysql:\/\/[^\s@]+@/gi, "mysql://[REDACTED]@");
}

export function readMigrationFile(path: string): { sql: string; hash: string } {
  const sql = readFileSync(path, "utf8");
  return { sql, hash: migration0018Sha256(sql) };
}
