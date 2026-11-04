import { sql } from "drizzle-orm";
import { datetime, index, int, mysqlTable, text, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

const now = sql`CURRENT_TIMESTAMP(3)`;

export const ttmtImports = mysqlTable(
  "ttmt_imports",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    version: varchar("version", { length: 120 }).notNull(),
    filename: varchar("filename", { length: 255 }).notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    rowCount: int("row_count", { unsigned: true }).notNull().default(0),
    status: varchar("status", { length: 24 }).notNull(),
    importedBy: varchar("imported_by", { length: 36 }),
    startedAt: datetime("started_at", { mode: "date", fsp: 3 }).notNull(),
    completedAt: datetime("completed_at", { mode: "date", fsp: 3 }),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(now),
  },
  (table) => [uniqueIndex("uq_ttmt_imports_version").on(table.version), uniqueIndex("uq_ttmt_imports_hash").on(table.contentHash)],
);

export const ttmtProducts = mysqlTable(
  "ttmt_products",
  {
    ttmtcode: varchar("ttmtcode", { length: 64 }).primaryKey(),
    activeingredient: text("activeingredient"),
    strength: text("strength"),
    dosageform: text("dosageform"),
    contvalue: varchar("contvalue", { length: 80 }),
    contunit: varchar("contunit", { length: 120 }),
    dispunit: varchar("dispunit", { length: 120 }),
    tradename: text("tradename"),
    manufacturer: text("manufacturer"),
    fsn: text("fsn"),
    status: varchar("status", { length: 24 }).notNull(),
    nlem: varchar("nlem", { length: 32 }),
    registrationNumber: varchar("registration_number", { length: 160 }),
    sourceVersion: varchar("source_version", { length: 120 }).notNull(),
    sourceImportId: varchar("source_import_id", { length: 36 }).notNull().references(() => ttmtImports.id),
    normalizedGeneric: varchar("normalized_generic", { length: 255 }),
    normalizedTrade: varchar("normalized_trade", { length: 255 }),
    normalizedManufacturer: varchar("normalized_manufacturer", { length: 255 }),
    normalizedRegno: varchar("normalized_regno", { length: 160 }),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(now),
    updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).notNull().default(now),
  },
  (table) => [
    index("idx_ttmt_products_status_code").on(table.status, table.ttmtcode),
    index("idx_ttmt_products_generic").on(table.normalizedGeneric),
    index("idx_ttmt_products_trade").on(table.normalizedTrade),
    index("idx_ttmt_products_manufacturer").on(table.normalizedManufacturer),
    index("idx_ttmt_products_regno").on(table.normalizedRegno),
    index("idx_ttmt_products_import").on(table.sourceImportId),
  ],
);
