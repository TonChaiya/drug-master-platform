import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs, sessions, users } from "@/db/schema";

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
