import { randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

export interface TidbProbePlan {
  operationId: string;
  parentTable: string;
  childTable: string;
  ownerComment: string;
  createParent: string;
  createChild: string;
  alterNullable: string;
  alterLegacyEvidenceNullable: string;
  duplicateAlter: string;
}

export interface TidbProbeResult {
  operation: "tidb-probe";
  operationId: string;
  result: "PASS";
  checks: readonly string[];
  cleanup: "PASS";
}

export class TidbProductionProbeError extends Error {
  constructor(readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TidbProductionProbeError";
  }
}

function refuse(code: string, message: string): never {
  throw new TidbProductionProbeError(code, message);
}

function safeIdentifier(value: string): string {
  if (!/^dm_probe_[a-f0-9]{12}_(?:parent|child)$/.test(value)) refuse("PROBE_IDENTIFIER_INVALID", "Probe identifier is invalid");
  return `\`${value}\``;
}

export function buildTidbProbePlan(operationId: string, ownerToken: string): TidbProbePlan {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) {
    refuse("PROBE_OPERATION_ID_INVALID", "Probe operation ID must be a UUID");
  }
  if (!/^[a-f0-9]{64}$/.test(ownerToken)) refuse("PROBE_OWNER_TOKEN_INVALID", "Probe ownership token must be 256-bit hex");
  const suffix = operationId.replaceAll("-", "").toLowerCase().slice(0, 12);
  const parentTable = `dm_probe_${suffix}_parent`;
  const childTable = `dm_probe_${suffix}_child`;
  const parent = safeIdentifier(parentTable);
  const child = safeIdentifier(childTable);
  const ownerComment = `dm_probe_owner:${ownerToken}`;
  return {
    operationId,
    parentTable,
    childTable,
    ownerComment,
    createParent: `CREATE TABLE ${parent} (id CHAR(36) COLLATE utf8mb4_unicode_ci NOT NULL, owner_token CHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL, payload VARCHAR(64) COLLATE utf8mb4_unicode_ci NULL, PRIMARY KEY (id), UNIQUE KEY uq_owner_token (owner_token)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='${ownerComment}'`,
    createChild: `CREATE TABLE ${child} (parent_id CHAR(36) COLLATE utf8mb4_unicode_ci NOT NULL, seq INT NOT NULL, evidence_import_id CHAR(36) COLLATE utf8mb4_unicode_ci NOT NULL, evidence_hash CHAR(64) NOT NULL, evidence_rows INT UNSIGNED NOT NULL, PRIMARY KEY (parent_id,seq), CONSTRAINT fk_${suffix}_probe_parent FOREIGN KEY (parent_id) REFERENCES ${parent} (id), CONSTRAINT fk_${suffix}_evidence_import FOREIGN KEY (evidence_import_id) REFERENCES ${parent} (id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='${ownerComment}'`,
    alterNullable: `ALTER TABLE ${parent} ADD COLUMN optional_note VARCHAR(120) COLLATE utf8mb4_unicode_ci NULL`,
    alterLegacyEvidenceNullable: `ALTER TABLE ${child} MODIFY COLUMN evidence_import_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL, MODIFY COLUMN evidence_hash CHAR(64) NULL, MODIFY COLUMN evidence_rows INT UNSIGNED NULL`,
    duplicateAlter: `ALTER TABLE ${parent} ADD COLUMN optional_note VARCHAR(120) COLLATE utf8mb4_unicode_ci NULL`,
  };
}

export function assertNoProbeCollisions(existingTables: readonly string[]): void {
  if (existingTables.length !== 0) refuse("PROBE_OBJECT_COLLISION", "Probe table name already exists");
}

export function assertProbeOwnership(
  rows: readonly { tableName: string; tableComment: string }[],
  plan: TidbProbePlan,
): void {
  for (const row of rows) {
    if (![plan.parentTable, plan.childTable].includes(row.tableName) || row.tableComment !== plan.ownerComment) {
      refuse("PROBE_OWNERSHIP_MISMATCH", "Probe cleanup ownership verification failed");
    }
  }
}

