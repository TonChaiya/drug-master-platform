import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { agentCommands, agentCredentials, agentInstallations, agentSyncSessions, facilities } from "@/db/schema";
import { deriveInstallationState, summarizeAgentInstallations, type AgentInstallationSummary } from "./lifecycle";

export interface InstallationView {
  installationId: string;
  machineLabel: string;
  declaredOfficeId: string | null;
  status: string;
  agentVersion: string | null;
  lastSeenAt: Date | null;
  lastHeartbeatAt: Date | null;
  enrolledAt: Date | null;
  activeCredentials: number;
  lastMismatchOfficeId: string | null;
  lastMismatchAt: Date | null;
  enrolledBy: string | null;
  macAddress: string | null;
  ipAddress: string | null;
  supersededByInstallationId: string | null;
  presence: "online" | "offline";
  credentialStatus: "active" | "revoked";
  jhcisStatus: "connected" | "unreachable" | "unknown";
}

export async function agentFacilitySummaries(facilityId?: string): Promise<Map<string, AgentInstallationSummary>> {
  const installationScope = facilityId
    ? and(eq(facilities.status, "active"), eq(agentInstallations.facilityId, facilityId))
    : eq(facilities.status, "active");
  const credentialScope = facilityId
    ? and(eq(facilities.status, "active"), eq(agentInstallations.facilityId, facilityId), isNull(agentCredentials.revokedAt))
    : and(eq(facilities.status, "active"), isNull(agentCredentials.revokedAt));
  const [installations, credentials] = await Promise.all([
    db
      .select({
        installationId: agentInstallations.installationId,
        facilityId: agentInstallations.facilityId,
        facilityCode: facilities.facilityCode,
        registrationStatus: agentInstallations.status,
        lastSeenAt: agentInstallations.lastSeenAt,
        lastHeartbeatAt: agentInstallations.lastHeartbeatAt,
        jhcisConnected: agentInstallations.jhcisConnected,
        lastJhcisCheckAt: agentInstallations.lastJhcisCheckAt,
        declaredOfficeId: agentInstallations.declaredOfficeId,
      })
      .from(agentInstallations)
      .innerJoin(facilities, eq(facilities.id, agentInstallations.facilityId))
      .where(installationScope),
    db
      .select({ installationId: agentCredentials.installationId })
      .from(agentCredentials)
      .innerJoin(agentInstallations, eq(agentInstallations.installationId, agentCredentials.installationId))
      .innerJoin(facilities, eq(facilities.id, agentInstallations.facilityId))
      .where(credentialScope),
  ]);
  const activeCredentials = new Map<string, number>();
  for (const row of credentials) {
    activeCredentials.set(row.installationId, (activeCredentials.get(row.installationId) ?? 0) + 1);
  }
  const rowsByFacility = new Map<string, Parameters<typeof summarizeAgentInstallations>[0]>();
  for (const row of installations) {
    const rows = rowsByFacility.get(row.facilityId) ?? [];
    rowsByFacility.set(row.facilityId, rows);
    rows.push({
      registrationStatus: row.registrationStatus,
      activeCredentials: activeCredentials.get(row.installationId) ?? 0,
      lastSeenAt: row.lastSeenAt,
      lastHeartbeatAt: row.lastHeartbeatAt,
      jhcisConnected: row.jhcisConnected,
      lastJhcisCheckAt: row.lastJhcisCheckAt,
      mismatch: row.declaredOfficeId !== null && row.declaredOfficeId !== row.facilityCode,
    });
  }
  return new Map([...rowsByFacility].map(([id, rows]) => [id, summarizeAgentInstallations(rows)]));
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

  return installations.map((row) => {
    const activeCredentials = activeByInstallation.get(row.installationId) ?? 0;
    const state = deriveInstallationState({
      registrationStatus: row.status,
      activeCredentials,
      lastSeenAt: row.lastSeenAt,
      lastHeartbeatAt: row.lastHeartbeatAt,
      jhcisConnected: row.jhcisConnected,
      lastJhcisCheckAt: row.lastJhcisCheckAt,
    });
    return {
      installationId: row.installationId,
      machineLabel: row.machineLabel,
      declaredOfficeId: row.declaredOfficeId,
      status: row.status,
      agentVersion: row.agentVersion,
      lastSeenAt: row.lastSeenAt,
      lastHeartbeatAt: row.lastHeartbeatAt,
      enrolledAt: row.enrolledAt,
      activeCredentials,
      lastMismatchOfficeId: row.lastMismatchOfficeId,
      lastMismatchAt: row.lastMismatchAt,
      enrolledBy: row.enrolledBy,
      macAddress: row.macAddress,
      ipAddress: row.ipAddress,
      supersededByInstallationId: row.supersededByInstallationId,
      presence: state.presence,
      credentialStatus: state.credential,
      jhcisStatus: state.jhcis,
    };
  });
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
