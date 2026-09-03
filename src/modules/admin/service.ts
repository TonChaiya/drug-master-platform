import { randomUUID } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { agentInstallations, auditLogs, facilities, sessions, users } from "@/db/schema";
import { isValidOfficeId, normalizeFacilityName } from "@/lib/validation/facility";

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
