import { sql } from "drizzle-orm";
import { date, datetime, index, int, mysqlTable, text, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

const now = sql`CURRENT_TIMESTAMP(3)`;

export const drugCatalogImports = mysqlTable(
  "drug_catalog_imports",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    facilityId: varchar("facility_id", { length: 36 }).notNull(),
    filename: varchar("filename", { length: 255 }).notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    sourceVersion: varchar("source_version", { length: 120 }),
    sourceDate: date("source_date", { mode: "string" }),
    rowCount: int("row_count").notNull(),
    importedBy: varchar("imported_by", { length: 36 }).notNull(),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(now),
  },
  (table) => [
    uniqueIndex("uq_catalog_facility_hash").on(table.facilityId, table.contentHash),
    index("idx_catalog_facility_created").on(table.facilityId, table.createdAt),
  ],
);

export const drugCatalogRows = mysqlTable(
  "drug_catalog_rows",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    importId: varchar("import_id", { length: 36 }).notNull(),
    facilityId: varchar("facility_id", { length: 36 }).notNull(),
    sourceRowNumber: int("source_row_number").notNull(),
    hospdrugcode: varchar("hospdrugcode", { length: 64 }).notNull(),
    productcat: varchar("productcat", { length: 8 }),
    tmtid: varchar("tmtid", { length: 64 }),
    specprep: varchar("specprep", { length: 255 }),
    genericname: text("genericname"),
    tradename: varchar("tradename", { length: 255 }),
    dfscode: varchar("dfscode", { length: 64 }),
    dosageform: varchar("dosageform", { length: 255 }),
    strength: varchar("strength", { length: 255 }),
    content: varchar("content", { length: 255 }),
    unitprice: varchar("unitprice", { length: 80 }),
    distributor: varchar("distributor", { length: 255 }),
    manufacturer: varchar("manufacturer", { length: 255 }),
    ised: varchar("ised", { length: 8 }),
    ndc24: varchar("ndc24", { length: 32 }),
    packsize: varchar("packsize", { length: 120 }),
    packprice: varchar("packprice", { length: 80 }),
    updateflag: varchar("updateflag", { length: 8 }),
    datechange: varchar("datechange", { length: 32 }),
    dateupdate: varchar("dateupdate", { length: 32 }),
    dateeffective: varchar("dateeffective", { length: 32 }),
  },
  (table) => [
    uniqueIndex("uq_catalog_row_import_code").on(table.importId, table.hospdrugcode),
    index("idx_catalog_rows_facility_code").on(table.facilityId, table.hospdrugcode),
  ],
);
