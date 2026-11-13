import { createHash } from "node:crypto";
import type { Pool, RowDataPacket } from "mysql2/promise";

export type DatasetSource = "TMT" | "TTMT";
export type CandidateState = "pending" | "writing" | "validated" | "failed";
export type DatasetRow = Record<string, string | number | boolean | null>;

export interface DatasetTableSnapshot {
  tableName: string;
  rows: DatasetRow[];
}

export interface DatasetManifestEntry {
  tableName: string;
  rowCount: number;
  contentHash: string;
}

export interface DatasetCandidateInput {
  id: string;
  source: DatasetSource;
  sourceVersion: string;
  tmtSyncRunId?: string;
  ttmtImportId?: string;
  snapshotKind?: "full" | "incremental-delta";
  activeDatasetId?: string | null;
  tables: DatasetTableSnapshot[];
}

export interface DatasetStagingStore {
  transaction<T>(work: (store: DatasetStagingStore) => Promise<T>): Promise<T>;
  createCandidate(input: Pick<DatasetCandidateInput, "id" | "source" | "sourceVersion" | "tmtSyncRunId" | "ttmtImportId"> & { state: "pending" }): Promise<CandidateState>;
  writeSnapshot(input: { datasetId: string; tables: DatasetTableSnapshot[] }): Promise<void>;
  saveManifest(input: { datasetId: string; entries: DatasetManifestEntry[] }): Promise<void>;
  finishCandidate(input: { datasetId: string; state: Exclude<CandidateState, "pending">; errorCode?: string }): Promise<void>;
}

export class DatasetStagingError extends Error {}

const stagingTables = new Set([
  "tmt_dataset_subs", "tmt_dataset_vtm", "tmt_dataset_gp", "tmt_dataset_gpu", "tmt_dataset_gpp", "tmt_dataset_tp", "tmt_dataset_tpu", "tmt_dataset_tpp",
  "tmt_dataset_nlem", "tmt_dataset_atc", "tmt_dataset_regno", "tmt_dataset_mastertmt", "tmt_dataset_concepts", "tmt_dataset_relationships", "ttmt_dataset_products",
]);

const manifestKeys: Record<string, Array<{ column: string; numeric?: true }>> = {
  tmt_dataset_subs: [{ column: "subsid", numeric: true }],
  tmt_dataset_vtm: [{ column: "vtmid", numeric: true }],
  tmt_dataset_gp: [{ column: "gpid", numeric: true }],
  tmt_dataset_gpu: [{ column: "gpuid", numeric: true }],
  tmt_dataset_gpp: [{ column: "gppid", numeric: true }],
  tmt_dataset_tp: [{ column: "tpid", numeric: true }],
  tmt_dataset_tpu: [{ column: "tpuid", numeric: true }],
  tmt_dataset_tpp: [{ column: "tppid", numeric: true }],
  tmt_dataset_nlem: [{ column: "tpuid", numeric: true }, { column: "change_date" }, { column: "nlem" }],
  tmt_dataset_atc: [{ column: "tpuid", numeric: true }, { column: "change_date" }, { column: "atc" }],
  tmt_dataset_regno: [{ column: "tpuid", numeric: true }, { column: "change_date" }, { column: "regno" }],
  tmt_dataset_mastertmt: [{ column: "tpucode", numeric: true }],
  tmt_dataset_concepts: [{ column: "tmtid", numeric: true }],
  tmt_dataset_relationships: [{ column: "concept1", numeric: true }, { column: "concept2", numeric: true }],
  ttmt_dataset_products: [{ column: "ttmtcode" }],
};
const numericDatasetColumns = new Set(["subsid", "vtmid", "gpid", "gpuid", "gppid", "tpid", "tpuid", "tppid", "tpucode", "tmtid", "concept1", "concept2"]);

type SqlExecutor = Pick<Pool, "execute">;

