import { sql } from "drizzle-orm";
import { bigint, date, datetime, index, int, mysqlTable, primaryKey, text, tinyint, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

const now = sql`CURRENT_TIMESTAMP(3)`;
const tmtId = (name: string) => bigint(name, { mode: "bigint", unsigned: true });

export const tmtSubs = mysqlTable(
  "tmt_subs",
  {
    subsid: tmtId("subsid").primaryKey(),
    fsn: text("fsn").notNull(),
    changeDate: date("change_date", { mode: "string" }).notNull(),
    normalizedFsn: varchar("normalized_fsn", { length: 255 }),
    sourceVersion: varchar("source_version", { length: 32 }).notNull(),
    lastSeenVersion: varchar("last_seen_version", { length: 32 }).notNull(),
    syncedAt: datetime("synced_at", { mode: "date", fsp: 3 }).notNull(),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(now),
    updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).notNull().default(now),
  },
  (table) => [index("idx_tmt_subs_change").on(table.changeDate, table.subsid), index("idx_tmt_subs_fsn").on(table.normalizedFsn)],
);

export const tmtVtm = mysqlTable(
  "tmt_vtm",
  {
    vtmid: tmtId("vtmid").primaryKey(),
    fsn: text("fsn").notNull(),
    changeDate: date("change_date", { mode: "string" }).notNull(),
    normalizedFsn: varchar("normalized_fsn", { length: 255 }),
    sourceVersion: varchar("source_version", { length: 32 }).notNull(),
    lastSeenVersion: varchar("last_seen_version", { length: 32 }).notNull(),
    syncedAt: datetime("synced_at", { mode: "date", fsp: 3 }).notNull(),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(now),
    updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).notNull().default(now),
  },
  (table) => [index("idx_tmt_vtm_change").on(table.changeDate, table.vtmid), index("idx_tmt_vtm_fsn").on(table.normalizedFsn)],
);

export const tmtGp = mysqlTable(
  "tmt_gp",
  {
    gpid: tmtId("gpid").primaryKey(),
    fsn: text("fsn").notNull(),
    changeDate: date("change_date", { mode: "string" }).notNull(),
    normalizedFsn: varchar("normalized_fsn", { length: 255 }),
    sourceVersion: varchar("source_version", { length: 32 }).notNull(),
    lastSeenVersion: varchar("last_seen_version", { length: 32 }).notNull(),
    syncedAt: datetime("synced_at", { mode: "date", fsp: 3 }).notNull(),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(now),
    updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).notNull().default(now),
  },
  (table) => [index("idx_tmt_gp_change").on(table.changeDate, table.gpid), index("idx_tmt_gp_fsn").on(table.normalizedFsn)],
);

export const tmtGpu = mysqlTable(
  "tmt_gpu",
  {
    gpuid: tmtId("gpuid").primaryKey(),
    fsn: text("fsn").notNull(),
    changeDate: date("change_date", { mode: "string" }).notNull(),
    normalizedFsn: varchar("normalized_fsn", { length: 255 }),
    sourceVersion: varchar("source_version", { length: 32 }).notNull(),
    lastSeenVersion: varchar("last_seen_version", { length: 32 }).notNull(),
    syncedAt: datetime("synced_at", { mode: "date", fsp: 3 }).notNull(),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(now),
    updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).notNull().default(now),
  },
  (table) => [index("idx_tmt_gpu_change").on(table.changeDate, table.gpuid), index("idx_tmt_gpu_fsn").on(table.normalizedFsn)],
);

export const tmtGpp = mysqlTable(
  "tmt_gpp",
  {
    gppid: tmtId("gppid").primaryKey(),
    fsn: text("fsn").notNull(),
    changeDate: date("change_date", { mode: "string" }).notNull(),
    normalizedFsn: varchar("normalized_fsn", { length: 255 }),
    sourceVersion: varchar("source_version", { length: 32 }).notNull(),
    lastSeenVersion: varchar("last_seen_version", { length: 32 }).notNull(),
    syncedAt: datetime("synced_at", { mode: "date", fsp: 3 }).notNull(),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(now),
    updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).notNull().default(now),
  },
  (table) => [index("idx_tmt_gpp_change").on(table.changeDate, table.gppid), index("idx_tmt_gpp_fsn").on(table.normalizedFsn)],
);

