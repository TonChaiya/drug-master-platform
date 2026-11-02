export const AGENT_FRESHNESS_MS = 90_000;

export interface AgentInstallationSummaryInput {
  registrationStatus: string;
  activeCredentials: number;
  lastSeenAt: Date | null;
  lastHeartbeatAt: Date | null;
  jhcisConnected: boolean | null;
  lastJhcisCheckAt: Date | null;
  mismatch: boolean;
}

export interface AgentInstallationSummary {
  installationCount: number;
  agentCount: number;
  disabledAgentCount: number;
  supersededAgentCount: number;
  usableAgentCount: number;
  onlineAgentCount: number;
  offlineAgentCount: number;
  jhcisConnectedCount: number;
  jhcisUnreachableCount: number;
  jhcisUnknownCount: number;
  agentMismatchCount: number;
}

export function resolveCanonicalInstallation(input: {
  requestedInstallationId: string;
  targetInstallationId: string | null;
}): string {
  return input.targetInstallationId ?? input.requestedInstallationId;
}

export function deriveInstallationState(input: {
  registrationStatus: string;
  activeCredentials: number;
  lastSeenAt: Date | null;
  lastHeartbeatAt: Date | null;
  jhcisConnected: boolean | null;
  lastJhcisCheckAt: Date | null;
  now?: Date;
}): {
  presence: "online" | "offline";
  credential: "active" | "revoked";
  jhcis: "connected" | "unreachable" | "unknown";
} {
  const now = input.now ?? new Date();
  const fresh = (value: Date | null) => Boolean(value && now.getTime() - value.getTime() <= AGENT_FRESHNESS_MS);
  const enabled = input.registrationStatus === "active";
  const presence = enabled && input.activeCredentials > 0 && fresh(input.lastHeartbeatAt) ? "online" : "offline";
  const credential = enabled && input.activeCredentials > 0 ? "active" : "revoked";
  const jhcis =
    enabled && fresh(input.lastHeartbeatAt) && fresh(input.lastJhcisCheckAt) && input.jhcisConnected !== null
      ? input.jhcisConnected
        ? "connected"
        : "unreachable"
      : "unknown";
  return { presence, credential, jhcis };
}

export function summarizeAgentInstallations(
  rows: AgentInstallationSummaryInput[],
  now = new Date(),
): AgentInstallationSummary {
  const summary: AgentInstallationSummary = {
    installationCount: rows.length,
    agentCount: 0,
    disabledAgentCount: 0,
    supersededAgentCount: 0,
    usableAgentCount: 0,
    onlineAgentCount: 0,
    offlineAgentCount: 0,
    jhcisConnectedCount: 0,
    jhcisUnreachableCount: 0,
    jhcisUnknownCount: 0,
    agentMismatchCount: 0,
  };
  for (const row of rows) {
    if (row.registrationStatus === "disabled") summary.disabledAgentCount += 1;
    if (row.registrationStatus === "superseded") summary.supersededAgentCount += 1;
    if (row.registrationStatus !== "active") continue;
    summary.agentCount += 1;
    if (row.mismatch) summary.agentMismatchCount += 1;
    if (row.activeCredentials > 0 && !row.mismatch) summary.usableAgentCount += 1;
    const state = deriveInstallationState({ ...row, now });
    if (state.presence === "online") summary.onlineAgentCount += 1;
    else summary.offlineAgentCount += 1;
    if (state.jhcis === "connected") summary.jhcisConnectedCount += 1;
    if (state.jhcis === "unreachable") summary.jhcisUnreachableCount += 1;
    if (state.jhcis === "unknown") summary.jhcisUnknownCount += 1;
  }
  return summary;
}