function canonical(value: unknown): string {
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Buffer.isBuffer(value)) return JSON.stringify(value.toString("hex"));
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function canonicalDatasetRow(row: Record<string, unknown>): string {
  const normalized = Object.fromEntries(Object.entries(row)
    .filter(([key]) => key !== "dataset_id" && key !== "created_at" && key !== "updated_at")
    .map(([key, value]) => {
      if (numericDatasetColumns.has(key) && /^(?:0|[1-9]\d*)$/.test(String(value))) return [key, String(value)];
      if (value instanceof Date) return [key, key === "change_date" ? value.toISOString().slice(0, 10) : value.toISOString()];
      if (typeof value === "string" && key !== "change_date" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/.test(value)) {
        return [key, new Date(`${value.replace(" ", "T")}Z`).toISOString()];
      }
      return [key, value];
    }));
  return canonical(normalized);
}

function compareManifestRows(tableName: string, left: DatasetRow, right: DatasetRow): number {
  const keys = manifestKeys[tableName];
  if (!keys) throw new DatasetStagingError("Unknown staging table");
  for (const key of keys) {
    const leftValue = String(left[key.column] ?? "");
    const rightValue = String(right[key.column] ?? "");
    const order = key.numeric && /^\d+$/.test(leftValue) && /^\d+$/.test(rightValue)
      ? (BigInt(leftValue) < BigInt(rightValue) ? -1 : BigInt(leftValue) > BigInt(rightValue) ? 1 : 0)
      : leftValue.localeCompare(rightValue);
    if (order !== 0) return order;
  }
  return 0;
}

export function manifestFor(tables: DatasetTableSnapshot[]): DatasetManifestEntry[] {
  return tables.map((table) => ({
    tableName: table.tableName,
    rowCount: table.rows.length,
    contentHash: createHash("sha256").update([...table.rows].sort((left, right) => compareManifestRows(table.tableName, left, right)).map(canonicalDatasetRow).join("\n")).digest("hex"),
  })).sort((left, right) => left.tableName.localeCompare(right.tableName));
}

function assertCandidate(input: DatasetCandidateInput): void {
  if (input.snapshotKind === "incremental-delta") throw new DatasetStagingError("A release candidate must be a complete snapshot, not a delta");
  if (input.activeDatasetId === input.id) throw new DatasetStagingError("Active datasets are immutable");
  if ((input.source === "TMT") === !input.tmtSyncRunId || (input.source === "TTMT") === !input.ttmtImportId) {
    throw new DatasetStagingError("Candidate must reference exactly one matching source run or import");
  }
  if (input.tables.length === 0) throw new DatasetStagingError("A candidate requires a complete snapshot");
  if (new Set(input.tables.map((table) => table.tableName)).size !== input.tables.length) throw new DatasetStagingError("Snapshot table names must be unique");
  for (const table of input.tables) {
    if (!stagingTables.has(table.tableName) || (input.source === "TMT" ? !table.tableName.startsWith("tmt_") : table.tableName !== "ttmt_dataset_products")) {
      throw new DatasetStagingError("Snapshot table does not belong to its dataset source");
    }
  }
}

export async function stageDatasetCandidate(input: DatasetCandidateInput, store: DatasetStagingStore): Promise<DatasetManifestEntry[]> {
  assertCandidate(input);
  const manifest = manifestFor(input.tables);
  const existingState = await store.createCandidate({ id: input.id, source: input.source, sourceVersion: input.sourceVersion, tmtSyncRunId: input.tmtSyncRunId, ttmtImportId: input.ttmtImportId, state: "pending" });
  if (existingState === "validated") return manifest;
  try {
    await store.transaction(async (tx) => {
      if (existingState === "pending") await tx.finishCandidate({ datasetId: input.id, state: "writing" });
      await tx.writeSnapshot({ datasetId: input.id, tables: input.tables });
      await tx.saveManifest({ datasetId: input.id, entries: manifest });
      await tx.finishCandidate({ datasetId: input.id, state: "validated" });
    });
  } catch (error) {
    await store.finishCandidate({ datasetId: input.id, state: "failed", errorCode: "STAGING_WRITE_FAILED" });
    throw error;
  }
  return manifest;
}