export const tmtTp = mysqlTable(
  "tmt_tp",
  {
    tpid: tmtId("tpid").primaryKey(),
    fsn: text("fsn").notNull(),
    manufacturer: text("manufacturer").notNull(),
    changeDate: date("change_date", { mode: "string" }).notNull(),
    normalizedFsn: varchar("normalized_fsn", { length: 255 }),
    normalizedManufacturer: varchar("normalized_manufacturer", { length: 255 }),
    sourceVersion: varchar("source_version", { length: 32 }).notNull(),
    lastSeenVersion: varchar("last_seen_version", { length: 32 }).notNull(),
    syncedAt: datetime("synced_at", { mode: "date", fsp: 3 }).notNull(),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(now),
    updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).notNull().default(now),
  },
  (table) => [
    index("idx_tmt_tp_change").on(table.changeDate, table.tpid),
    index("idx_tmt_tp_fsn").on(table.normalizedFsn),
    index("idx_tmt_tp_manufacturer").on(table.normalizedManufacturer),
  ],
);

export const tmtTpu = mysqlTable(
  "tmt_tpu",
  {
    tpuid: tmtId("tpuid").primaryKey(),
    fsn: text("fsn").notNull(),
    manufacturer: text("manufacturer").notNull(),
    changeDate: date("change_date", { mode: "string" }).notNull(),
    normalizedFsn: varchar("normalized_fsn", { length: 255 }),
    normalizedManufacturer: varchar("normalized_manufacturer", { length: 255 }),
    sourceVersion: varchar("source_version", { length: 32 }).notNull(),
    lastSeenVersion: varchar("last_seen_version", { length: 32 }).notNull(),
    syncedAt: datetime("synced_at", { mode: "date", fsp: 3 }).notNull(),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(now),
    updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).notNull().default(now),
  },
  (table) => [
    index("idx_tmt_tpu_change").on(table.changeDate, table.tpuid),
    index("idx_tmt_tpu_fsn").on(table.normalizedFsn),
    index("idx_tmt_tpu_manufacturer").on(table.normalizedManufacturer),
  ],
);

export const tmtTpp = mysqlTable(
  "tmt_tpp",
  {
    tppid: tmtId("tppid").primaryKey(),
    fsn: text("fsn").notNull(),
    manufacturer: text("manufacturer").notNull(),
    changeDate: date("change_date", { mode: "string" }).notNull(),
    normalizedFsn: varchar("normalized_fsn", { length: 255 }),
    normalizedManufacturer: varchar("normalized_manufacturer", { length: 255 }),
    sourceVersion: varchar("source_version", { length: 32 }).notNull(),
    lastSeenVersion: varchar("last_seen_version", { length: 32 }).notNull(),
    syncedAt: datetime("synced_at", { mode: "date", fsp: 3 }).notNull(),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(now),
    updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).notNull().default(now),
  },
  (table) => [
    index("idx_tmt_tpp_change").on(table.changeDate, table.tppid),
    index("idx_tmt_tpp_fsn").on(table.normalizedFsn),
    index("idx_tmt_tpp_manufacturer").on(table.normalizedManufacturer),
  ],
);

export const tmtNlem = mysqlTable(
  "tmt_nlem",
  {
    tpuid: tmtId("tpuid").notNull(),
    fsn: text("fsn").notNull(),
    nlem: varchar("nlem", { length: 32 }).notNull(),
    changeDate: date("change_date", { mode: "string" }).notNull(),
    sourceVersion: varchar("source_version", { length: 32 }).notNull(),
    syncedAt: datetime("synced_at", { mode: "date", fsp: 3 }).notNull(),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(now),
  },
  (table) => [
    primaryKey({ columns: [table.tpuid, table.changeDate, table.nlem] }),
    index("idx_tmt_nlem_tpu_change").on(table.tpuid, table.changeDate),
    index("idx_tmt_nlem_value_tpu").on(table.nlem, table.tpuid),
  ],
);

