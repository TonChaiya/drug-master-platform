import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  agentCommands,
  agentCredentials,
  agentEnrollmentTokens,
  agentInstallations,
  agentSyncSessions,
  agentSyncStaging,
  auditLogs,
  drugCatalogImports,
  drugCatalogRows,
  drugMappings,
  facilities,
  sessions,
  sourceDrugs,
  users,
} from "@/db/schema";
import { isValidOfficeId, normalizeFacilityName } from "@/lib/validation/facility";
import { hashPassword } from "@/modules/auth/password";
import { normalizeUsername } from "@/modules/auth/schemas";

export class AdminActionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AdminActionError";
  }
}

export type UserStatus = "active" | "pending" | "disabled";

/**
 * Activates, disables or re-queues an account.
 *
 * Any status change revokes that user's live sessions, so a disabled account
 * cannot keep working from an already-issued cookie
 * (docs/OPERATIONS.md).
 */
export async function setUserStatus(options: {
  actorUserId: string;
  targetUserId: string;
  status: UserStatus;
}): Promise<void> {
  if (options.actorUserId === options.targetUserId) {
    throw new AdminActionError("ADMIN_SELF_CHANGE", "เปลี่ยนสถานะบัญชีของตนเองไม่ได้");
  }

  const rows = await db
    .select({ id: users.id, status: users.status, role: users.role, username: users.username })
    .from(users)
    .where(eq(users.id, options.targetUserId))
    .limit(1);
  const target = rows[0];
  if (!target) throw new AdminActionError("USER_NOT_FOUND", "ไม่พบบัญชีผู้ใช้");
  if (target.status === options.status) return;

  await db.transaction(async (tx) => {
    await tx.update(users).set({ status: options.status, updatedAt: new Date() }).where(eq(users.id, target.id));
    if (options.status !== "active") {
      await tx.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.userId, target.id));
    }
    await tx.insert(auditLogs).values({
      id: randomUUID(),
      actorUserId: options.actorUserId,
      action: "admin.user_status_changed",
      entityType: "user",
      entityId: target.id,
      beforeJson: { status: target.status },
      afterJson: { status: options.status, username: target.username },
    });
  });
}

/**
 * Removes an account for good.
 *
 * Only `sessions` has a foreign key to users, so that is deleted first. The
 * history tables (audit_logs, drug_catalog_imports, drug_mappings) hold the id
 * without a constraint and keep it: throwing away who imported a Drug Catalog
 * would be worse than a dangling id. The audit entry therefore records the
 * username and facility, so the trail still reads after the row is gone.
 */
export async function deleteUser(options: { actorUserId: string; targetUserId: string }): Promise<void> {
  if (options.actorUserId === options.targetUserId) {
    throw new AdminActionError("ADMIN_SELF_DELETE", "ลบบัญชีของตนเองไม่ได้");
  }

  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      fullName: users.fullName,
      role: users.role,
      status: users.status,
      facilityId: users.facilityId,
    })
    .from(users)
    .where(eq(users.id, options.targetUserId))
    .limit(1);
  const target = rows[0];
  if (!target) throw new AdminActionError("USER_NOT_FOUND", "ไม่พบบัญชีผู้ใช้");

  if (target.role === "admin") {
    // Deleting the last admin would lock everyone out of this screen, and
    // nothing short of a database console could undo it.
    const remaining = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, "admin"), eq(users.status, "active"), ne(users.id, target.id)))
      .limit(1);
    if (remaining.length === 0) {
      throw new AdminActionError("ADMIN_LAST_ONE", "ลบผู้ดูแลระบบคนสุดท้ายไม่ได้ กรุณาสร้างผู้ดูแลระบบอีกบัญชีก่อน");
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(sessions).where(eq(sessions.userId, target.id));
    await tx.delete(users).where(eq(users.id, target.id));
    await tx.insert(auditLogs).values({
      id: randomUUID(),
      actorUserId: options.actorUserId,
      effectiveFacilityId: target.facilityId,
      action: "admin.user_deleted",
      entityType: "user",
      entityId: target.id,
      beforeJson: {
        username: target.username,
        fullName: target.fullName,
        role: target.role,
        status: target.status,
        facilityId: target.facilityId,
      },
    });
  });
}

export interface CredentialUpdateResult {
  usernameChanged: boolean;
  passwordChanged: boolean;
  /** Sessions signed out by the change; the admin's own is never among them. */
  sessionsRevoked: number;
}

/**
 * Sets a username, a password, or both, on any account — the acting admin's own
 * included.
 *
 * Unlike enabling or deleting an account, there is no self-change guard here.
 * An admin who cannot change their own password would have to ask someone else,
 * and on a single-admin system there is nobody to ask.
 *
 * A password change signs the account out everywhere, because the point of
 * changing one is usually that the old one is no longer trusted. The one
 * exception is the session issuing the request: signing the admin out of the
 * screen they are working on, at the moment they succeed, reads as a failure.
 */
