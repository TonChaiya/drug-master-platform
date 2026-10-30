export const AGENT_FRESHNESS_MS = 90_000;

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
