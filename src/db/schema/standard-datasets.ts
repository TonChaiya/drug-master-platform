import { sql } from "drizzle-orm";
import { bigint, date, datetime, index, int, mysqlTable, primaryKey, text, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import { tmtRunValidations, tmtSyncRuns } from "./tmt";
import { ttmtImports } from "./ttmt";

const now = sql`CURRENT_TIMESTAMP(3)`;
const tmtId = (name: string) => bigint(name, { mode: "bigint", unsigned: true });
const datasetId = () => varchar("dataset_id", { length: 36 }).notNull().references(() => standardDatasets.id);

export const standardDatasets = mysqlTable(
  "standard_datasets",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    source: varchar("source", { length: 8 }).notNull(),
    state: varchar("state", { length: 24 }).notNull(),
    sourceVersion: varchar("source_version", { length: 120 }).notNull(),
    contentHash: varchar("content_hash", { length: 64 }),
    tmtSyncRunId: varchar("tmt_sync_run_id", { length: 36 }).references(() => tmtSyncRuns.id),
    ttmtImportId: varchar("ttmt_import_id", { length: 36 }).references(() => ttmtImports.id),
    errorCode: varchar("error_code", { length: 64 }),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(now),
    completedAt: datetime("completed_at", { mode: "date", fsp: 3 }),
  },
  (table) => [
    uniqueIndex("uq_standard_datasets_tmt_run").on(table.tmtSyncRunId),
    uniqueIndex("uq_standard_datasets_ttmt_import").on(table.ttmtImportId),
    index("idx_standard_datasets_source_state").on(table.source, table.state, table.createdAt),
  ],
);

export const standardReleases = mysqlTable(
  "standard_releases",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    state: varchar("state", { length: 24 }).notNull(),
    tmtDatasetId: varchar("tmt_dataset_id", { length: 36 }).notNull().references(() => standardDatasets.id),
    ttmtDatasetId: varchar("ttmt_dataset_id", { length: 36 }).notNull().references(() => standardDatasets.id),
    validationRunId: varchar("validation_run_id", { length: 36 }).references(() => tmtRunValidations.runId),
    validationEvidenceSha256: varchar("validation_evidence_sha256", { length: 64 }),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(now),
    approvedAt: datetime("approved_at", { mode: "date", fsp: 3 }),
    supersededAt: datetime("superseded_at", { mode: "date", fsp: 3 }),
  },
  (table) => [
    uniqueIndex("uq_standard_releases_datasets").on(table.tmtDatasetId, table.ttmtDatasetId),
    index("idx_standard_releases_state_created").on(table.state, table.createdAt),
  ],
);

export const standardDatasetPointers = mysqlTable("standard_dataset_pointers", {
  pointerKey: varchar("pointer_key", { length: 32 }).primaryKey(),
  activeReleaseId: varchar("active_release_id", { length: 36 }).references(() => standardReleases.id),
  updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).notNull().default(now),
});

export const standardDatasetManifests = mysqlTable(
  "standard_dataset_manifests",
  {
    datasetId: datasetId(),
    tableName: varchar("table_name", { length: 64 }).notNull(),
    rowCount: int("row_count", { unsigned: true }).notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(now),
  },
  (table) => [primaryKey({ columns: [table.datasetId, table.tableName] })],
);

const versionedLevel = (name: string, idName: string, manufacturer = false) => mysqlTable(
  name,
  {
    datasetId: datasetId(),
    id: tmtId(idName),
    fsn: text("fsn").notNull(),
    ...(manufacturer ? { manufacturer: text("manufacturer").notNull(), normalizedManufacturer: varchar("normalized_manufacturer", { length: 255 }) } : {}),
    changeDate: date("change_date", { mode: "string" }).notNull(),
    normalizedFsn: varchar("normalized_fsn", { length: 255 }),
    sourceVersion: varchar("source_version", { length: 32 }).notNull(),
    lastSeenVersion: varchar("last_seen_version", { length: 32 }).notNull(),
    syncedAt: datetime("synced_at", { mode: "date", fsp: 3 }).notNull(),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(now),
    updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).notNull().default(now),
  },
  (table) => [primaryKey({ columns: [table.datasetId, table.id] }), index(`${name}_lookup`).on(table.datasetId, table.id)],
);