export async function updateUserCredentials(options: {
  actorUserId: string;
  targetUserId: string;
  username?: string;
  password?: string;
  /** Hash of the acting admin's own session cookie, kept alive. */
  keepSessionTokenHash?: string | null;
}): Promise<CredentialUpdateResult> {
  const username = options.username?.trim();
  const password = options.password;
  if (!username && !password) {
    throw new AdminActionError("ADMIN_NOTHING_TO_DO", "ไม่มีข้อมูลที่จะแก้ไข");
  }

  const rows = await db
    .select({ id: users.id, username: users.username, usernameNormalized: users.usernameNormalized, facilityId: users.facilityId })
    .from(users)
    .where(eq(users.id, options.targetUserId))
    .limit(1);
  const target = rows[0];
  if (!target) throw new AdminActionError("USER_NOT_FOUND", "ไม่พบบัญชีผู้ใช้");

  const normalized = username ? normalizeUsername(username) : null;
  const usernameChanged = normalized !== null && normalized !== target.usernameNormalized;
  const passwordChanged = Boolean(password);

  if (usernameChanged) {
    const taken = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.usernameNormalized, normalized), ne(users.id, target.id)))
      .limit(1);
    if (taken.length > 0) {
      throw new AdminActionError("USERNAME_TAKEN", `ไอดี ${username} ถูกใช้แล้ว`);
    }
  }

  // Hashing is deliberately outside the transaction: Argon2 takes long enough
  // that holding a write transaction open across it would be wasteful.
  const passwordHash = password ? await hashPassword(password) : null;

  let sessionsRevoked = 0;

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        ...(usernameChanged ? { username: username!, usernameNormalized: normalized! } : {}),
        ...(passwordHash ? { passwordHash } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, target.id));

    if (passwordHash) {
      const live = and(eq(sessions.userId, target.id), isNull(sessions.revokedAt));
      const scope =
        options.keepSessionTokenHash && options.targetUserId === options.actorUserId
          ? and(live, ne(sessions.tokenHash, options.keepSessionTokenHash))
          : live;
      // Counted before revoking, so the screen can say how many devices were
      // signed out rather than guessing.
      sessionsRevoked = (await tx.select({ id: sessions.id }).from(sessions).where(scope)).length;
      await tx.update(sessions).set({ revokedAt: new Date() }).where(scope);
    }

    await tx.insert(auditLogs).values({
      id: randomUUID(),
      actorUserId: options.actorUserId,
      effectiveFacilityId: target.facilityId,
      action: "admin.user_credentials_updated",
      entityType: "user",
      entityId: target.id,
      // The password itself and its hash are never written to the trail; that
      // a change happened is the auditable fact.
      beforeJson: { username: target.username },
      afterJson: {
        username: usernameChanged ? username : target.username,
        usernameChanged,
        passwordChanged,
        self: options.actorUserId === options.targetUserId,
      },
    });
  });

  return { usernameChanged, passwordChanged, sessionsRevoked };
}

export interface FacilityUpdateResult {
  /** Set when the code changed and agents are enrolled against the old one. */
  agentWarning: string | null;
}

/**
 * Renames a facility, or changes its 5-digit code.
 *
 * The code is not cosmetic: the agent reads `office.offid` from JHCIS and every
 * request is refused unless it equals this. Changing it therefore stops every
 * enrolled agent at that facility until JHCIS is changed to match, which is
 * reported back rather than left to be discovered as a mismatch banner.
 */
export async function updateFacility(options: {
  actorUserId: string;
  facilityId: string;
  facilityName: string;
  facilityCode: string;
}): Promise<FacilityUpdateResult> {
  const name = options.facilityName.trim();
  const code = options.facilityCode.trim();
  if (name.length < 2 || name.length > 255) throw new AdminActionError("FACILITY_NAME_INVALID", "ชื่อสถานบริการต้องมี 2-255 ตัวอักษร");
  if (!isValidOfficeId(code)) throw new AdminActionError("FACILITY_CODE_INVALID", "รหัสสถานบริการต้องเป็นเลข 5 หลักและไม่ขึ้นต้น 0000");

  const rows = await db
    .select({ id: facilities.id, facilityCode: facilities.facilityCode, facilityName: facilities.facilityName })
    .from(facilities)
    .where(eq(facilities.id, options.facilityId))
    .limit(1);
  const facility = rows[0];
  if (!facility) throw new AdminActionError("FACILITY_NOT_FOUND", "ไม่พบสถานบริการ");

  if (code !== facility.facilityCode) {
    const clash = await db
      .select({ facilityName: facilities.facilityName })
      .from(facilities)
      .where(eq(facilities.facilityCode, code))
      .limit(1);
    if (clash[0]) {
      throw new AdminActionError("FACILITY_CODE_TAKEN", `รหัส ${code} ใช้อยู่แล้วโดย "${clash[0].facilityName}"`);
    }
  }

  const nameUnchanged = normalizeFacilityName(name) === normalizeFacilityName(facility.facilityName);
  const codeUnchanged = code === facility.facilityCode;
  if (nameUnchanged && codeUnchanged && name === facility.facilityName) return { agentWarning: null };

  let agentWarning: string | null = null;
  if (!codeUnchanged) {
    const enrolled = await db
      .select({ machineLabel: agentInstallations.machineLabel })
      .from(agentInstallations)
      .where(and(eq(agentInstallations.facilityId, facility.id), eq(agentInstallations.status, "active")));
    if (enrolled.length > 0) {
      agentWarning =
        `มี Agent ${enrolled.length} เครื่องลงทะเบียนกับรหัสเดิม ${facility.facilityCode} อยู่ ` +
        `Agent จะหยุดส่งข้อมูลจนกว่า office.offid ใน JHCIS จะเป็น ${code} ตรงกัน`;
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .update(facilities)
      .set({ facilityName: name, facilityCode: code, updatedAt: new Date() })
      .where(eq(facilities.id, facility.id));
    await tx.insert(auditLogs).values({
      id: randomUUID(),
      actorUserId: options.actorUserId,
      effectiveFacilityId: facility.id,
      action: "admin.facility_updated",
      entityType: "facility",
      entityId: facility.id,
      beforeJson: { facilityCode: facility.facilityCode, facilityName: facility.facilityName },
      afterJson: { facilityCode: code, facilityName: name },
    });
  });

  return { agentWarning };
}

