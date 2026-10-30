import { randomUUID } from "node:crypto";
import { and, eq, isNotNull, isNull, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { agentCommands, agentCredentials, agentEnrollmentTokens, agentInstallations, agentSyncSessions, auditLogs } from "@/db/schema";

export class AgentAdminError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AgentAdminError";
  }
}

export function hasProtectedAgentHistory(input: {
  usedCredential: boolean;
  syncSession: boolean;
  claimedCommand: boolean;
}): boolean {
  return input.usedCredential || input.syncSession || input.claimedCommand;
}

export async function disableInstallation(input: { facilityId: string; installationId: string; actorUserId: string }) {
  await db.transaction(async (tx) => {
    const rows = await tx.select().from(agentInstallations)
      .where(and(eq(agentInstallations.facilityId, input.facilityId), eq(agentInstallations.installationId, input.installationId)))
      .limit(1);
    const current = rows[0];
    if (!current) throw new AgentAdminError("AGENT_NOT_FOUND", "ไม่พบ Agent ในสถานบริการนี้");
    if (current.status === "disabled") return;
    const now = new Date();
    await tx.update(agentInstallations).set({ status: "disabled" }).where(and(
      eq(agentInstallations.facilityId, input.facilityId),
      eq(agentInstallations.installationId, current.installationId),
    ));
    await tx.update(agentCredentials).set({ revokedAt: now }).where(and(eq(agentCredentials.installationId, current.installationId), isNull(agentCredentials.revokedAt)));
    await tx.insert(auditLogs).values({
      id: randomUUID(), actorUserId: input.actorUserId, effectiveFacilityId: input.facilityId,
      action: "agent.disabled", entityType: "agent_installation", entityId: current.installationId,
      beforeJson: { status: current.status }, afterJson: { status: "disabled" },
    });
  });
}

export async function supersedeInstallation(input: {
  facilityId: string;
  oldInstallationId: string;
  currentInstallationId: string;
  actorUserId: string;
}) {
  if (input.oldInstallationId === input.currentInstallationId) throw new AgentAdminError("AGENT_SAME_TARGET", "Agent เดิมและ Agent ปัจจุบันต้องเป็นคนละรายการ");
  await db.transaction(async (tx) => {
    const [oldRows, currentRows] = await Promise.all([
      tx.select().from(agentInstallations).where(and(eq(agentInstallations.facilityId, input.facilityId), eq(agentInstallations.installationId, input.oldInstallationId))).limit(1),
      tx.select().from(agentInstallations).where(and(eq(agentInstallations.facilityId, input.facilityId), eq(agentInstallations.installationId, input.currentInstallationId))).limit(1),
    ]);
    const old = oldRows[0];
    const current = currentRows[0];
    if (!old || !current) throw new AgentAdminError("AGENT_NOT_FOUND", "ไม่พบ Agent ในสถานบริการนี้");
    if (current.status !== "active") throw new AgentAdminError("AGENT_TARGET_INACTIVE", "Agent ปัจจุบันต้องอยู่ในสถานะลงทะเบียนแล้ว");
    const now = new Date();
    await tx.update(agentInstallations).set({ status: "superseded", supersededByInstallationId: current.installationId }).where(and(
      eq(agentInstallations.facilityId, input.facilityId),
      eq(agentInstallations.installationId, old.installationId),
    ));
    await tx.update(agentCredentials).set({ revokedAt: now }).where(and(eq(agentCredentials.installationId, old.installationId), isNull(agentCredentials.revokedAt)));
    await tx.insert(auditLogs).values({
      id: randomUUID(), actorUserId: input.actorUserId, effectiveFacilityId: input.facilityId,
      action: "agent.superseded", entityType: "agent_installation", entityId: old.installationId,
      beforeJson: { status: old.status }, afterJson: { status: "superseded", supersededByInstallationId: current.installationId },
    });
  });
}

export async function deleteUnusedInstallation(input: { facilityId: string; installationId: string; actorUserId: string }) {
  await db.transaction(async (tx) => {
    const rows = await tx.select().from(agentInstallations)
      .where(and(eq(agentInstallations.facilityId, input.facilityId), eq(agentInstallations.installationId, input.installationId)))
      .limit(1);
    const current = rows[0];
    if (!current) throw new AgentAdminError("AGENT_NOT_FOUND", "ไม่พบ Agent ในสถานบริการนี้");
    const [usedCredential, sync, claimed] = await Promise.all([
      tx.select({ id: agentCredentials.id }).from(agentCredentials).where(and(eq(agentCredentials.installationId, current.installationId), isNotNull(agentCredentials.lastUsedAt))).limit(1),
      tx.select({ id: agentSyncSessions.id }).from(agentSyncSessions).where(eq(agentSyncSessions.installationId, current.installationId)).limit(1),
      tx.select({ id: agentCommands.id }).from(agentCommands).where(and(eq(agentCommands.claimedInstallationId, current.installationId), ne(agentCommands.status, "expired"))).limit(1),
    ]);
    if (hasProtectedAgentHistory({
      usedCredential: Boolean(usedCredential[0]),
      syncSession: Boolean(sync[0]),
      claimedCommand: Boolean(claimed[0]),
    })) {
      throw new AgentAdminError("AGENT_HAS_HISTORY", "Agent นี้มีประวัติการใช้งาน กรุณาปิดใช้งานหรือทำเครื่องหมายว่าถูกแทนที่แทนการลบ");
    }
    await tx.delete(agentEnrollmentTokens).where(eq(agentEnrollmentTokens.targetInstallationId, current.installationId));
    await tx.delete(agentCredentials).where(eq(agentCredentials.installationId, current.installationId));
    await tx.delete(agentInstallations).where(eq(agentInstallations.installationId, current.installationId));
    await tx.insert(auditLogs).values({
      id: randomUUID(), actorUserId: input.actorUserId, effectiveFacilityId: input.facilityId,
      action: "agent.deleted", entityType: "agent_installation", entityId: current.installationId,
      beforeJson: { machineLabel: current.machineLabel, status: current.status },
    });
  });
}
