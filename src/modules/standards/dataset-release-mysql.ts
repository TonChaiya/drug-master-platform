import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import {
  DatasetReleaseError,
  type BaselineStore,
  type DatasetInspection,
  type DatasetManifest,
  type ReleaseLifecycleStore,
  type ReleaseValidationBundle,
  type StandardDatasetRecord,
  type StandardDatasetSource,
  type StandardReleaseRecord,
} from "./dataset-release";
import { canonicalizeTmtValidationCheckpoints, parseTmtValidationEvidence } from "@/modules/tmt/validation";
import { TMT_UNVERIFIED_REQUIRED_ENDPOINTS } from "@/modules/tmt/sync";
import { canonicalDatasetRow } from "./dataset-staging";

type Executor = Pick<PoolConnection, "execute" | "query">;

interface DatasetTableDefinition {
  sourceTable: string;
  targetTable: string;
  primaryKey: string[];
}

const TMT_TABLES: DatasetTableDefinition[] = [
  { sourceTable: "tmt_concept", targetTable: "tmt_dataset_concepts", primaryKey: ["tmtid"] },
  { sourceTable: "tmt_relationship", targetTable: "tmt_dataset_relationships", primaryKey: ["concept1", "concept2"] },
  { sourceTable: "tmt_mastertmt", targetTable: "tmt_dataset_mastertmt", primaryKey: ["tpucode"] },
  { sourceTable: "tmt_subs", targetTable: "tmt_dataset_subs", primaryKey: ["subsid"] },
  { sourceTable: "tmt_vtm", targetTable: "tmt_dataset_vtm", primaryKey: ["vtmid"] },
  { sourceTable: "tmt_gp", targetTable: "tmt_dataset_gp", primaryKey: ["gpid"] },
  { sourceTable: "tmt_gpu", targetTable: "tmt_dataset_gpu", primaryKey: ["gpuid"] },
  { sourceTable: "tmt_gpp", targetTable: "tmt_dataset_gpp", primaryKey: ["gppid"] },
  { sourceTable: "tmt_tp", targetTable: "tmt_dataset_tp", primaryKey: ["tpid"] },
  { sourceTable: "tmt_tpu", targetTable: "tmt_dataset_tpu", primaryKey: ["tpuid"] },
  { sourceTable: "tmt_tpp", targetTable: "tmt_dataset_tpp", primaryKey: ["tppid"] },
  { sourceTable: "tmt_nlem", targetTable: "tmt_dataset_nlem", primaryKey: ["tpuid", "change_date", "nlem"] },
  { sourceTable: "tmt_atc", targetTable: "tmt_dataset_atc", primaryKey: ["tpuid", "change_date", "atc"] },
  { sourceTable: "tmt_regno", targetTable: "tmt_dataset_regno", primaryKey: ["tpuid", "change_date", "regno"] },
];

const TTMT_TABLES: DatasetTableDefinition[] = [
  { sourceTable: "ttmt_products", targetTable: "ttmt_dataset_products", primaryKey: ["ttmtcode"] },
];

const VERSIONED_LEVELS = [
  ["subs", "tmt_dataset_subs", "subsid"], ["vtm", "tmt_dataset_vtm", "vtmid"],
  ["gp", "tmt_dataset_gp", "gpid"], ["gpu", "tmt_dataset_gpu", "gpuid"],
  ["gpp", "tmt_dataset_gpp", "gppid"], ["tp", "tmt_dataset_tp", "tpid"],
  ["tpu", "tmt_dataset_tpu", "tpuid"], ["tpp", "tmt_dataset_tpp", "tppid"],
] as const;

function tablesFor(source: StandardDatasetSource): DatasetTableDefinition[] {
  return source === "TMT" ? TMT_TABLES : TTMT_TABLES;
}

function quote(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new DatasetReleaseError("Unsafe dataset table or column name", "INVALID_IDENTIFIER");
  return `\`${name}\``;
}

function aggregateManifest(manifests: DatasetManifest[]): string {
  const payload = [...manifests]
    .sort((left, right) => left.tableName.localeCompare(right.tableName))
    .map((entry) => `${entry.tableName}:${entry.rowCount}:${entry.contentHash}`)
    .join("\n");
  return createHash("sha256").update(payload).digest("hex");
}

