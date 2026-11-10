import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { normalizeRegistrationNumber, normalizeSearchText } from "@/modules/standards/normalize";
import type {
  AtcRecord,
  ConceptRecord,
  GpRecord,
  GppRecord,
  GpuRecord,
  ImageListRecord,
  MasterTmtRecord,
  NlemRecord,
  RegnoRecord,
  RelationshipRecord,
  SubsRecord,
  TpRecord,
  TppRecord,
  TpuRecord,
  VtmRecord,
} from "@/modules/standards/tmt-parsers";
import type { TmtDateWindow } from "./windows";

export const TMT_WRITE_CHUNK = 500;

export type TmtRunMode = "full" | "incremental" | "full_unverified";
export type TmtRunStatus = "succeeded" | "failed" | "stale" | "unverified";

export type TmtDataEndpoint =
  | "subs" | "vtm" | "gp" | "gpu" | "gpp" | "tp" | "tpu" | "tpp"
  | "nlem" | "atc" | "regno" | "mastertmt" | "concept" | "relationship" | "imagelist";

export interface TmtEndpointRows {
  subs: SubsRecord[];
  vtm: VtmRecord[];
  gp: GpRecord[];
  gpu: GpuRecord[];
  gpp: GppRecord[];
  tp: TpRecord[];
  tpu: TpuRecord[];
  tpp: TppRecord[];
  nlem: NlemRecord[];
  atc: AtcRecord[];
  regno: RegnoRecord[];
  mastertmt: MasterTmtRecord[];
  concept: ConceptRecord[];
  relationship: RelationshipRecord[];
  imagelist: ImageListRecord[];
}

export interface TmtDataWarning {
  code: "SAME_DATE_CONFLICT" | "SAME_DATE_MULTI_VALUE" | "DUPLICATE_CONFLICT";
  endpoint: TmtDataEndpoint;
  key: string;
}

export interface PersistWindowResult {
  receivedRows: number;
  uniqueRows: number;
  writtenRows: number;
  duplicateRows: number;
  warnings: TmtDataWarning[];
}

export interface TmtRunRow {
  id: string;
  tmtVersion: string;
  mode: TmtRunMode;
  status: string;
  startedAt: Date;
}

export type PersistWindowInput<E extends TmtDataEndpoint> = {
  runId: string;
  endpoint: E;
  window: TmtDateWindow;
  version: string;
  syncedAt: Date;
  rows: TmtEndpointRows[E];
  attempts?: number;
};

export interface TmtCheckpointRow {
  runId: string;
  endpoint: TmtDataEndpoint;
  window: TmtDateWindow;
  status: string;
}

export interface LatestTmtTemporalValue {
  changeDate: string;
  values: string[];
  conflict: boolean;
}

interface LevelDefinition {
  table: string;
  idColumn: string;
  idProperty: "subsid" | "vtmid" | "gpid" | "gpuid" | "gppid" | "tpid" | "tpuid" | "tppid";
  manufacturer: boolean;
}

type LevelRow = { fsn: string; manufacturer?: string; changeDate: string } & Partial<Record<LevelDefinition["idProperty"], string>>;

const levelDefinitions: Record<"subs" | "vtm" | "gp" | "gpu" | "gpp" | "tp" | "tpu" | "tpp", LevelDefinition> = {
  subs: { table: "tmt_subs", idColumn: "subsid", idProperty: "subsid", manufacturer: false },
  vtm: { table: "tmt_vtm", idColumn: "vtmid", idProperty: "vtmid", manufacturer: false },
  gp: { table: "tmt_gp", idColumn: "gpid", idProperty: "gpid", manufacturer: false },
  gpu: { table: "tmt_gpu", idColumn: "gpuid", idProperty: "gpuid", manufacturer: false },
  gpp: { table: "tmt_gpp", idColumn: "gppid", idProperty: "gppid", manufacturer: false },
  tp: { table: "tmt_tp", idColumn: "tpid", idProperty: "tpid", manufacturer: true },
  tpu: { table: "tmt_tpu", idColumn: "tpuid", idProperty: "tpuid", manufacturer: true },
  tpp: { table: "tmt_tpp", idColumn: "tppid", idProperty: "tppid", manufacturer: true },
};