export const tmtDatasetSubs = versionedLevel("tmt_dataset_subs", "subsid");
export const tmtDatasetVtm = versionedLevel("tmt_dataset_vtm", "vtmid");
export const tmtDatasetGp = versionedLevel("tmt_dataset_gp", "gpid");
export const tmtDatasetGpu = versionedLevel("tmt_dataset_gpu", "gpuid");
export const tmtDatasetGpp = versionedLevel("tmt_dataset_gpp", "gppid");
export const tmtDatasetTp = versionedLevel("tmt_dataset_tp", "tpid", true);
export const tmtDatasetTpu = versionedLevel("tmt_dataset_tpu", "tpuid", true);
export const tmtDatasetTpp = versionedLevel("tmt_dataset_tpp", "tppid", true);

export const tmtDatasetNlem = mysqlTable(
  "tmt_dataset_nlem",
  { datasetId: datasetId(), tpuid: tmtId("tpuid"), fsn: text("fsn").notNull(), nlem: varchar("nlem", { length: 32 }).notNull(), changeDate: date("change_date", { mode: "string" }).notNull(), sourceVersion: varchar("source_version", { length: 32 }).notNull(), syncedAt: datetime("synced_at", { mode: "date", fsp: 3 }).notNull(), createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(now) },
  (table) => [primaryKey({ columns: [table.datasetId, table.tpuid, table.changeDate, table.nlem] }), index("idx_tmt_dataset_nlem_lookup").on(table.datasetId, table.tpuid, table.changeDate)],
);

export const tmtDatasetAtc = mysqlTable(
  "tmt_dataset_atc",
  { datasetId: datasetId(), tpuid: tmtId("tpuid"), fsn: text("fsn").notNull(), atc: varchar("atc", { length: 32 }).notNull(), changeDate: date("change_date", { mode: "string" }).notNull(), sourceVersion: varchar("source_version", { length: 32 }).notNull(), syncedAt: datetime("synced_at", { mode: "date", fsp: 3 }).notNull(), createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(now) },
  (table) => [primaryKey({ columns: [table.datasetId, table.tpuid, table.changeDate, table.atc] }), index("idx_tmt_dataset_atc_lookup").on(table.datasetId, table.tpuid, table.changeDate)],
);

export const tmtDatasetRegno = mysqlTable(
  "tmt_dataset_regno",
  { datasetId: datasetId(), tpuid: tmtId("tpuid"), fsn: text("fsn").notNull(), regno: varchar("regno", { length: 160 }).notNull(), normalizedRegno: varchar("normalized_regno", { length: 160 }).notNull(), changeDate: date("change_date", { mode: "string" }).notNull(), sourceVersion: varchar("source_version", { length: 32 }).notNull(), syncedAt: datetime("synced_at", { mode: "date", fsp: 3 }).notNull(), createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(now) },
  (table) => [primaryKey({ columns: [table.datasetId, table.tpuid, table.changeDate, table.regno] }), index("idx_tmt_dataset_regno_lookup").on(table.datasetId, table.tpuid, table.changeDate)],
);