async function tableColumns(executor: Executor, tableName: string): Promise<string[]> {
  const [rows] = await executor.execute<RowDataPacket[]>(
    "SELECT COLUMN_NAME AS column_name FROM information_schema.COLUMNS WHERE table_schema=DATABASE() AND table_name=? ORDER BY ORDINAL_POSITION",
    [tableName],
  );
  const columns = rows.map((row) => String(row.column_name)).filter((column) => column !== "dataset_id");
  if (columns.length === 0) throw new DatasetReleaseError(`Dataset table is missing: ${tableName}`, "DATASET_TABLE_MISSING");
  return columns;
}

async function compatibleColumns(executor: Executor, definition: DatasetTableDefinition): Promise<string[]> {
  const [sourceColumns, targetColumns] = await Promise.all([
    tableColumns(executor, definition.sourceTable),
    tableColumns(executor, definition.targetTable),
  ]);
  if (JSON.stringify(sourceColumns) !== JSON.stringify(targetColumns)) {
    throw new DatasetReleaseError(`Live/versioned table columns differ for ${definition.sourceTable}`, "DATASET_COLUMNS_MISMATCH");
  }
  return sourceColumns;
}

async function countRows(executor: Executor, tableName: string, datasetId?: string): Promise<number> {
  const where = datasetId ? " WHERE dataset_id=?" : "";
  const [rows] = await executor.execute<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM ${quote(tableName)}${where}`, datasetId ? [datasetId] : []);
  return Number(rows[0]?.total ?? 0);
}

async function inspectTables(
  executor: Executor,
  definitions: DatasetTableDefinition[],
  batchSize: number,
  datasetId?: string,
): Promise<DatasetInspection> {
  const manifests: DatasetManifest[] = [];
  for (const definition of definitions) {
    const columns = await compatibleColumns(executor, definition);
    const hash = createHash("sha256");
    let rowCount = 0;
    for (let offset = 0; ; offset += batchSize) {
      const where = datasetId ? " WHERE dataset_id=?" : "";
      const params: Array<string | number> = datasetId ? [datasetId, batchSize, offset] : [batchSize, offset];
      const [rows] = await executor.execute<RowDataPacket[]>(
        `SELECT ${columns.map(quote).join(",")} FROM ${quote(datasetId ? definition.targetTable : definition.sourceTable)}${where} ORDER BY ${definition.primaryKey.map(quote).join(",")} LIMIT ? OFFSET ?`,
        params,
      );
      for (const row of rows) {
        if (rowCount > 0) hash.update("\n");
        hash.update(canonicalDatasetRow(Object.fromEntries(columns.map((column) => [column, row[column]]))));
        rowCount += 1;
      }
      if (rows.length < batchSize) break;
    }
    manifests.push({ tableName: definition.targetTable, rowCount, contentHash: hash.digest("hex") });
  }
  manifests.sort((left, right) => left.tableName.localeCompare(right.tableName));
  return { manifests, contentHash: aggregateManifest(manifests) };
}

function datasetRecord(row: RowDataPacket): StandardDatasetRecord {
  return {
    id: String(row.id),
    source: String(row.source) as StandardDatasetSource,
    state: String(row.state) as StandardDatasetRecord["state"],
    sourceVersion: String(row.source_version),
    contentHash: row.content_hash === null ? null : String(row.content_hash),
    tmtSyncRunId: row.tmt_sync_run_id === null ? null : String(row.tmt_sync_run_id),
    ttmtImportId: row.ttmt_import_id === null ? null : String(row.ttmt_import_id),
  };
}

function releaseRecord(row: RowDataPacket): StandardReleaseRecord {
  return {
    id: String(row.id),
    state: String(row.state),
    tmtDatasetId: String(row.tmt_dataset_id),
    ttmtDatasetId: String(row.ttmt_dataset_id),
    validationEvidenceSha256: row.validation_evidence_sha256 === null ? null : String(row.validation_evidence_sha256),
    approvedAt: row.approved_at instanceof Date ? row.approved_at : row.approved_at ? new Date(String(row.approved_at)) : null,
    supersededAt: row.superseded_at instanceof Date ? row.superseded_at : row.superseded_at ? new Date(String(row.superseded_at)) : null,
  };
}

async function invariantCount(executor: Executor, body: string, parameters: string[]): Promise<number> {
  const [rows] = await executor.execute<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM (${body}) invariant_rows`, parameters);
  return Number(rows[0]?.total ?? 0);
}

