import { sql } from "drizzle-orm";
import { datetime, decimal, index, mysqlTable, tinyint, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import { facilities } from "./identity";

const now = sql`CURRENT_TIMESTAMP(3)`;

export const sourceDrugs = mysqlTable(
  "source_drugs",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    facilityId: varchar("facility_id", { length: 36 }).notNull().references(() => facilities.id),
    drugcode: varchar("drugcode", { length: 64 }).notNull(),
    drugname: varchar("drugname", { length: 255 }),
    drugnamethai: varchar("drugnamethai", { length: 255 }),
    druggenericname: varchar("druggenericname", { length: 255 }),
    drugtype: varchar("drugtype", { length: 8 }).notNull(),
    pack: varchar("pack", { length: 120 }),
    unitsell: varchar("unitsell", { length: 120 }),
    unitusage: varchar("unitusage", { length: 120 }),
    cost: decimal("cost", { precision: 18, scale: 4 }),
    sell: decimal("sell", { precision: 18, scale: 4 }),
    nationaccount: varchar("nationaccount", { length: 32 }),
    drugcode24: varchar("drugcode24", { length: 32 }),
    active: tinyint("active").notNull().default(1),
    lastSeenSyncId: varchar("last_seen_sync_id", { length: 36 }).notNull(),
    sourceUpdatedAt: datetime("source_updated_at", { mode: "date", fsp: 3 }),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(now),
    updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).notNull().default(now),
  },
  (table) => [
    uniqueIndex("uq_source_drugs_facility_code").on(table.facilityId, table.drugcode),
    index("idx_source_drugs_facility_active").on(table.facilityId, table.active),
  ],
);
