import { sql } from "drizzle-orm";
import { date, datetime, index, int, mysqlTable, text, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

const now = sql`CURRENT_TIMESTAMP(3)`;

export const standardImports = mysqlTable(
  "standard_imports",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    kind: varchar("kind", { length: 24 }).notNull(),
    version: varchar("version", { length: 120 }).notNull(),
    contentHash: varchar("content_hash", { length: 64 }),
    rowCount: int("row_count").notNull().default(0),
    status: varchar("status", { length: 24 }).notNull(),
    importedBy: varchar("imported_by", { length: 36 }),
    startedAt: datetime("started_at", { mode: "date", fsp: 3 }).notNull(),
    completedAt: datetime("completed_at", { mode: "date", fsp: 3 }),
  },
  (table) => [uniqueIndex("uq_standard_import_kind_version").on(table.kind, table.version)],
);

export const standardProducts = mysqlTable(
  "standard_products",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    standardCode: varchar("standard_code", { length: 64 }).notNull(),
    standardType: varchar("standard_type", { length: 8 }).notNull(),
    activeIngredient: text("active_ingredient"),
    strength: text("strength"),
    dosageForm: varchar("dosage_form", { length: 255 }),
    contentValue: varchar("content_value", { length: 80 }),
    contentUnit: varchar("content_unit", { length: 80 }),
    dispensingUnit: varchar("dispensing_unit", { length: 80 }),
    tradeName: varchar("trade_name", { length: 255 }),
    manufacturer: varchar("manufacturer", { length: 255 }),
    fsn: text("fsn"),
    status: varchar("status", { length: 24 }).notNull(),
    rawNlem: varchar("raw_nlem", { length: 32 }),
    exportIsed: varchar("export_ised", { length: 8 }),
    registrationNumber: varchar("registration_number", { length: 160 }),
    sourceVersion: varchar("source_version", { length: 120 }).notNull(),
    sourceChangedAt: datetime("source_changed_at", { mode: "date", fsp: 3 }),
    normalizedGeneric: varchar("normalized_generic", { length: 255 }),
    normalizedTrade: varchar("normalized_trade", { length: 255 }),
    normalizedManufacturer: varchar("normalized_manufacturer", { length: 255 }),
    normalizedRegno: varchar("normalized_regno", { length: 160 }),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(now),
    updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).notNull().default(now),
  },
  (table) => [
    uniqueIndex("uq_standard_products_code").on(table.standardCode),
    index("idx_standard_type_status_code").on(table.standardType, table.status, table.standardCode),
    index("idx_standard_generic").on(table.standardType, table.status, table.normalizedGeneric),
    index("idx_standard_trade").on(table.standardType, table.status, table.normalizedTrade),
  ],
);

export const standardSyncRuns = mysqlTable(
  "standard_sync_runs",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    source: varchar("source", { length: 24 }).notNull(),
    method: varchar("method", { length: 24 }).notNull(),
    windowBegin: date("window_begin", { mode: "string" }),
    windowEnd: date("window_end", { mode: "string" }),
    cursorValue: varchar("cursor_value", { length: 120 }),
    receivedRows: int("received_rows").notNull().default(0),
    changedRows: int("changed_rows").notNull().default(0),
    status: varchar("status", { length: 24 }).notNull(),
    errorCode: varchar("error_code", { length: 64 }),
    startedBy: varchar("started_by", { length: 36 }),
    startedAt: datetime("started_at", { mode: "date", fsp: 3 }).notNull(),
    finishedAt: datetime("finished_at", { mode: "date", fsp: 3 }),
    nextWindowBegin: date("next_window_begin", { mode: "string" }),
    completedWindows: int("completed_windows").notNull().default(0),
    totalWindows: int("total_windows").notNull().default(0),
  },
  (table) => [index("idx_standard_sync_source_started").on(table.source, table.startedAt)],
);