function driverDetails(error: unknown): { mysqlCode?: string; sqlState?: string; message: string } {
  const candidate = error as { code?: unknown; sqlState?: unknown; message?: unknown };
  return {
    mysqlCode: typeof candidate?.code === "string" ? candidate.code : undefined,
    sqlState: typeof candidate?.sqlState === "string" ? candidate.sqlState : undefined,
    message: typeof candidate?.message === "string"
      ? candidate.message.replace(/(password|token|secret)\s*[=:]\s*[^\s,;]+/gi, "$1=[REDACTED]")
      : "TiDB probe operation failed",
  };
}

function isExpected(error: unknown, codes: readonly string[], states: readonly string[] = []): boolean {
  const details = driverDetails(error);
  return (details.mysqlCode !== undefined && codes.includes(details.mysqlCode))
    || (details.sqlState !== undefined && states.includes(details.sqlState));
}

async function existingProbeTables(pool: Pool, plan: TidbProbePlan): Promise<{ tableName: string; tableComment: string }[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT TABLE_NAME,TABLE_COMMENT FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?,?)",
    [plan.parentTable, plan.childTable],
  );
  return rows.map((row) => ({ tableName: String(row.TABLE_NAME), tableComment: String(row.TABLE_COMMENT ?? "") }));
}