async function versionedTmtInvariantCount(executor: Executor, datasetId: string): Promise<number> {
  const checks: Array<Promise<number>> = [];
  for (const [level, table, id] of VERSIONED_LEVELS) {
    checks.push(invariantCount(executor,
      `SELECT c.tmtid FROM tmt_dataset_concepts c LEFT JOIN ${quote(table)} e ON e.dataset_id=c.dataset_id AND e.${quote(id)}=c.tmtid WHERE c.dataset_id=? AND LOWER(c.level_name)='${level}' AND e.${quote(id)} IS NULL`,
      [datasetId]));
    checks.push(invariantCount(executor,
      `SELECT e.${quote(id)} FROM ${quote(table)} e LEFT JOIN tmt_dataset_concepts c ON c.dataset_id=e.dataset_id AND c.tmtid=e.${quote(id)} WHERE e.dataset_id=? AND c.tmtid IS NULL`,
      [datasetId]));
    checks.push(invariantCount(executor,
      `SELECT e.${quote(id)} FROM ${quote(table)} e INNER JOIN tmt_dataset_concepts c ON c.dataset_id=e.dataset_id AND c.tmtid=e.${quote(id)} WHERE e.dataset_id=? AND LOWER(c.level_name)<>'${level}'`,
      [datasetId]));
  }
  checks.push(invariantCount(executor,
    "SELECT m.tpucode FROM tmt_dataset_mastertmt m LEFT JOIN tmt_dataset_tpu t ON t.dataset_id=m.dataset_id AND t.tpuid=m.tpucode WHERE m.dataset_id=? AND t.tpuid IS NULL", [datasetId]));
  checks.push(invariantCount(executor,
    "SELECT m.tpucode FROM tmt_dataset_mastertmt m LEFT JOIN tmt_dataset_concepts c ON c.dataset_id=m.dataset_id AND c.tmtid=m.tpucode WHERE m.dataset_id=? AND c.tmtid IS NULL", [datasetId]));
  checks.push(invariantCount(executor,
    "SELECT t.tpuid FROM tmt_dataset_tpu t LEFT JOIN tmt_dataset_mastertmt m ON m.dataset_id=t.dataset_id AND m.tpucode=t.tpuid WHERE t.dataset_id=? AND m.tpucode IS NULL", [datasetId]));
  checks.push(invariantCount(executor,
    "SELECT tmtid FROM tmt_dataset_concepts WHERE dataset_id=? AND LOWER(level_name) NOT IN ('subs','vtm','gp','gpu','gpp','tp','tpu','tpp')", [datasetId]));
  checks.push(invariantCount(executor,
    "SELECT concept1,concept2 FROM tmt_dataset_relationships WHERE dataset_id=? GROUP BY concept1,concept2 HAVING COUNT(*)>1", [datasetId]));
  checks.push(invariantCount(executor,
    "SELECT tpucode FROM tmt_dataset_mastertmt WHERE dataset_id=? AND status NOT IN (0,1)", [datasetId]));
  return (await Promise.all(checks)).reduce((total, count) => total + count, 0);
}

async function versionedGpu764169Passed(executor: Executor, datasetId: string): Promise<boolean> {
  const code = "764169";
  const [gpuRows, conceptRows, edgeRows] = await Promise.all([
    executor.execute<RowDataPacket[]>("SELECT gpuid FROM tmt_dataset_gpu WHERE dataset_id=? AND gpuid=? LIMIT 1", [datasetId, code]).then(([rows]) => rows),
    executor.execute<RowDataPacket[]>("SELECT level_name FROM tmt_dataset_concepts WHERE dataset_id=? AND tmtid=? LIMIT 1", [datasetId, code]).then(([rows]) => rows),
    executor.execute<RowDataPacket[]>("SELECT CAST(concept2 AS CHAR) AS tmtid FROM tmt_dataset_relationships WHERE dataset_id=? AND concept1=? AND LOWER(level_name2)='tpu' ORDER BY concept2", [datasetId, code]).then(([rows]) => rows),
  ]);
  const ids = edgeRows.map((row) => String(row.tmtid));
  if (!gpuRows[0] || String(conceptRows[0]?.level_name).toLowerCase() !== "gpu" || ids.length === 0) return false;
  const placeholders = ids.map(() => "?").join(",");
  const parameters = [datasetId, ...ids];
  const [tpuRows, masterRows, conceptCountRows] = await Promise.all([
    executor.execute<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM tmt_dataset_tpu WHERE dataset_id=? AND tpuid IN (${placeholders})`, parameters).then(([rows]) => rows),
    executor.execute<RowDataPacket[]>(`SELECT COUNT(*) AS total,SUM(status=0) AS active_total FROM tmt_dataset_mastertmt WHERE dataset_id=? AND tpucode IN (${placeholders})`, parameters).then(([rows]) => rows),
    executor.execute<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM tmt_dataset_concepts WHERE dataset_id=? AND tmtid IN (${placeholders})`, parameters).then(([rows]) => rows),
  ]);
  return Number(tpuRows[0]?.total ?? 0) === ids.length
    && Number(masterRows[0]?.total ?? 0) === ids.length
    && Number(masterRows[0]?.active_total ?? 0) > 0
    && Number(conceptCountRows[0]?.total ?? 0) === ids.length;
}

