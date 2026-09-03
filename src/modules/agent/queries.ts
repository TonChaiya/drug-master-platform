import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { agentCommands, agentCredentials, agentInstallations, agentSyncSessions } from "@/db/schema";

export interface InstallationView {
  installationId: string;
  machineLabel: string;
  declaredOfficeId: string | null;
  status: string;
  agentVersion: string | null;
  lastSeenAt: Date | null;
  enrolledAt: Date | null;
  activeCredentials: number;
  lastMismatchOfficeId: string | null;
  lastMismatchAt: Date | null;
  enrolledBy: string | null;
  macAddress: string | null;
}

/**
 * Machines registered against a facility.
 *
 * `enrolledBy` narrows it to the account that registered them: several accounts
 * share a facility, and a user managing their own machine has no business
 * revoking or re-syncing a colleague's. An admin passes nothing and sees all.
 */
export async function listInstallations(facilityId: string, enrolledBy?: string): Promise<InstallationView[]> {
  const scope = enrolledBy
    ? and(eq(agentInstallations.facilityId, facilityId), eq(agentInstallations.enrolledBy, enrolledBy))
    : eq(agentInstallations.facilityId, facilityId);

  const installations = await db
    .select()
    .from(agentInstallations)
    .where(scope)
    .orderBy(desc(agentInstallations.lastSeenAt));

  const credentials = await db
    .select({ installationId: agentCredentials.installationId })
    .from(agentCredentials)
    .innerJoin(agentInstallations, eq(agentInstallations.installationId, agentCredentials.installationId))
    .where(and(eq(agentInstallations.facilityId, facilityId), isNull(agentCredentials.revokedAt)));

  const activeByInstallation = new Map<string, number>();
  for (const row of credentials) {
    activeByInstallation.set(row.installationId, (activeByInstallation.get(row.installationId) ?? 0) + 1);
  }

  return installations.map((row) => ({
    installationId: row.installationId,
    machineLabel: row.machineLabel,
    declaredOfficeId: row.declaredOfficeId,
    status: row.status,
    agentVersion: row.agentVersion,
    lastSeenAt: row.lastSeenAt,
    enrolledAt: row.enrolledAt,
    activeCredentials: activeByInstallation.get(row.installationId) ?? 0,
    lastMismatchOfficeId: row.lastMismatchOfficeId,
    lastMismatchAt: row.lastMismatchAt,
    enrolledBy: row.enrolledBy,
    macAddress: row.macAddress,
  }));
}

export async function recentSyncSessions(facilityId: string, limit = 8) {
  return db
    .select()
    .from(agentSyncSessions)
    .where(eq(agentSyncSessions.facilityId, facilityId))
    .orderBy(desc(agentSyncSessions.startedAt))
    .limit(limit);
}

export async function recentCommands(facilityId: string, limit = 8) {
  return db
    .select()
    .from(agentCommands)
    .where(eq(agentCommands.facilityId, facilityId))
    .orderBy(desc(agentCommands.createdAt))
    .limit(limit);
}
