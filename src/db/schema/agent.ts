import { sql } from "drizzle-orm";
import { datetime, index, int, json, mysqlTable, primaryKey, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import { facilities } from "./identity";

const now = sql`CURRENT_TIMESTAMP(3)`;

export const agentInstallations = mysqlTable(
  "agent_installations",
  {
    installationId: varchar("installation_id", { length: 36 }).primaryKey(),
    facilityId: varchar("facility_id", { length: 36 }).notNull().references(() => facilities.id),
    machineLabel: varchar("machine_label", { length: 128 }).notNull(),
    declaredOfficeId: varchar("declared_office_id", { length: 5 }),
    status: varchar("status", { length: 24 }).notNull(),
    lastSeenAt: datetime("last_seen_at", { mode: "date", fsp: 3 }),
    agentVersion: varchar("agent_version", { length: 32 }),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(now),
    enrolledAt: datetime("enrolled_at", { mode: "date", fsp: 3 }),
    lastMismatchOfficeId: varchar("last_mismatch_office_id", { length: 8 }),
    lastMismatchAt: datetime("last_mismatch_at", { mode: "date", fsp: 3 }),
  },
  (table) => [index("idx_agent_installations_facility_status").on(table.facilityId, table.status)],
);

export const agentCredentials = mysqlTable(
  "agent_credentials",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    installationId: varchar("installation_id", { length: 36 }).notNull().references(() => agentInstallations.installationId),
    publicKeyId: varchar("public_key_id", { length: 96 }).notNull(),
    encryptedSecret: varchar("encrypted_secret", { length: 512 }).notNull(),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(now),
    revokedAt: datetime("revoked_at", { mode: "date", fsp: 3 }),
    lastUsedAt: datetime("last_used_at", { mode: "date", fsp: 3 }),
  },
  (table) => [
    uniqueIndex("uq_agent_credentials_public_key").on(table.publicKeyId),
    index("idx_agent_credentials_installation_active").on(table.installationId, table.revokedAt),
  ],
);

export const agentEnrollmentTokens = mysqlTable(
  "agent_enrollment_tokens",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    facilityId: varchar("facility_id", { length: 36 }).notNull(),
    createdBy: varchar("created_by", { length: 36 }).notNull(),
    expiresAt: datetime("expires_at", { mode: "date", fsp: 3 }).notNull(),
    consumedAt: datetime("consumed_at", { mode: "date", fsp: 3 }),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(now),
  },
  (table) => [
    uniqueIndex("uq_agent_enrollment_token_hash").on(table.tokenHash),
    index("idx_agent_enrollment_facility_expiry").on(table.facilityId, table.expiresAt),
  ],
);

export const agentCommands = mysqlTable(
  "agent_commands",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    facilityId: varchar("facility_id", { length: 36 }).notNull(),
    installationId: varchar("installation_id", { length: 36 }),
    commandType: varchar("command_type", { length: 32 }).notNull(),
    payloadJson: json("payload_json"),
    status: varchar("status", { length: 24 }).notNull().default("pending"),
    idempotencyKey: varchar("idempotency_key", { length: 96 }).notNull(),
    claimToken: varchar("claim_token", { length: 36 }),
    claimedInstallationId: varchar("claimed_installation_id", { length: 36 }),
    requestedBy: varchar("requested_by", { length: 36 }),
    resultCode: varchar("result_code", { length: 48 }),
    resultMessage: varchar("result_message", { length: 500 }),
    expiresAt: datetime("expires_at", { mode: "date", fsp: 3 }).notNull(),
    claimedAt: datetime("claimed_at", { mode: "date", fsp: 3 }),
    finishedAt: datetime("finished_at", { mode: "date", fsp: 3 }),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(now),
  },
  (table) => [
    uniqueIndex("uq_agent_commands_idempotency").on(table.facilityId, table.idempotencyKey),
    index("idx_agent_commands_dispatch").on(table.facilityId, table.status, table.createdAt),
    index("idx_agent_commands_expiry").on(table.status, table.expiresAt),
  ],
);

export const agentSyncSessions = mysqlTable(
  "agent_sync_sessions",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    installationId: varchar("installation_id", { length: 36 }).notNull(),
    facilityId: varchar("facility_id", { length: 36 }).notNull(),
    declaredOfficeId: varchar("declared_office_id", { length: 5 }).notNull(),
    expectedRows: int("expected_rows").notNull(),
    receivedRows: int("received_rows").notNull().default(0),
    status: varchar("status", { length: 24 }).notNull(),
    startedAt: datetime("started_at", { mode: "date", fsp: 3 }).notNull(),
    finishedAt: datetime("finished_at", { mode: "date", fsp: 3 }),
  },
  (table) => [index("idx_agent_sync_facility_status").on(table.facilityId, table.status)],
);

export const agentSyncStaging = mysqlTable(
  "agent_sync_staging",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    sessionId: varchar("session_id", { length: 36 }).notNull(),
    facilityId: varchar("facility_id", { length: 36 }).notNull(),
    drugcode: varchar("drugcode", { length: 64 }).notNull(),
    payloadJson: json("payload_json").notNull(),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(now),
  },
  (table) => [
    uniqueIndex("uq_agent_staging_session_drug").on(table.sessionId, table.drugcode),
    index("idx_agent_staging_facility_session").on(table.facilityId, table.sessionId),
  ],
);

export const agentRequestNonces = mysqlTable(
  "agent_request_nonces",
  {
    credentialId: varchar("credential_id", { length: 36 }).notNull(),
    nonceHash: varchar("nonce_hash", { length: 64 }).notNull(),
    expiresAt: datetime("expires_at", { mode: "date", fsp: 3 }).notNull(),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(now),
  },
  (table) => [
    primaryKey({ columns: [table.credentialId, table.nonceHash] }),
    index("idx_agent_nonces_expires").on(table.expiresAt),
  ],
);