function chunks<T>(rows: T[], size = TMT_WRITE_CHUNK): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < rows.length; index += size) result.push(rows.slice(index, index + size));
  return result;
}

function stable(value: unknown): string {
  return JSON.stringify(value, Object.keys(value as Record<string, unknown>).sort());
}

function deduplicate<T>(
  rows: T[],
  keyOf: (row: T) => string,
  endpoint: TmtDataEndpoint,
  compare?: (left: T, right: T) => number,
): { rows: T[]; duplicates: number; warnings: TmtDataWarning[] } {
  const selected = new Map<string, T>();
  const warnings: TmtDataWarning[] = [];
  let duplicates = 0;
  for (const row of rows) {
    const key = keyOf(row);
    const current = selected.get(key);
    if (!current) {
      selected.set(key, row);
      continue;
    }
    duplicates += 1;
    if (stable(current) === stable(row)) continue;
    warnings.push({ code: "DUPLICATE_CONFLICT", endpoint, key });
    const winner = compare ? (compare(current, row) >= 0 ? current : row) : (stable(current) <= stable(row) ? current : row);
    selected.set(key, winner);
  }
  return { rows: [...selected.values()], duplicates, warnings };
}

async function executeInsert(
  connection: PoolConnection,
  table: string,
  columns: string[],
  values: unknown[][],
  suffix: string,
): Promise<number> {
  if (values.length === 0) return 0;
  const placeholders = values.map(() => `(${columns.map(() => "?").join(",")})`).join(",");
  const [result] = await connection.query<ResultSetHeader>(
    `INSERT INTO ${table} (${columns.join(",")}) VALUES ${placeholders} ${suffix}`,
    values.flat(),
  );
  return result.affectedRows;
}

