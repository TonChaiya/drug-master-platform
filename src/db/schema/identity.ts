import { sql } from "drizzle-orm";
import { datetime, index, json, mysqlTable, tinyint, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

const now = sql`CURRENT_TIMESTAMP(3)`;

export const facilities = mysqlTable(
  "facilities",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    facilityCode: varchar("facility_code", { length: 5 }).notNull(),
    facilityName: varchar("facility_name", { length: 255 }).notNull(),
    status: varchar("status", { length: 24 }).notNull().default("active"),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(now),
    updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).notNull().default(now),
  },
  (table) => [uniqueIndex("uq_facilities_code").on(table.facilityCode), index("idx_facilities_status").on(table.status)],
);

export const users = mysqlTable(
  "users",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    facilityId: varchar("facility_id", { length: 36 }).references(() => facilities.id),
    username: varchar("username", { length: 80 }).notNull(),
    usernameNormalized: varchar("username_normalized", { length: 80 }).notNull(),
    fullName: varchar("full_name", { length: 255 }).notNull(),
    positionName: varchar("position_name", { length: 160 }).notNull(),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    role: varchar("role", { length: 24 }).notNull(),
    status: varchar("status", { length: 24 }).notNull().default("pending"),
    mustChangePassword: tinyint("must_change_password").notNull().default(0),
    lastLoginAt: datetime("last_login_at", { mode: "date", fsp: 3 }),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(now),
    updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).notNull().default(now),
  },
  (table) => [
    uniqueIndex("uq_users_username_normalized").on(table.usernameNormalized),
    index("idx_users_facility_status").on(table.facilityId, table.status),
  ],
);

export const sessions = mysqlTable(
  "sessions",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    userId: varchar("user_id", { length: 36 }).notNull().references(() => users.id),
    expiresAt: datetime("expires_at", { mode: "date", fsp: 3 }).notNull(),
    revokedAt: datetime("revoked_at", { mode: "date", fsp: 3 }),
    ipHash: varchar("ip_hash", { length: 64 }),
    userAgent: varchar("user_agent", { length: 255 }),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(now),
  },
  (table) => [uniqueIndex("uq_sessions_token_hash").on(table.tokenHash), index("idx_sessions_user_active").on(table.userId, table.revokedAt, table.expiresAt)],
);

export const auditLogs = mysqlTable(
  "audit_logs",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    actorUserId: varchar("actor_user_id", { length: 36 }),
    effectiveFacilityId: varchar("effective_facility_id", { length: 36 }),
    action: varchar("action", { length: 96 }).notNull(),
    entityType: varchar("entity_type", { length: 64 }).notNull(),
    entityId: varchar("entity_id", { length: 96 }),
    beforeJson: json("before_json"),
    afterJson: json("after_json"),
    requestIpHash: varchar("request_ip_hash", { length: 64 }),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(now),
  },
  (table) => [index("idx_audit_facility_created").on(table.effectiveFacilityId, table.createdAt)],
);