/** What an admin may wipe for one facility. */
export type ClearScope = "mappings" | "catalog" | "source" | "agents" | "all";

export interface ClearResult {
  mappings: number;
  catalogRows: number;
  catalogImports: number;
  sourceDrugs: number;
  agents: number;
}

async function countRows(table: typeof sourceDrugs | typeof drugMappings, facilityId: string): Promise<number> {
  const [row] = await db.select({ total: sql<number>`COUNT(*)` }).from(table).where(eq(table.facilityId, facilityId));
  return Number(row?.total ?? 0);
}

/**
 * Wipes one facility's working data.
 *
 * Order matters and is dictated by what points at what: mappings reference
 * source_drugs and a catalog import, so they go first; the agent's staging rows
 * reference its sync sessions, and its credentials reference the installation.
 * Nothing here touches the shared TMT/TTMT catalogue, another facility's rows,
 * the accounts, or audit_logs — the audit trail is the record that this
 * happened, so deleting it alongside would defeat the point.
 */
export async function clearFacilityData(options: {
  actorUserId: string;
  facilityId: string;
  scope: ClearScope;
}): Promise<ClearResult> {
  const rows = await db
    .select({ id: facilities.id, facilityCode: facilities.facilityCode })
    .from(facilities)
    .where(eq(facilities.id, options.facilityId))
    .limit(1);
  const facility = rows[0];
  if (!facility) throw new AdminActionError("FACILITY_NOT_FOUND", "ไม่พบสถานบริการ");

  const { scope } = options;
  const wipeMappings = scope === "mappings" || scope === "catalog" || scope === "source" || scope === "all";
  const wipeCatalog = scope === "catalog" || scope === "source" || scope === "all";
  const wipeSource = scope === "source" || scope === "all";
  const wipeAgents = scope === "agents" || scope === "all";

  const before: ClearResult = {
    mappings: wipeMappings ? await countRows(drugMappings, facility.id) : 0,
    catalogRows: 0,
    catalogImports: 0,
    sourceDrugs: wipeSource ? await countRows(sourceDrugs, facility.id) : 0,
    agents: 0,
  };

  await db.transaction(async (tx) => {
    if (wipeMappings) await tx.delete(drugMappings).where(eq(drugMappings.facilityId, facility.id));

    if (wipeCatalog) {
      const [rowResult] = await tx.delete(drugCatalogRows).where(eq(drugCatalogRows.facilityId, facility.id));
      const [importResult] = await tx.delete(drugCatalogImports).where(eq(drugCatalogImports.facilityId, facility.id));
      before.catalogRows = rowResult.affectedRows;
      before.catalogImports = importResult.affectedRows;
    }

    if (wipeSource) await tx.delete(sourceDrugs).where(eq(sourceDrugs.facilityId, facility.id));

    if (wipeAgents) {
      const installations = await tx
        .select({ installationId: agentInstallations.installationId })
        .from(agentInstallations)
        .where(eq(agentInstallations.facilityId, facility.id));
      const ids = installations.map((row) => row.installationId);

      await tx.delete(agentSyncStaging).where(eq(agentSyncStaging.facilityId, facility.id));
      await tx.delete(agentSyncSessions).where(eq(agentSyncSessions.facilityId, facility.id));
      await tx.delete(agentCommands).where(eq(agentCommands.facilityId, facility.id));
      await tx.delete(agentEnrollmentTokens).where(eq(agentEnrollmentTokens.facilityId, facility.id));
      if (ids.length > 0) {
        await tx.delete(agentCredentials).where(inArray(agentCredentials.installationId, ids));
        await tx.delete(agentInstallations).where(inArray(agentInstallations.installationId, ids));
      }
      before.agents = ids.length;
    }

    await tx.insert(auditLogs).values({
      id: randomUUID(),
      actorUserId: options.actorUserId,
      effectiveFacilityId: facility.id,
      action: "admin.facility_data_cleared",
      entityType: "facility",
      entityId: facility.id,
      beforeJson: { facilityCode: facility.facilityCode, scope, ...before },
    });
  });

  return before;
}
