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
}

export async function listInstallations(facilityId: string): Promise<InstallationView[]> {
  const installations = await db
    .select()
    .from(agentInstallations)
    .where(eq(agentInstallations.facilityId, facilityId))
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