async function tmtForeignVersionRowCount(executor: Executor, datasetId: string, sourceVersion: string): Promise<number> {
  const withoutLastSeen = new Set(["tmt_dataset_nlem", "tmt_dataset_atc", "tmt_dataset_regno"]);
  const counts = await Promise.all(TMT_TABLES.map(async ({ targetTable }) => {
    const lastSeen = withoutLastSeen.has(targetTable) ? "" : " OR last_seen_version<>?";
    const parameters = withoutLastSeen.has(targetTable) ? [datasetId, sourceVersion] : [datasetId, sourceVersion, sourceVersion];
    const [rows] = await executor.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM ${quote(targetTable)} WHERE dataset_id=? AND (source_version<>?${lastSeen})`, parameters,
    );
    return Number(rows[0]?.total ?? 0);
  }));
  return counts.reduce((total, count) => total + count, 0);
}

export async function latestRegNoConflictCount(executor: Pick<PoolConnection, "execute">, datasetId: string): Promise<number> {
  const [rows] = await executor.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM (
      SELECT r.tpuid,r.change_date FROM tmt_dataset_regno r
      INNER JOIN (
        SELECT tpuid,MAX(change_date) AS latest_date FROM tmt_dataset_regno WHERE dataset_id=? GROUP BY tpuid
      ) latest ON latest.tpuid=r.tpuid AND latest.latest_date=r.change_date
      WHERE r.dataset_id=? GROUP BY r.tpuid,r.change_date HAVING COUNT(DISTINCT r.regno)>1
     ) conflicts`,
    [datasetId, datasetId],
  );
  return Number(rows[0]?.total ?? 0);
}

function baselineStore(executor: Executor, transactionOwner?: Pool): BaselineStore {
  const inspectSnapshot = async (work: (snapshot: Executor) => Promise<DatasetInspection>) => {
    if (!transactionOwner) return work(executor);
    const connection = await transactionOwner.getConnection();
    try {
      await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      await connection.beginTransaction();
      const result = await work(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  };
  return {
    async readCandidate(datasetId) {
      const [rows] = await executor.execute<RowDataPacket[]>(
        "SELECT id,source,state,source_version,content_hash,tmt_sync_run_id,ttmt_import_id FROM standard_datasets WHERE id=? LIMIT 1",
        [datasetId],
      );
      return rows[0] ? datasetRecord(rows[0]) : null;
    },
    inspectLiveSource(source, batchSize) {
      return inspectSnapshot((snapshot) => inspectTables(snapshot, tablesFor(source), batchSize));
    },
    async createCandidate(input) {
      const sourceSql = input.source === "TMT"
        ? "SELECT id,tmt_version AS source_version FROM tmt_sync_runs WHERE id=? LIMIT 1"
        : "SELECT id,version AS source_version FROM ttmt_imports WHERE id=? LIMIT 1";
      const sourceId = input.source === "TMT" ? input.tmtSyncRunId : input.ttmtImportId;
      const [sourceRows] = await executor.execute<RowDataPacket[]>(sourceSql, [sourceId]);
      if (!sourceRows[0] || String(sourceRows[0].source_version) !== input.sourceVersion) {
        throw new DatasetReleaseError("Baseline source version does not match its run/import", "BASELINE_SOURCE_VERSION_MISMATCH");
      }
      await executor.execute(
        `INSERT INTO standard_datasets (id,source,state,source_version,content_hash,tmt_sync_run_id,ttmt_import_id)
         VALUES (?,?,'writing',?,?,?,?)`,
        [input.datasetId, input.source, input.sourceVersion, input.contentHash, input.tmtSyncRunId, input.ttmtImportId],
      );
    },
    async copyNextBatch(input) {
      const copy = async (tx: Executor) => {
        const [candidateRows] = await tx.execute<RowDataPacket[]>("SELECT state FROM standard_datasets WHERE id=? FOR UPDATE", [input.datasetId]);
        if (!candidateRows[0] || String(candidateRows[0].state) !== "writing") {
          throw new DatasetReleaseError("Only a writing baseline candidate can receive rows", "BASELINE_IMMUTABLE");
        }
        for (const definition of tablesFor(input.source)) {
          const [sourceCount, targetCount] = await Promise.all([
            countRows(tx, definition.sourceTable),
            countRows(tx, definition.targetTable, input.datasetId),
          ]);
          if (targetCount > sourceCount) throw new DatasetReleaseError("Baseline target contains more rows than its live source", "BASELINE_TARGET_INVALID");
          if (targetCount === sourceCount) continue;
          const columns = await compatibleColumns(tx, definition);
          const remaining = sourceCount - targetCount;
          const copiedRows = Math.min(input.batchSize, remaining);
          // ponytail: OFFSET keeps resumability schema-free; move to persisted per-table key cursors if tables grow beyond controlled TMT volumes.
          const [result] = await tx.execute<ResultSetHeader>(
            `INSERT IGNORE INTO ${quote(definition.targetTable)} (${["dataset_id", ...columns].map(quote).join(",")})
             SELECT ?,${columns.map(quote).join(",")} FROM ${quote(definition.sourceTable)}
             ORDER BY ${definition.primaryKey.map(quote).join(",")} LIMIT ? OFFSET ?`,
            [input.datasetId, copiedRows, targetCount],
          );
          if (result.affectedRows !== copiedRows) {
            throw new DatasetReleaseError("Baseline batch could not copy every selected row", "BASELINE_BATCH_INCOMPLETE");
          }
          return { copiedRows, complete: targetCount + copiedRows === sourceCount && definition === tablesFor(input.source).at(-1) };
        }
        return { copiedRows: 0, complete: true };
      };
      if (!transactionOwner || typeof transactionOwner.getConnection !== "function") return copy(executor);
      const connection = await transactionOwner.getConnection();
      try {
        await connection.beginTransaction();
        const result = await copy(connection);
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    },
    inspectVersionedDataset(datasetId, source, batchSize) {
      return inspectSnapshot((snapshot) => inspectTables(snapshot, tablesFor(source), batchSize, datasetId));
    },
    async completeCandidate(input) {
      const complete = async (tx: Executor) => {
        const [rows] = await tx.execute<RowDataPacket[]>("SELECT state FROM standard_datasets WHERE id=? FOR UPDATE", [input.datasetId]);
        if (String(rows[0]?.state) !== "writing") throw new DatasetReleaseError("Only a writing candidate can be completed", "BASELINE_STATE_INVALID");
        for (const entry of input.inspection.manifests) {
          await tx.execute(
            `INSERT INTO standard_dataset_manifests (dataset_id,table_name,row_count,content_hash) VALUES (?,?,?,?)
             ON DUPLICATE KEY UPDATE row_count=VALUES(row_count),content_hash=VALUES(content_hash)`,
            [input.datasetId, entry.tableName, entry.rowCount, entry.contentHash],
          );
        }
        await tx.execute(
          "UPDATE standard_datasets SET state='validated',content_hash=?,error_code=NULL,completed_at=CURRENT_TIMESTAMP(3) WHERE id=? AND state='writing'",
          [input.inspection.contentHash, input.datasetId],
        );
      };
      if (!transactionOwner) return complete(executor);
      const connection = await transactionOwner.getConnection();
      try {
        await connection.beginTransaction();
        await complete(connection);
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    },
    async failCandidate(input) {
      await executor.execute(
        "UPDATE standard_datasets SET state='failed',error_code=?,completed_at=CURRENT_TIMESTAMP(3) WHERE id=? AND state IN ('pending','writing')",
        [input.errorCode, input.datasetId],
      );
    },
  };
}

export function manifestRowsMatchDataset(
  stored: Array<DatasetManifest & { datasetId: string }>,
  datasetId: string,
  actual: DatasetInspection,
  expectedHash: string | null,
): boolean {
  const sorted = stored
    .filter((entry) => entry.datasetId === datasetId)
    .map(({ tableName, rowCount, contentHash }) => ({ tableName, rowCount, contentHash }))
    .sort((left, right) => left.tableName.localeCompare(right.tableName));
  return (expectedHash === null || expectedHash === actual.contentHash)
    && JSON.stringify(sorted) === JSON.stringify(actual.manifests);
}

async function loadValidationBundle(executor: Executor, tmtDatasetId: string, ttmtDatasetId: string): Promise<ReleaseValidationBundle> {
  const [rows] = await executor.execute<RowDataPacket[]>(
    `SELECT t.id AS t_id,t.source AS t_source,t.state AS t_state,t.source_version AS t_source_version,t.content_hash AS t_content_hash,
      t.tmt_sync_run_id AS t_run_id,t.ttmt_import_id AS t_import_id,
      u.id AS u_id,u.source AS u_source,u.state AS u_state,u.source_version AS u_source_version,u.content_hash AS u_content_hash,
      u.tmt_sync_run_id AS u_run_id,u.ttmt_import_id AS u_import_id,
      r.id AS run_id,r.mode AS run_mode,r.status AS run_status,r.error_code AS run_error_code,r.tmt_version,
      v.policy_version,v.status AS validation_status,v.required_checkpoint_count,v.required_succeeded_count,v.optional_failure_count,
      v.blocking_invariant_count,v.invariant_evidence,v.gpu_764169_passed,
      v.ttmt_import_id AS validation_ttmt_import_id,v.ttmt_content_hash,v.ttmt_row_count,v.evidence_sha256,
      i.id AS import_id,i.version AS import_version,i.status AS import_status,i.content_hash AS import_content_hash,i.row_count AS import_row_count
     FROM standard_datasets t
     INNER JOIN standard_datasets u ON u.id=?
     INNER JOIN tmt_sync_runs r ON r.id=t.tmt_sync_run_id
     INNER JOIN tmt_run_validations v ON v.run_id=r.id
     INNER JOIN ttmt_imports i ON i.id=u.ttmt_import_id
     WHERE t.id=? LIMIT 1`,
    [ttmtDatasetId, tmtDatasetId],
  );
  const row = rows[0];
  if (!row) throw new DatasetReleaseError("Release validation source rows are missing", "VALIDATION_SOURCE_MISSING");
  const tmtDataset = datasetRecord({
    id: row.t_id, source: row.t_source, state: row.t_state, source_version: row.t_source_version, content_hash: row.t_content_hash,
    tmt_sync_run_id: row.t_run_id, ttmt_import_id: row.t_import_id,
  } as RowDataPacket);
  const ttmtDataset = datasetRecord({
    id: row.u_id, source: row.u_source, state: row.u_state, source_version: row.u_source_version, content_hash: row.u_content_hash,
    tmt_sync_run_id: row.u_run_id, ttmt_import_id: row.u_import_id,
  } as RowDataPacket);
  const [
    tmtInspection, ttmtInspection, manifestRows, regnoRows, ttmtCountRows, checkpointRows,
    versionedBlockingInvariantCount, gpu764169Passed, foreignVersionRowCount,
  ] = await Promise.all([
    inspectTables(executor, TMT_TABLES, 500, tmtDatasetId),
    inspectTables(executor, TTMT_TABLES, 500, ttmtDatasetId),
    executor.execute<RowDataPacket[]>("SELECT dataset_id,table_name,row_count,content_hash FROM standard_dataset_manifests WHERE dataset_id IN (?,?) ORDER BY dataset_id,table_name", [tmtDatasetId, ttmtDatasetId]).then(([result]) => result),
    latestRegNoConflictCount(executor, tmtDatasetId),
    executor.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS total,SUM(source_import_id<>?) AS foreign_total FROM ttmt_dataset_products WHERE dataset_id=?",
      [String(row.import_id), ttmtDatasetId],
    ).then(([result]) => result),
    executor.execute<RowDataPacket[]>(
      "SELECT endpoint,DATE_FORMAT(window_begin,'%Y-%m-%d') AS window_begin,DATE_FORMAT(window_end,'%Y-%m-%d') AS window_end,status,error_code,received_rows,written_rows FROM tmt_sync_checkpoints WHERE run_id=? ORDER BY endpoint,window_begin,window_end",
      [String(row.run_id)],
    ).then(([result]) => result),
    versionedTmtInvariantCount(executor, tmtDatasetId),
    versionedGpu764169Passed(executor, tmtDatasetId),
    tmtForeignVersionRowCount(executor, tmtDatasetId, tmtDataset.sourceVersion),
  ]);
  const manifests = manifestRows.map((manifest) => ({ tableName: String(manifest.table_name), rowCount: Number(manifest.row_count), contentHash: String(manifest.content_hash), datasetId: String(manifest.dataset_id) }));
  const evidence = parseTmtValidationEvidence(String(row.invariant_evidence));
  const required = new Set<string>(TMT_UNVERIFIED_REQUIRED_ENDPOINTS);
  const currentRequired = checkpointRows.filter((checkpoint) => required.has(String(checkpoint.endpoint)));
  const currentOptional = checkpointRows.filter((checkpoint) => String(checkpoint.endpoint) === "imagelist");
  const currentCheckpoints = canonicalizeTmtValidationCheckpoints(checkpointRows.map((checkpoint) => ({
    endpoint: String(checkpoint.endpoint), status: String(checkpoint.status), errorCode: checkpoint.error_code === null ? null : String(checkpoint.error_code),
    windowBegin: String(checkpoint.window_begin), windowEnd: String(checkpoint.window_end), receivedRows: Number(checkpoint.received_rows), writtenRows: Number(checkpoint.written_rows),
  })));
  return {
    tmtDataset,
    ttmtDataset,
    tmtManifestValid: manifestRowsMatchDataset(manifests, tmtDatasetId, tmtInspection, tmtDataset.contentHash),
    ttmtManifestValid: manifestRowsMatchDataset(manifests, ttmtDatasetId, ttmtInspection, ttmtDataset.contentHash),
    regNoConflictCount: regnoRows,
    versionedBlockingInvariantCount,
    versionedGpu764169Passed: gpu764169Passed,
    tmtForeignVersionRowCount: foreignVersionRowCount,
    checkpointEvidenceMatches: Boolean(evidence) && JSON.stringify(evidence?.checkpoints) === JSON.stringify(currentCheckpoints),
    currentRequiredCheckpointCount: currentRequired.length,
    currentRequiredSucceededCount: currentRequired.filter((checkpoint) => String(checkpoint.status) === "succeeded").length,
    currentOptionalFailureCount: currentOptional.filter((checkpoint) => String(checkpoint.status) === "failed").length,
    disallowedCheckpointCount: checkpointRows.filter((checkpoint) => !required.has(String(checkpoint.endpoint)) && String(checkpoint.endpoint) !== "imagelist").length,
    nonterminalOptionalCheckpointCount: currentOptional.filter((checkpoint) => !["succeeded", "failed"].includes(String(checkpoint.status))).length,
    ttmtDatasetRowCount: Number(ttmtCountRows[0]?.total ?? 0),
    ttmtForeignImportRowCount: Number(ttmtCountRows[0]?.foreign_total ?? 0),
    run: { id: String(row.run_id), mode: String(row.run_mode), status: String(row.run_status), errorCode: row.run_error_code === null ? null : String(row.run_error_code), tmtVersion: String(row.tmt_version) },
    validation: {
      runId: String(row.run_id), policyVersion: String(row.policy_version), status: String(row.validation_status),
      requiredCheckpointCount: Number(row.required_checkpoint_count), requiredSucceededCount: Number(row.required_succeeded_count), optionalFailureCount: Number(row.optional_failure_count),
      blockingInvariantCount: Number(row.blocking_invariant_count),
      gpu764169Passed: Number(row.gpu_764169_passed) === 1, invariantEvidence: String(row.invariant_evidence), evidenceSha256: String(row.evidence_sha256),
      ttmtImportId: String(row.validation_ttmt_import_id), ttmtContentHash: String(row.ttmt_content_hash), ttmtRowCount: Number(row.ttmt_row_count),
    },
    ttmtImport: { id: String(row.import_id), version: String(row.import_version), status: String(row.import_status), contentHash: String(row.import_content_hash), rowCount: Number(row.import_row_count) },
  };
}

function releaseStore(executor: Executor, transactionOwner?: Pool): ReleaseLifecycleStore {
  return {
    async transaction<T>(work: (store: ReleaseLifecycleStore) => Promise<T>): Promise<T> {
      if (!transactionOwner) return work(releaseStore(executor));
      const connection = await transactionOwner.getConnection();
      try {
        await connection.beginTransaction();
        const result = await work(releaseStore(connection));
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    },
    loadValidationBundle(tmtDatasetId, ttmtDatasetId) {
      return loadValidationBundle(executor, tmtDatasetId, ttmtDatasetId);
    },
    async createReleaseCandidate(input) {
      const [existing] = await executor.execute<RowDataPacket[]>("SELECT * FROM standard_releases WHERE id=? OR (tmt_dataset_id=? AND ttmt_dataset_id=?) LIMIT 1", [input.releaseId, input.tmtDatasetId, input.ttmtDatasetId]);
      if (existing[0]) {
        const release = releaseRecord(existing[0]);
        if (release.id === input.releaseId && release.state === "candidate" && release.tmtDatasetId === input.tmtDatasetId
          && release.ttmtDatasetId === input.ttmtDatasetId && release.validationEvidenceSha256 === input.validationEvidenceSha256) return;
        throw new DatasetReleaseError("A different release already exists for this dataset pair", "RELEASE_ALREADY_EXISTS");
      }
      await executor.execute(
        "INSERT INTO standard_releases (id,state,tmt_dataset_id,ttmt_dataset_id,validation_run_id,validation_evidence_sha256) VALUES (?,'candidate',?,?,?,?)",
        [input.releaseId, input.tmtDatasetId, input.ttmtDatasetId, input.validationRunId, input.validationEvidenceSha256],
      );
    },
    async loadRelease(releaseId) {
      const [rows] = await executor.execute<RowDataPacket[]>("SELECT id,state,tmt_dataset_id,ttmt_dataset_id,validation_evidence_sha256,approved_at,superseded_at FROM standard_releases WHERE id=? LIMIT 1", [releaseId]);
      return rows[0] ? releaseRecord(rows[0]) : null;
    },
    async approveRelease(releaseId, approvedAt) {
      const [result] = await executor.execute<ResultSetHeader>("UPDATE standard_releases SET state='approved',approved_at=? WHERE id=? AND state='candidate' AND approved_at IS NULL", [approvedAt, releaseId]);
      if (result.affectedRows !== 1) throw new DatasetReleaseError("Release approval lost its candidate state", "RELEASE_APPROVAL_CONFLICT");
    },
    async lockActivePointer(pointerKey) {
      await executor.execute("INSERT IGNORE INTO standard_dataset_pointers (pointer_key,active_release_id) VALUES (?,NULL)", [pointerKey]);
      const [rows] = await executor.execute<RowDataPacket[]>("SELECT active_release_id FROM standard_dataset_pointers WHERE pointer_key=? FOR UPDATE", [pointerKey]);
      if (!rows[0]) throw new DatasetReleaseError("Active standard release pointer is unavailable", "POINTER_MISSING");
      return rows[0].active_release_id === null ? null : String(rows[0].active_release_id);
    },
    async switchActivePointer(input) {
      if (input.previousReleaseId) await executor.execute("UPDATE standard_releases SET superseded_at=? WHERE id=? AND state='approved'", [input.switchedAt, input.previousReleaseId]);
      await executor.execute("UPDATE standard_releases SET superseded_at=NULL WHERE id=? AND state='approved'", [input.releaseId]);
      const [result] = await executor.execute<ResultSetHeader>("UPDATE standard_dataset_pointers SET active_release_id=?,updated_at=? WHERE pointer_key=?", [input.releaseId, input.switchedAt, input.pointerKey]);
      if (result.affectedRows !== 1) throw new DatasetReleaseError("Active standard release pointer update failed", "POINTER_UPDATE_FAILED");
    },
    async recordAudit(input) {
      await executor.execute(
        "INSERT INTO audit_logs (id,actor_user_id,action,entity_type,entity_id,before_json,after_json) VALUES (?,?,?,?,?,?,?)",
        [randomUUID(), input.actorUserId, input.action, "standard_release", input.releaseId,
          input.beforeReleaseId === undefined ? null : JSON.stringify({ activeReleaseId: input.beforeReleaseId }),
          JSON.stringify({ activeReleaseId: input.afterReleaseId ?? null, assurance: input.assurance ?? null })],
      );
    },
  };
}

export function standardDatasetLifecycleStoresForPool(pool: Pool): { baseline: BaselineStore; releases: ReleaseLifecycleStore } {
  return { baseline: baselineStore(pool, pool), releases: releaseStore(pool, pool) };
}