export const tmtDatasetMastertmt = mysqlTable(
  "tmt_dataset_mastertmt",
  {
    datasetId: datasetId(), tpucode: tmtId("tpucode"), activeingredient: text("activeingredient"), strength: text("strength"), dosageform: text("dosageform"),
    contvalue: varchar("contvalue", { length: 80 }), contunit: varchar("contunit", { length: 120 }), dispunit: varchar("dispunit", { length: 120 }), tradename: text("tradename"), manufacturer: text("manufacturer"), fsn: text("fsn"), status: int("status", { unsigned: true }).notNull(),
    normalizedGeneric: varchar("normalized_generic", { length: 255 }), normalizedTrade: varchar("normalized_trade", { length: 255 }), normalizedManufacturer: varchar("normalized_manufacturer", { length: 255 }), normalizedFsn: varchar("normalized_fsn", { length: 255 }),
    sourceVersion: varchar("source_version", { length: 32 }).notNull(), lastSeenVersion: varchar("last_seen_version", { length: 32 }).notNull(), syncedAt: datetime("synced_at", { mode: "date", fsp: 3 }).notNull(), createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(now), updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).notNull().default(now),
  },
  (table) => [primaryKey({ columns: [table.datasetId, table.tpucode] }), index("idx_tmt_dataset_master_lookup").on(table.datasetId, table.status, table.tpucode)],
);

export const tmtDatasetConcepts = mysqlTable(
  "tmt_dataset_concepts",
  {
    datasetId: datasetId(), tmtid: tmtId("tmtid"), fsn: text("fsn").notNull(), changeDate: date("change_date", { mode: "string" }).notNull(), levelName: varchar("level_name", { length: 16 }).notNull(), normalizedFsn: varchar("normalized_fsn", { length: 255 }), sourceVersion: varchar("source_version", { length: 32 }).notNull(), lastSeenVersion: varchar("last_seen_version", { length: 32 }).notNull(), syncedAt: datetime("synced_at", { mode: "date", fsp: 3 }).notNull(), createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(now), updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).notNull().default(now),
  },
  (table) => [primaryKey({ columns: [table.datasetId, table.tmtid] }), index("idx_tmt_dataset_concept_lookup").on(table.datasetId, table.levelName, table.tmtid)],
);

export const tmtDatasetRelationships = mysqlTable(
  "tmt_dataset_relationships",
  {
    datasetId: datasetId(), concept1: tmtId("concept1"), concept2: tmtId("concept2"), changeDate: date("change_date", { mode: "string" }).notNull(), levelName1: varchar("level_name1", { length: 16 }).notNull(), levelName2: varchar("level_name2", { length: 16 }).notNull(), sourceVersion: varchar("source_version", { length: 32 }).notNull(), lastSeenVersion: varchar("last_seen_version", { length: 32 }).notNull(), syncedAt: datetime("synced_at", { mode: "date", fsp: 3 }).notNull(), createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(now), updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).notNull().default(now),
  },
  (table) => [primaryKey({ columns: [table.datasetId, table.concept1, table.concept2] }), index("idx_tmt_dataset_relationship_reverse").on(table.datasetId, table.concept2, table.concept1)],
);

export const ttmtDatasetProducts = mysqlTable(
  "ttmt_dataset_products",
  {
    datasetId: datasetId(), ttmtcode: varchar("ttmtcode", { length: 64 }).notNull(), activeingredient: text("activeingredient"), strength: text("strength"), dosageform: text("dosageform"), contvalue: varchar("contvalue", { length: 80 }), contunit: varchar("contunit", { length: 120 }), dispunit: varchar("dispunit", { length: 120 }), tradename: text("tradename"), manufacturer: text("manufacturer"), fsn: text("fsn"), status: varchar("status", { length: 24 }).notNull(), nlem: varchar("nlem", { length: 32 }), registrationNumber: varchar("registration_number", { length: 160 }), sourceVersion: varchar("source_version", { length: 120 }).notNull(), sourceImportId: varchar("source_import_id", { length: 36 }).notNull().references(() => ttmtImports.id), normalizedGeneric: varchar("normalized_generic", { length: 255 }), normalizedTrade: varchar("normalized_trade", { length: 255 }), normalizedManufacturer: varchar("normalized_manufacturer", { length: 255 }), normalizedRegno: varchar("normalized_regno", { length: 160 }), createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(now), updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).notNull().default(now),
  },
  (table) => [primaryKey({ columns: [table.datasetId, table.ttmtcode] }), index("idx_ttmt_dataset_product_lookup").on(table.datasetId, table.status, table.ttmtcode)],
);