async function countRows(connection: Pick<Pool, "query"> | PoolConnection, table: string): Promise<number> {
  const [rows] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM ${safeIdentifier(table)}`);
  return Number(rows[0]?.total ?? 0);
}

async function cleanupOwnedProbeTables(pool: Pool, plan: TidbProbePlan): Promise<void> {
  const existing = await existingProbeTables(pool, plan);
  assertProbeOwnership(existing, plan);
  const names = new Set(existing.map((row) => row.tableName));
  if (names.has(plan.childTable)) await pool.query(`DROP TABLE ${safeIdentifier(plan.childTable)}`);
  if (names.has(plan.parentTable)) await pool.query(`DROP TABLE ${safeIdentifier(plan.parentTable)}`);
  if ((await existingProbeTables(pool, plan)).length) refuse("PROBE_OBJECTS_REMAIN", "Owned probe tables remain after cleanup");
}

async function expectForeignKeyFailure(connection: PoolConnection, plan: TidbProbePlan): Promise<void> {
  try {
    await connection.execute(
      `INSERT INTO ${safeIdentifier(plan.childTable)} (parent_id,seq) VALUES (?,1)`,
      [randomUUID()],
    );
    refuse("PROBE_FK_NOT_ENFORCED", "Probe foreign key unexpectedly accepted an orphan row");
  } catch (error) {
    if (error instanceof TidbProductionProbeError || !isExpected(error, ["ER_NO_REFERENCED_ROW_2"], ["23000"])) throw error;
  }
}

async function verifyLockWait(pool: Pool, plan: TidbProbePlan, rowId: string): Promise<void> {
  const first = await pool.getConnection();
  const second = await pool.getConnection();
  try {
    await first.beginTransaction();
    await first.execute(`SELECT id FROM ${safeIdentifier(plan.parentTable)} WHERE id=? FOR UPDATE`, [rowId]);
    await second.query("SET SESSION innodb_lock_wait_timeout=1");
    await second.beginTransaction();
    try {
      await second.execute(`SELECT id FROM ${safeIdentifier(plan.parentTable)} WHERE id=? FOR UPDATE`, [rowId]);
      refuse("PROBE_LOCK_NOT_ENFORCED", "Second connection was not blocked by SELECT FOR UPDATE");
    } catch (error) {
      if (error instanceof TidbProductionProbeError || !isExpected(error, ["ER_LOCK_WAIT_TIMEOUT"], ["41000"])) throw error;
    }
  } finally {
    await second.rollback().catch(() => undefined);
    await first.rollback().catch(() => undefined);
    second.release();
    first.release();
  }
}

export async function runTidbProductionProbe(input: {
  pool: Pool;
  operationId: string;
  execute: boolean;
}): Promise<TidbProbeResult | { operation: "tidb-probe"; operationId: string; result: "DRY_RUN"; checks: readonly string[] }> {
  const ownerToken = randomBytes(32).toString("hex");
  const plan = buildTidbProbePlan(input.operationId, ownerToken);
  assertNoProbeCollisions((await existingProbeTables(input.pool, plan)).map((row) => row.tableName));
  const checks = ["CHAR36_COLLATION", "PRIMARY_INDEX_FOREIGN_KEY", "NULLABLE_ALTER", "FK_COLUMN_NULLABILITY", "TRANSACTION_ROLLBACK", "SELECT_FOR_UPDATE", "DDL_PARTIAL_STATE"] as const;
  if (!input.execute) return { operation: "tidb-probe", operationId: input.operationId, result: "DRY_RUN", checks };

  let cleanup: "PASS" | "FAIL" = "FAIL";
  try {
    await input.pool.query(plan.createParent);
    await input.pool.query(plan.createChild);
    await input.pool.query(plan.alterNullable);
    await input.pool.query(plan.alterLegacyEvidenceNullable);
    const [fkColumns] = await input.pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME IN ('evidence_import_id','evidence_hash','evidence_rows') AND IS_NULLABLE='YES'",
      [plan.childTable],
    );
    if (Number(fkColumns[0]?.total ?? 0) !== 3) refuse("PROBE_PARTIAL_DDL_STATE", "Evidence columns did not all become nullable");
    const [foreignKeys] = await input.pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME='evidence_import_id' AND REFERENCED_TABLE_NAME=?",
      [plan.childTable, plan.parentTable],
    );
    if (Number(foreignKeys[0]?.total ?? 0) !== 1) refuse("PROBE_FK_NOT_ENFORCED", "Evidence import foreign key did not survive nullable ALTER");
    try {
      await input.pool.query(plan.duplicateAlter);
      refuse("PROBE_DDL_FAILURE_NOT_DETECTED", "Duplicate ALTER unexpectedly succeeded");
    } catch (error) {
      if (error instanceof TidbProductionProbeError || !isExpected(error, ["ER_DUP_FIELDNAME"], ["42S21"])) throw error;
    }
    const [columns] = await input.pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME='optional_note' AND IS_NULLABLE='YES'",
      [plan.parentTable],
    );
    if (Number(columns[0]?.total ?? 0) !== 1) refuse("PROBE_PARTIAL_DDL_STATE", "Nullable ALTER state is not exact");

    const transaction = await input.pool.getConnection();
    try {
      await transaction.beginTransaction();
      const rowId = randomUUID();
      await transaction.execute(`INSERT INTO ${safeIdentifier(plan.parentTable)} (id,owner_token,payload) VALUES (?,?,?)`, [rowId, ownerToken, "rollback"]);
      await transaction.execute(`INSERT INTO ${safeIdentifier(plan.childTable)} (parent_id,seq) VALUES (?,1)`, [rowId]);
      await transaction.rollback();
      await transaction.beginTransaction();
      await expectForeignKeyFailure(transaction, plan);
      await transaction.rollback();
    } finally {
      await transaction.rollback().catch(() => undefined);
      transaction.release();
    }
    if (await countRows(input.pool, plan.parentTable) !== 0 || await countRows(input.pool, plan.childTable) !== 0) {
      refuse("PROBE_TRANSACTION_ROLLBACK_FAILED", "Probe transaction left rows behind");
    }

    const lockRowId = randomUUID();
    await input.pool.execute(`INSERT INTO ${safeIdentifier(plan.parentTable)} (id,owner_token,payload) VALUES (?,?,?)`, [lockRowId, ownerToken, "lock"]);
    await verifyLockWait(input.pool, plan, lockRowId);
    await input.pool.execute(`DELETE FROM ${safeIdentifier(plan.parentTable)} WHERE id=?`, [lockRowId]);
  } catch (error) {
    throw new TidbProductionProbeError("TIDB_PROBE_FAILED", driverDetails(error).message, { cause: error });
  } finally {
    try {
      await cleanupOwnedProbeTables(input.pool, plan);
      cleanup = "PASS";
    } catch (error) {
      if (cleanup !== "PASS") throw new TidbProductionProbeError("PROBE_CLEANUP_FAILED", driverDetails(error).message, { cause: error });
    }
  }
  return { operation: "tidb-probe", operationId: input.operationId, result: "PASS", checks, cleanup };
}

export function tidbProbeDiagnostic(error: unknown): { mysqlCode?: string; sqlState?: string; message: string } {
  const cause = error instanceof TidbProductionProbeError && error.cause ? error.cause : error;
  return driverDetails(cause);
}