async function existingByIds(connection: PoolConnection, table: string, idColumn: string, ids: string[], columns: string): Promise<Map<string, RowDataPacket>> {
  if (ids.length === 0) return new Map();
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT ${idColumn}, ${columns} FROM ${table} WHERE ${idColumn} IN (${ids.map(() => "?").join(",")})`,
    ids,
  );
  return new Map(rows.map((row) => [String(row[idColumn]), row]));
}

function differentNullable(left: unknown, right: unknown): boolean {
  return (left ?? null) !== (right ?? null);
}

function databaseDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

export class TmtSyncRepository {
  constructor(private readonly pool: Pool) {}

  async createRun(input: { id: string; version: string; mode: TmtRunMode; startedAt: Date; startedBy?: string | null }): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [lock] = await connection.query<RowDataPacket[]>(
        "SELECT filename FROM schema_migrations WHERE filename='0014_tmt_data_model_v2.sql' FOR UPDATE",
      );
      if (!lock[0]) throw new Error("TMT v2 migration lock row is missing");
      if (input.mode !== "full_unverified") {
        const [unverified] = await connection.query<RowDataPacket[]>(
          "SELECT id FROM tmt_sync_runs WHERE mode='full_unverified' LIMIT 1",
        );
        if (unverified[0]) throw new Error("An unverified run exists; an approved reset is required before another TMT sync");
      }
      if (input.mode === "full_unverified") {
        const tables = [
          "tmt_sync_checkpoints", "tmt_version", "tmt_relationship", "tmt_concept", "tmt_mastertmt", "tmt_regno",
          "tmt_atc", "tmt_nlem", "tmt_tpp", "tmt_tpu", "tmt_tp", "tmt_gpp", "tmt_gpu", "tmt_gp", "tmt_vtm",
          "tmt_subs", "tmt_sync_runs",
        ] as const;
        const nonEmpty: string[] = [];
        for (const table of tables) {
          const [[row]] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM \`${table}\``);
          if (Number(row?.total ?? 0) !== 0) nonEmpty.push(table);
        }
        if (nonEmpty.length > 0) throw new Error(`TMT v2 target must be empty before an unverified full sync: ${nonEmpty.join(", ")}`);
      }
      await connection.execute(
        "INSERT INTO tmt_sync_runs (id,tmt_version,mode,status,started_by,started_at) VALUES (?,?,?,'running',?,?)",
        [input.id, input.version, input.mode, input.startedBy ?? null, input.startedAt],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async observeVersion(input: { id: string; version: string; observedAt: Date; runId: string; latencyMs?: number | null }): Promise<void> {
    await this.pool.execute(
      "INSERT INTO tmt_version (id,tmt_version,observed_at,http_latency_ms,core_sync_run_id) VALUES (?,?,?,?,?)",
      [input.id, input.version, input.observedAt, input.latencyMs ?? null, input.runId],
    );
  }

  async ensureCheckpoint(input: { runId: string; endpoint: TmtDataEndpoint; window: TmtDateWindow }): Promise<void> {
    await this.pool.execute(
      `INSERT INTO tmt_sync_checkpoints (run_id,endpoint,window_begin,window_end,status)
       VALUES (?,?,?,?,'pending') ON DUPLICATE KEY UPDATE run_id=VALUES(run_id)`,
      [input.runId, input.endpoint, input.window.begindate, input.window.enddate],
    );
  }

  async persistWindow<E extends TmtDataEndpoint>(input: PersistWindowInput<E>): Promise<PersistWindowResult> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await this.persistRows(connection, input);
      await connection.execute(
        `UPDATE tmt_sync_checkpoints SET status='succeeded',received_rows=?,written_rows=?,attempt_count=attempt_count+?,
         error_code=NULL,started_at=COALESCE(started_at,?),finished_at=?,updated_at=?
         WHERE run_id=? AND endpoint=? AND window_begin=? AND window_end=?`,
        [result.receivedRows, result.writtenRows, input.attempts ?? 1, input.syncedAt, input.syncedAt, input.syncedAt, input.runId, input.endpoint, input.window.begindate, input.window.enddate],
      );
      const [checkpoint] = await connection.query<RowDataPacket[]>(
        "SELECT status FROM tmt_sync_checkpoints WHERE run_id=? AND endpoint=? AND window_begin=? AND window_end=? FOR UPDATE",
        [input.runId, input.endpoint, input.window.begindate, input.window.enddate],
      );
      if (!checkpoint[0]) throw new Error("TMT sync checkpoint does not exist");
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async failCheckpoint(input: { runId: string; endpoint: TmtDataEndpoint; window: TmtDateWindow; attempts: number; errorCode: string; finishedAt: Date }): Promise<void> {
    await this.pool.execute(
      `UPDATE tmt_sync_checkpoints SET status='failed',attempt_count=attempt_count+?,error_code=?,
       started_at=COALESCE(started_at,?),finished_at=?,updated_at=?
       WHERE run_id=? AND endpoint=? AND window_begin=? AND window_end=?`,
      [input.attempts, input.errorCode.slice(0, 64), input.finishedAt, input.finishedAt, input.finishedAt, input.runId, input.endpoint, input.window.begindate, input.window.enddate],
    );
  }

  async finishRun(input: { runId: string; status: TmtRunStatus; receivedRows: number; writtenRows: number; warningsCount: number; errorCode: string | null; finishedAt: Date }): Promise<void> {
    await this.pool.execute(
      "UPDATE tmt_sync_runs SET status=?,received_rows=?,written_rows=?,warnings_count=?,error_code=?,finished_at=? WHERE id=?",
      [input.status, input.receivedRows, input.writtenRows, input.warningsCount, input.errorCode, input.finishedAt, input.runId],
    );
  }

  async latestSuccessfulEnd(endpoint: TmtDataEndpoint): Promise<string | null> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      "SELECT MAX(window_end) AS latest FROM tmt_sync_checkpoints WHERE endpoint=? AND status='succeeded'",
      [endpoint],
    );
    return rows[0]?.latest ? databaseDate(rows[0].latest) : null;
  }

  async loadRun(runId: string): Promise<TmtRunRow> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      "SELECT id,tmt_version,mode,status,started_at FROM tmt_sync_runs WHERE id=? LIMIT 1",
      [runId],
    );
    const row = rows[0];
    if (!row) throw new Error("TMT sync run not found");
    if (row.mode !== "full" && row.mode !== "incremental" && row.mode !== "full_unverified") throw new Error("TMT sync run mode is invalid");
    return { id: row.id, tmtVersion: row.tmt_version, mode: row.mode, status: row.status, startedAt: row.started_at };
  }

  async incompleteCheckpoints(runId: string): Promise<TmtCheckpointRow[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      "SELECT run_id,endpoint,window_begin,window_end,status FROM tmt_sync_checkpoints WHERE run_id=? AND status<>'succeeded' ORDER BY endpoint,window_begin",
      [runId],
    );
    return rows.map((row) => ({
      runId: row.run_id,
      endpoint: row.endpoint,
      window: { begindate: databaseDate(row.window_begin), enddate: databaseDate(row.window_end) },
      status: row.status,
    }));
  }

  latestNlem(tpuid: string): Promise<LatestTmtTemporalValue | null> {
    return this.latestTemporal("tmt_nlem", "nlem", tpuid);
  }

  latestAtc(tpuid: string): Promise<LatestTmtTemporalValue | null> {
    return this.latestTemporal("tmt_atc", "atc", tpuid);
  }

  latestRegno(tpuid: string): Promise<LatestTmtTemporalValue | null> {
    return this.latestTemporal("tmt_regno", "regno", tpuid);
  }

  private async latestTemporal(table: "tmt_nlem" | "tmt_atc" | "tmt_regno", column: "nlem" | "atc" | "regno", tpuid: string): Promise<LatestTmtTemporalValue | null> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT change_date,${column} AS value FROM ${table}
       WHERE tpuid=? AND change_date=(SELECT MAX(change_date) FROM ${table} WHERE tpuid=?)
       ORDER BY ${column}`,
      [tpuid, tpuid],
    );
    if (rows.length === 0) return null;
    const values = [...new Set(rows.map((row) => String(row.value)))];
    return { changeDate: databaseDate(rows[0]?.change_date), values, conflict: values.length > 1 };
  }

  private async persistRows<E extends TmtDataEndpoint>(connection: PoolConnection, input: PersistWindowInput<E>): Promise<PersistWindowResult> {
    if (input.endpoint in levelDefinitions) {
      return this.persistLevel(connection, input.endpoint as keyof typeof levelDefinitions, input.rows as TmtEndpointRows[keyof typeof levelDefinitions], input.version, input.syncedAt);
    }
    switch (input.endpoint) {
      case "concept": return this.persistConcept(connection, input.rows as ConceptRecord[], input.version, input.syncedAt);
      case "relationship": return this.persistRelationship(connection, input.rows as RelationshipRecord[], input.version, input.syncedAt);
      case "mastertmt": return this.persistMaster(connection, input.rows as MasterTmtRecord[], input.version, input.syncedAt);
      case "nlem": return this.persistTemporal(connection, "nlem", input.rows as NlemRecord[], input.version, input.syncedAt);
      case "atc": return this.persistTemporal(connection, "atc", input.rows as AtcRecord[], input.version, input.syncedAt);
      case "regno": return this.persistTemporal(connection, "regno", input.rows as RegnoRecord[], input.version, input.syncedAt);
      case "imagelist": {
        const rows = input.rows as ImageListRecord[];
        const unique = deduplicate(rows, (row) => row.tpuid, "imagelist", (left, right) => left.changeDate.localeCompare(right.changeDate));
        return { receivedRows: rows.length, uniqueRows: unique.rows.length, writtenRows: 0, duplicateRows: unique.duplicates, warnings: unique.warnings };
      }
    }
    throw new Error(`Unsupported TMT endpoint: ${String(input.endpoint)}`);
  }

  private async persistLevel(
    connection: PoolConnection,
    endpoint: keyof typeof levelDefinitions,
    sourceRows: TmtEndpointRows[keyof typeof levelDefinitions],
    version: string,
    syncedAt: Date,
  ): Promise<PersistWindowResult> {
    const definition = levelDefinitions[endpoint];
    const rows = sourceRows as unknown as LevelRow[];
    const idOf = (row: LevelRow): string => {
      const id = row[definition.idProperty];
      if (!id) throw new Error(`Missing ${definition.idProperty}`);
      return id;
    };
    const unique = deduplicate(rows, idOf, endpoint, (left, right) => {
      const dateOrder = left.changeDate.localeCompare(right.changeDate);
      return dateOrder === 0 ? stable(right).localeCompare(stable(left)) : dateOrder;
    });
    let writtenRows = 0;
    for (const chunk of chunks(unique.rows)) {
      const ids = chunk.map(idOf);
      const existing = await existingByIds(connection, definition.table, definition.idColumn, ids, `fsn,change_date${definition.manufacturer ? ",manufacturer" : ""}`);
      for (const row of chunk) {
        const previous = existing.get(idOf(row));
        if (!previous) writtenRows += 1;
        else if (row.changeDate > databaseDate(previous.change_date)) writtenRows += 1;
        else if (row.changeDate === databaseDate(previous.change_date) && (row.fsn !== previous.fsn || (definition.manufacturer && row.manufacturer !== previous.manufacturer))) {
          unique.warnings.push({ code: "SAME_DATE_CONFLICT", endpoint, key: idOf(row) });
        }
      }
      const columns = [definition.idColumn, "fsn", ...(definition.manufacturer ? ["manufacturer"] : []), "change_date", "normalized_fsn", ...(definition.manufacturer ? ["normalized_manufacturer"] : []), "source_version", "last_seen_version", "synced_at"];
      const values = chunk.map((row) => [
        idOf(row), row.fsn, ...(definition.manufacturer ? [row.manufacturer] : []), row.changeDate,
        normalizeSearchText(row.fsn), ...(definition.manufacturer ? [normalizeSearchText(row.manufacturer)] : []), version, version, syncedAt,
      ]);
      const sourceUpdates = ["fsn", ...(definition.manufacturer ? ["manufacturer"] : []), "normalized_fsn", ...(definition.manufacturer ? ["normalized_manufacturer"] : []), "source_version"]
        .map((column) => `${column}=IF(VALUES(change_date)>change_date,VALUES(${column}),${column})`);
      await executeInsert(connection, definition.table, columns, values,
        `ON DUPLICATE KEY UPDATE ${sourceUpdates.join(",")},updated_at=IF(VALUES(change_date)>change_date,CURRENT_TIMESTAMP(3),updated_at),change_date=GREATEST(change_date,VALUES(change_date)),last_seen_version=VALUES(last_seen_version),synced_at=VALUES(synced_at)`);
    }
    return { receivedRows: rows.length, uniqueRows: unique.rows.length, writtenRows, duplicateRows: unique.duplicates, warnings: unique.warnings };
  }

  private async persistConcept(connection: PoolConnection, rows: ConceptRecord[], version: string, syncedAt: Date): Promise<PersistWindowResult> {
    const unique = deduplicate(rows, (row) => row.tmtid, "concept", (left, right) => left.changeDate.localeCompare(right.changeDate));
    let writtenRows = 0;
    for (const chunk of chunks(unique.rows)) {
      const existing = await existingByIds(connection, "tmt_concept", "tmtid", chunk.map((row) => row.tmtid), "fsn,change_date,level_name");
      for (const row of chunk) {
        const previous = existing.get(row.tmtid);
        if (!previous || row.changeDate > databaseDate(previous.change_date)) writtenRows += 1;
        else if (row.changeDate === databaseDate(previous.change_date) && (row.fsn !== previous.fsn || row.levelName !== previous.level_name)) unique.warnings.push({ code: "SAME_DATE_CONFLICT", endpoint: "concept", key: row.tmtid });
      }
      await executeInsert(connection, "tmt_concept", ["tmtid","fsn","change_date","level_name","normalized_fsn","source_version","last_seen_version","synced_at"], chunk.map((row) => [row.tmtid,row.fsn,row.changeDate,row.levelName,normalizeSearchText(row.fsn),version,version,syncedAt]),
        "ON DUPLICATE KEY UPDATE fsn=IF(VALUES(change_date)>change_date,VALUES(fsn),fsn),level_name=IF(VALUES(change_date)>change_date,VALUES(level_name),level_name),normalized_fsn=IF(VALUES(change_date)>change_date,VALUES(normalized_fsn),normalized_fsn),source_version=IF(VALUES(change_date)>change_date,VALUES(source_version),source_version),updated_at=IF(VALUES(change_date)>change_date,CURRENT_TIMESTAMP(3),updated_at),change_date=GREATEST(change_date,VALUES(change_date)),last_seen_version=VALUES(last_seen_version),synced_at=VALUES(synced_at)");
    }
    return { receivedRows: rows.length, uniqueRows: unique.rows.length, writtenRows, duplicateRows: unique.duplicates, warnings: unique.warnings };
  }

  private async persistRelationship(connection: PoolConnection, rows: RelationshipRecord[], version: string, syncedAt: Date): Promise<PersistWindowResult> {
    const unique = deduplicate(rows, (row) => `${row.concept1}:${row.concept2}`, "relationship", (left, right) => left.changeDate.localeCompare(right.changeDate));
    let writtenRows = 0;
    for (const chunk of chunks(unique.rows)) {
      const tuplePlaceholders = chunk.map(() => "(?,?)").join(",");
      const [existingRows] = await connection.query<RowDataPacket[]>(
        `SELECT concept1,concept2,change_date,level_name1,level_name2 FROM tmt_relationship
         WHERE (concept1,concept2) IN (${tuplePlaceholders})`,
        chunk.flatMap((row) => [row.concept1, row.concept2]),
      );
      const existingByKey = new Map(existingRows.map((row) => [`${row.concept1}:${row.concept2}`, row]));
      for (const row of chunk) {
        const previous = existingByKey.get(`${row.concept1}:${row.concept2}`);
        if (!previous || row.changeDate > databaseDate(previous.change_date)) writtenRows += 1;
        else if (row.changeDate === databaseDate(previous.change_date) && (row.levelName1 !== previous.level_name1 || row.levelName2 !== previous.level_name2)) unique.warnings.push({ code: "SAME_DATE_CONFLICT", endpoint: "relationship", key: `${row.concept1}:${row.concept2}` });
      }
      await executeInsert(connection, "tmt_relationship", ["concept1","concept2","change_date","level_name1","level_name2","source_version","last_seen_version","synced_at"], chunk.map((row) => [row.concept1,row.concept2,row.changeDate,row.levelName1,row.levelName2,version,version,syncedAt]),
        "ON DUPLICATE KEY UPDATE level_name1=IF(VALUES(change_date)>change_date,VALUES(level_name1),level_name1),level_name2=IF(VALUES(change_date)>change_date,VALUES(level_name2),level_name2),source_version=IF(VALUES(change_date)>change_date,VALUES(source_version),source_version),updated_at=IF(VALUES(change_date)>change_date,CURRENT_TIMESTAMP(3),updated_at),change_date=GREATEST(change_date,VALUES(change_date)),last_seen_version=VALUES(last_seen_version),synced_at=VALUES(synced_at)");
    }
    return { receivedRows: rows.length, uniqueRows: unique.rows.length, writtenRows, duplicateRows: unique.duplicates, warnings: unique.warnings };
  }

  private async persistMaster(connection: PoolConnection, rows: MasterTmtRecord[], version: string, syncedAt: Date): Promise<PersistWindowResult> {
    const unique = deduplicate(rows, (row) => row.tpucode, "mastertmt");
    let writtenRows = 0;
    const fields = ["activeingredient","strength","dosageform","contvalue","contunit","dispunit","tradename","manufacturer","fsn","status"] as const;
    for (const chunk of chunks(unique.rows)) {
      const existing = await existingByIds(connection, "tmt_mastertmt", "tpucode", chunk.map((row) => row.tpucode), fields.join(","));
      const changed = chunk.filter((row) => {
        const previous = existing.get(row.tpucode);
        if (!previous) return true;
        return fields.some((field) => differentNullable(row[field], previous[field]));
      });
      writtenRows += changed.length;
      if (changed.length > 0) {
        const columns = ["tpucode",...fields,"normalized_generic","normalized_trade","normalized_manufacturer","normalized_fsn","source_version","last_seen_version","synced_at"];
        const values = changed.map((row) => [row.tpucode,...fields.map((field) => row[field]),normalizeSearchText(row.activeingredient),normalizeSearchText(row.tradename),normalizeSearchText(row.manufacturer),normalizeSearchText(row.fsn),version,version,syncedAt]);
        await executeInsert(connection, "tmt_mastertmt", columns, values,
          `ON DUPLICATE KEY UPDATE ${[...fields,"normalized_generic","normalized_trade","normalized_manufacturer","normalized_fsn","source_version"].map((field) => `${field}=VALUES(${field})`).join(",")},last_seen_version=VALUES(last_seen_version),synced_at=VALUES(synced_at),updated_at=CURRENT_TIMESTAMP(3)`);
      }
      const ids = chunk.map((row) => row.tpucode);
      await connection.query(`UPDATE tmt_mastertmt SET last_seen_version=?,synced_at=? WHERE tpucode IN (${ids.map(() => "?").join(",")})`, [version,syncedAt,...ids]);
    }
    return { receivedRows: rows.length, uniqueRows: unique.rows.length, writtenRows, duplicateRows: unique.duplicates, warnings: unique.warnings };
  }

  private async persistTemporal(
    connection: PoolConnection,
    endpoint: "nlem" | "atc" | "regno",
    rows: NlemRecord[] | AtcRecord[] | RegnoRecord[],
    version: string,
    syncedAt: Date,
  ): Promise<PersistWindowResult> {
    const valueColumn = endpoint;
    const table = `tmt_${endpoint}`;
    const normalizedRows = rows.map((row) => ({
      tpuid: row.tpuid,
      fsn: row.fsn,
      changeDate: row.changeDate,
      value: endpoint === "nlem" ? (row as NlemRecord).nlem : endpoint === "atc" ? (row as AtcRecord).atc : (row as RegnoRecord).regno,
    }));
    const unique = deduplicate(normalizedRows, (row) => `${row.tpuid}:${row.changeDate}:${row.value}`, endpoint);
    const grouped = new Map<string, Set<string>>();
    for (const row of unique.rows) {
      const key = `${row.tpuid}:${row.changeDate}`;
      const values = grouped.get(key) ?? new Set<string>();
      values.add(row.value);
      grouped.set(key, values);
    }
    for (const [key, values] of grouped) if (values.size > 1) unique.warnings.push({ code: "SAME_DATE_MULTI_VALUE", endpoint, key });
    let writtenRows = 0;
    for (const chunk of chunks(unique.rows)) {
      const tuplePlaceholders = chunk.map(() => "(?,?,?)").join(",");
      const [existing] = await connection.query<RowDataPacket[]>(
        `SELECT tpuid,change_date,${valueColumn} AS value FROM ${table} WHERE (tpuid,change_date,${valueColumn}) IN (${tuplePlaceholders})`,
        chunk.flatMap((row) => [row.tpuid, row.changeDate, row.value]),
      );
      const existingKeys = new Set(existing.map((row) => `${row.tpuid}:${databaseDate(row.change_date)}:${row.value}`));
      writtenRows += chunk.filter((row) => !existingKeys.has(`${row.tpuid}:${row.changeDate}:${row.value}`)).length;
      const columns = ["tpuid","fsn",valueColumn,...(endpoint === "regno" ? ["normalized_regno"] : []),"change_date","source_version","synced_at"];
      const values = chunk.map((row) => [row.tpuid,row.fsn,row.value,...(endpoint === "regno" ? [normalizeRegistrationNumber(row.value) ?? ""] : []),row.changeDate,version,syncedAt]);
      await executeInsert(connection, table, columns, values, "ON DUPLICATE KEY UPDATE tpuid=VALUES(tpuid)");
    }
    return { receivedRows: normalizedRows.length, uniqueRows: unique.rows.length, writtenRows, duplicateRows: unique.duplicates, warnings: unique.warnings };
  }
}