function writer(executor: SqlExecutor): DatasetStagingStore {
  async function state(datasetId: string): Promise<string> {
    const [rows] = await executor.execute<RowDataPacket[]>("SELECT state FROM standard_datasets WHERE id=? LIMIT 1", [datasetId]);
    if (!rows[0]) throw new DatasetStagingError("Dataset candidate does not exist");
    return rows[0].state;
  }
  async function writing(datasetId: string): Promise<void> {
    if (await state(datasetId) !== "writing") throw new DatasetStagingError("Only a writing candidate can change staging data");
  }
  return {
    async transaction<T>(work: (store: DatasetStagingStore) => Promise<T>): Promise<T> {
      const pool = executor as Pool;
      if (!("getConnection" in pool)) return work(writer(executor));
      const connection = await pool.getConnection();
      try { await connection.beginTransaction(); const result = await work(writer(connection)); await connection.commit(); return result; }
      catch (error) { await connection.rollback(); throw error; }
      finally { connection.release(); }
    },
    async createCandidate(input): Promise<CandidateState> {
      const [rows] = await executor.execute<RowDataPacket[]>("SELECT id,state,source,source_version,tmt_sync_run_id,ttmt_import_id FROM standard_datasets WHERE tmt_sync_run_id=? OR ttmt_import_id=? LIMIT 1", [input.tmtSyncRunId ?? "", input.ttmtImportId ?? ""]);
      const existing = rows[0];
      if (existing) {
        if (existing.id === input.id && (existing.state === "pending" || existing.state === "writing" || existing.state === "validated") && existing.source === input.source && existing.source_version === input.sourceVersion) return existing.state as CandidateState;
        throw new DatasetStagingError(existing.state === "validated" ? "Validated datasets are immutable" : "A candidate already exists for this source run/import");
      }
      await executor.execute("INSERT INTO standard_datasets (id,source,state,source_version,tmt_sync_run_id,ttmt_import_id) VALUES (?,?, 'pending',?,?,?)", [input.id, input.source, input.sourceVersion, input.tmtSyncRunId ?? null, input.ttmtImportId ?? null]);
      return "pending";
    },
    async writeSnapshot(input): Promise<void> {
      await writing(input.datasetId);
      for (const table of input.tables) {
        if (!stagingTables.has(table.tableName)) throw new DatasetStagingError("Unknown staging table");
        if (table.rows.length === 0) continue;
        const columns = Object.keys(table.rows[0] ?? {}).sort();
        if (columns.length === 0 || columns.some((column) => !/^[a-z_]+$/.test(column) || column === "dataset_id")) throw new DatasetStagingError("Invalid snapshot columns");
        if (table.rows.some((row) => columns.some((column) => !(column in row)) || Object.keys(row).some((column) => !columns.includes(column)))) throw new DatasetStagingError("Snapshot rows must share one shape");
        const names = ["dataset_id", ...columns];
        const placeholders = input.tables.length ? table.rows.map(() => `(${names.map(() => "?").join(",")})`).join(",") : "";
        const updates = columns.map((column) => `\`${column}\`=VALUES(\`${column}\`)`).join(",");
        await executor.execute(`INSERT INTO \`${table.tableName}\` (${names.map((name) => `\`${name}\``).join(",")}) VALUES ${placeholders} ON DUPLICATE KEY UPDATE ${updates}`, table.rows.flatMap((row) => [input.datasetId, ...columns.map((column) => row[column]) ]));
      }
    },
    async saveManifest(input): Promise<void> {
      await writing(input.datasetId);
      for (const entry of input.entries) await executor.execute(
        "INSERT INTO standard_dataset_manifests (dataset_id,table_name,row_count,content_hash) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE row_count=VALUES(row_count),content_hash=VALUES(content_hash)",
        [input.datasetId, entry.tableName, entry.rowCount, entry.contentHash],
      );
    },
    async finishCandidate(input): Promise<void> {
      const current = await state(input.datasetId);
      const allowed = (input.state === "writing" && current === "pending") || (input.state === "validated" && current === "writing") || (input.state === "failed" && (current === "pending" || current === "writing"));
      if (!allowed) throw new DatasetStagingError("Invalid dataset lifecycle transition");
      await executor.execute("UPDATE standard_datasets SET state=?,error_code=?,completed_at=IF(?='writing',NULL,CURRENT_TIMESTAMP(3)) WHERE id=?", [input.state, input.errorCode ?? null, input.state, input.datasetId]);
    },
  };
}

export function datasetStagingStoreForPool(pool: Pool): DatasetStagingStore {
  return writer(pool);
}
