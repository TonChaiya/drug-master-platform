import { sql } from "drizzle-orm";
import { char, datetime, mysqlTable, text, varchar } from "drizzle-orm/mysql-core";

export const appSettings = mysqlTable("app_settings", {
  settingKey: varchar("setting_key", { length: 64 }).primaryKey(),
  valueEncrypted: text("value_encrypted").notNull(),
  updatedBy: char("updated_by", { length: 36 }),
  updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
});