export const tmtAtc = mysqlTable(
  "tmt_atc",
  {
    tpuid: tmtId("tpuid").notNull(),
    fsn: text("fsn").notNull(),
    atc: varchar("atc", { length: 32 }).notNull(),
    changeDate: date("change_date", { mode: "string" }).notNull(),
    sourceVersion: varchar("source_version", { length: 32 }).notNull(),
    syncedAt: datetime("synced_at", { mode: "date", fsp: 3 }).notNull(),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(now),
  },
  (table) => [
    primaryKey({ columns: [table.tpuid, table.changeDate, table.atc] }),
    index("idx_tmt_atc_tpu_change").on(table.tpuid, table.changeDate),
    index("idx_tmt_atc_value_tpu").on(table.atc, table.tpuid),
  ],
);

export const tmtRegno = mysqlTable(
  "tmt_regno",
  {
    tpuid: tmtId("tpuid").notNull(),
    fsn: text("fsn").notNull(),
    regno: varchar("regno", { length: 160 }).notNull(),
    normalizedRegno: varchar("normalized_regno", { length: 160 }).notNull(),
    changeDate: date("change_date", { mode: "string" }).notNull(),
    sourceVersion: varchar("source_version", { length: 32 }).notNull(),
    syncedAt: datetime("synced_at", { mode: "date", fsp: 3 }).notNull(),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(now),
  },
  (table) => [
    primaryKey({ columns: [table.tpuid, table.changeDate, table.regno] }),
    index("idx_tmt_regno_tpu_change").on(table.tpuid, table.changeDate),
    index("idx_tmt_regno_value_tpu").on(table.normalizedRegno, table.tpuid),
  ],
);

export const tmtMastertmt = mysqlTable(
  "tmt_mastertmt",
  {
    tpucode: tmtId("tpucode").primaryKey(),
    activeingredient: text("activeingredient"),
    strength: text("strength"),
    dosageform: text("dosageform"),
    contvalue: varchar("contvalue", { length: 80 }),
    contunit: varchar("contunit", { length: 120 }),
    dispunit: varchar("dispunit", { length: 120 }),
    tradename: text("tradename"),
    manufacturer: text("manufacturer"),
    fsn: text("fsn"),
    status: tinyint("status", { unsigned: true }).notNull(),
    normalizedGeneric: varchar("normalized_generic", { length: 255 }),
    normalizedTrade: varchar("normalized_trade", { length: 255 }),
    normalizedManufacturer: varchar("normalized_manufacturer", { length: 255 }),
    normalizedFsn: varchar("normalized_fsn", { length: 255 }),
    sourceVersion: varchar("source_version", { length: 32 }).notNull(),
    lastSeenVersion: varchar("last_seen_version", { length: 32 }).notNull(),
    syncedAt: datetime("synced_at", { mode: "date", fsp: 3 }).notNull(),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(now),
    updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).notNull().default(now),
  },
  (table) => [
    index("idx_tmt_master_status").on(table.status, table.tpucode),
    index("idx_tmt_master_generic").on(table.normalizedGeneric),
    index("idx_tmt_master_trade").on(table.normalizedTrade),
    index("idx_tmt_master_manufacturer").on(table.normalizedManufacturer),
  ],
);

export const tmtConcept = mysqlTable(
  "tmt_concept",
  {
    tmtid: tmtId("tmtid").primaryKey(),
    fsn: text("fsn").notNull(),
    changeDate: date("change_date", { mode: "string" }).notNull(),
    levelName: varchar("level_name", { length: 16 }).notNull(),
    normalizedFsn: varchar("normalized_fsn", { length: 255 }),
    sourceVersion: varchar("source_version", { length: 32 }).notNull(),
    lastSeenVersion: varchar("last_seen_version", { length: 32 }).notNull(),
    syncedAt: datetime("synced_at", { mode: "date", fsp: 3 }).notNull(),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(now),
    updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).notNull().default(now),
  },
  (table) => [
    index("idx_tmt_concept_level").on(table.levelName, table.tmtid),
    index("idx_tmt_concept_change").on(table.changeDate, table.tmtid),
    index("idx_tmt_concept_fsn").on(table.normalizedFsn),
  ],
);

