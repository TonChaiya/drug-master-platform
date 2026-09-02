import { sql } from "drizzle-orm";
import { date, datetime, index, mysqlTable, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

const now = sql`CURRENT_TIMESTAMP(3)`;

export const drugMappings = mysqlTable(
  "drug_mappings",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    facilityId: varchar("facility_id", { length: 36 }).notNull(),
    sourceDrugId: varchar("source_drug_id", { length: 36 }).notNull(),
    standardCode: varchar("standard_code", { length: 64 }).notNull(),
    productCat: varchar("product_cat", { length: 8 }).notNull(),
    specPrep: varchar("spec_prep", { length: 255 }),
    dfscode: varchar("dfscode", { length: 64 }),
    unitPrice: varchar("unit_price", { length: 80 }),
    distributor: varchar("distributor", { length: 255 }),
    ised: varchar("ised", { length: 8 }),
    ndc24: varchar("ndc24", { length: 32 }),
    packsize: varchar("packsize", { length: 120 }),
    packPrice: varchar("pack_price", { length: 80 }),
    updateFlag: varchar("update_flag", { length: 8 }).notNull(),
    dateChange: date("date_change", { mode: "string" }),
    dateUpdate: date("date_update", { mode: "string" }),
    dateEffective: date("date_effective", { mode: "string" }),
    notes: varchar("notes", { length: 500 }),
    source: varchar("source", { length: 24 }).notNull(),
    catalogImportId: varchar("catalog_import_id", { length: 36 }),
    mappedBy: varchar("mapped_by", { length: 36 }).notNull(),
    mappedAt: datetime("mapped_at", { mode: "date", fsp: 3 }).notNull(),
    updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).notNull().default(now),
  },
  (table) => [
    uniqueIndex("uq_mappings_facility_source").on(table.facilityId, table.sourceDrugId),
    index("idx_mappings_facility_mapped").on(table.facilityId, table.mappedAt),
  ],
);