export const tmtRelationship = mysqlTable(
  "tmt_relationship",
  {
    concept1: tmtId("concept1").notNull(),
    concept2: tmtId("concept2").notNull(),
    changeDate: date("change_date", { mode: "string" }).notNull(),
    levelName1: varchar("level_name1", { length: 16 }).notNull(),
    levelName2: varchar("level_name2", { length: 16 }).notNull(),
    sourceVersion: varchar("source_version", { length: 32 }).notNull(),
    lastSeenVersion: varchar("last_seen_version", { length: 32 }).notNull(),
    syncedAt: datetime("synced_at", { mode: "date", fsp: 3 }).notNull(),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(now),
    updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).notNull().default(now),
  },
  (table) => [
    primaryKey({ columns: [table.concept1, table.concept2] }),
    index("idx_tmt_relationship_reverse").on(table.concept2, table.concept1),
    index("idx_tmt_relationship_level1").on(table.levelName1, table.concept1),
    index("idx_tmt_relationship_level2").on(table.levelName2, table.concept2),
    index("idx_tmt_relationship_change").on(table.changeDate, table.concept1),
  ],
);

export const tmtVersion = mysqlTable(
  "tmt_version",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tmtVersion: varchar("tmt_version", { length: 32 }).notNull(),
    observedAt: datetime("observed_at", { mode: "date", fsp: 3 }).notNull(),
    httpLatencyMs: int("http_latency_ms", { unsigned: true }),
    coreSyncRunId: varchar("core_sync_run_id", { length: 36 }),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(now),
  },
  (table) => [
    uniqueIndex("uq_tmt_version_observation").on(table.tmtVersion, table.observedAt),
    index("idx_tmt_version_value").on(table.tmtVersion),
    index("idx_tmt_version_observed").on(table.observedAt),
  ],
);

export const tmtSyncRuns = mysqlTable(
  "tmt_sync_runs",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tmtVersion: varchar("tmt_version", { length: 32 }).notNull(),
    mode: varchar("mode", { length: 16 }).notNull(),
    status: varchar("status", { length: 24 }).notNull(),
    startedBy: varchar("started_by", { length: 36 }),
    receivedRows: int("received_rows", { unsigned: true }).notNull().default(0),
    writtenRows: int("written_rows", { unsigned: true }).notNull().default(0),
    warningsCount: int("warnings_count", { unsigned: true }).notNull().default(0),
    errorCode: varchar("error_code", { length: 64 }),
    startedAt: datetime("started_at", { mode: "date", fsp: 3 }).notNull(),
    finishedAt: datetime("finished_at", { mode: "date", fsp: 3 }),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(now),
  },
  (table) => [index("idx_tmt_sync_runs_status_started").on(table.status, table.startedAt)],
);

export const tmtSyncCheckpoints = mysqlTable(
  "tmt_sync_checkpoints",
  {
    runId: varchar("run_id", { length: 36 }).notNull().references(() => tmtSyncRuns.id, { onDelete: "cascade" }),
    endpoint: varchar("endpoint", { length: 32 }).notNull(),
    windowBegin: date("window_begin", { mode: "string" }).notNull(),
    windowEnd: date("window_end", { mode: "string" }).notNull(),
    status: varchar("status", { length: 24 }).notNull(),
    receivedRows: int("received_rows", { unsigned: true }).notNull().default(0),
    writtenRows: int("written_rows", { unsigned: true }).notNull().default(0),
    attemptCount: int("attempt_count", { unsigned: true }).notNull().default(0),
    errorCode: varchar("error_code", { length: 64 }),
    startedAt: datetime("started_at", { mode: "date", fsp: 3 }),
    finishedAt: datetime("finished_at", { mode: "date", fsp: 3 }),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(now),
    updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).notNull().default(now),
  },
  (table) => [
    primaryKey({ columns: [table.runId, table.endpoint, table.windowBegin, table.windowEnd] }),
    index("idx_tmt_sync_checkpoint_resume").on(table.runId, table.status, table.endpoint),
  ],
);
