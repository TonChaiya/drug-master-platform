import { test } from "vitest";
import { strict as assert } from "node:assert";
import { deriveInstallationState, resolveCanonicalInstallation, summarizeAgentInstallations } from "@/modules/agent/lifecycle";
import { hasProtectedAgentHistory } from "@/modules/agent/admin";
import { pollRequestSchema } from "@/modules/agent/schemas";

test("target re-enrollment keeps the selected canonical installation", () => {
  assert.equal(
    resolveCanonicalInstallation({ requestedInstallationId: "new-id", targetInstallationId: "old-id" }),
    "old-id",
  );
});

test("ordinary enrollment uses the machine installation id", () => {
  assert.equal(
    resolveCanonicalInstallation({ requestedInstallationId: "machine-id", targetInstallationId: null }),
    "machine-id",
  );
});

test("fresh active agent can be online while JHCIS is unreachable", () => {
  const now = new Date("2026-10-30T10:00:00.000Z");
  assert.deepEqual(
    deriveInstallationState({
      registrationStatus: "active",
      activeCredentials: 1,
      lastSeenAt: new Date("2026-10-30T09:59:30.000Z"),
      lastHeartbeatAt: new Date("2026-10-30T09:59:30.000Z"),
      jhcisConnected: false,
      lastJhcisCheckAt: new Date("2026-10-30T09:59:30.000Z"),
      now,
    }),
    { presence: "online", credential: "active", jhcis: "unreachable" },
  );
});

test("disabled and superseded registrations never appear online", () => {
  const now = new Date("2026-10-30T10:00:00.000Z");
  for (const registrationStatus of ["disabled", "superseded"]) {
    assert.deepEqual(
      deriveInstallationState({
        registrationStatus,
        activeCredentials: 1,
        lastSeenAt: now,
        lastHeartbeatAt: now,
        jhcisConnected: true,
        lastJhcisCheckAt: now,
        now,
      }),
      { presence: "offline", credential: "revoked", jhcis: "unknown" },
    );
  }
});

test("stale heartbeat makes JHCIS state unknown", () => {
  const now = new Date("2026-10-30T10:00:00.000Z");
  const state = deriveInstallationState({
    registrationStatus: "active",
    activeCredentials: 0,
    lastSeenAt: new Date("2026-10-30T09:55:00.000Z"),
    lastHeartbeatAt: new Date("2026-10-30T09:55:00.000Z"),
    jhcisConnected: true,
    lastJhcisCheckAt: new Date("2026-10-30T09:55:00.000Z"),
    now,
  });
  assert.deepEqual(state, { presence: "offline", credential: "revoked", jhcis: "unknown" });
});

test("admin summary separates connected, unreachable, offline, disabled and mismatched Agents", () => {
  const now = new Date("2026-10-30T10:00:00.000Z");
  const fresh = new Date("2026-10-30T09:59:30.000Z");
  const stale = new Date("2026-10-30T09:55:00.000Z");
  const summary = summarizeAgentInstallations(
    [
      { registrationStatus: "active", activeCredentials: 1, lastHeartbeatAt: fresh, lastSeenAt: fresh, jhcisConnected: true, lastJhcisCheckAt: fresh, mismatch: false },
      { registrationStatus: "active", activeCredentials: 1, lastHeartbeatAt: fresh, lastSeenAt: fresh, jhcisConnected: false, lastJhcisCheckAt: fresh, mismatch: false },
      { registrationStatus: "active", activeCredentials: 1, lastHeartbeatAt: stale, lastSeenAt: stale, jhcisConnected: true, lastJhcisCheckAt: stale, mismatch: false },
      { registrationStatus: "disabled", activeCredentials: 1, lastHeartbeatAt: fresh, lastSeenAt: fresh, jhcisConnected: true, lastJhcisCheckAt: fresh, mismatch: false },
      { registrationStatus: "superseded", activeCredentials: 1, lastHeartbeatAt: fresh, lastSeenAt: fresh, jhcisConnected: true, lastJhcisCheckAt: fresh, mismatch: false },
      { registrationStatus: "active", activeCredentials: 1, lastHeartbeatAt: fresh, lastSeenAt: fresh, jhcisConnected: true, lastJhcisCheckAt: fresh, mismatch: true },
    ],
    now,
  );
  assert.deepEqual(summary, {
    installationCount: 6,
    agentCount: 4,
    disabledAgentCount: 1,
    supersededAgentCount: 1,
    usableAgentCount: 3,
    onlineAgentCount: 3,
    offlineAgentCount: 1,
    jhcisConnectedCount: 2,
    jhcisUnreachableCount: 1,
    jhcisUnknownCount: 1,
    agentMismatchCount: 1,
  });
});

test("active registration without active credential is unusable and offline", () => {
  const now = new Date("2026-10-30T10:00:00.000Z");
  const summary = summarizeAgentInstallations(
    [{ registrationStatus: "active", activeCredentials: 0, lastHeartbeatAt: now, lastSeenAt: now, jhcisConnected: true, lastJhcisCheckAt: now, mismatch: false }],
    now,
  );
  assert.equal(summary.agentCount, 1);
  assert.equal(summary.usableAgentCount, 0);
  assert.equal(summary.onlineAgentCount, 0);
  assert.equal(summary.offlineAgentCount, 1);
});

test("online Agent with stale JHCIS check remains unknown, not connected or unreachable", () => {
  const now = new Date("2026-10-30T10:00:00.000Z");
  const summary = summarizeAgentInstallations(
    [{
      registrationStatus: "active",
      activeCredentials: 1,
      lastHeartbeatAt: now,
      lastSeenAt: now,
      jhcisConnected: true,
      lastJhcisCheckAt: new Date("2026-10-30T09:55:00.000Z"),
      mismatch: false,
    }],
    now,
  );
  assert.equal(summary.onlineAgentCount, 1);
  assert.equal(summary.jhcisConnectedCount, 0);
  assert.equal(summary.jhcisUnreachableCount, 0);
  assert.equal(summary.jhcisUnknownCount, 1);
});

test("heartbeat can report Agent online while JHCIS has no office id", () => {
  const parsed = pollRequestSchema.safeParse({
    installationId: "11111111-1111-4111-8111-111111111111",
    agentVersion: "1.2.3",
    officeId: null,
    macAddress: null,
    ipAddress: "192.0.2.10",
    jhcisConnected: false,
  });
  assert.equal(parsed.success, true);
});

test("legacy poll remains compatible and implies JHCIS connected", () => {
  const parsed = pollRequestSchema.safeParse({
    installationId: "11111111-1111-4111-8111-111111111111",
    agentVersion: "1.2.3",
    officeId: "05957",
  });
  assert.equal(parsed.success, true);
  if (parsed.success) assert.equal(parsed.data.jhcisConnected, true);
});

test("poll cannot claim commands without either an office id or explicit JHCIS failure", () => {
  const parsed = pollRequestSchema.safeParse({
    installationId: "11111111-1111-4111-8111-111111111111",
    agentVersion: "1.2.3",
  });
  assert.equal(parsed.success, false);
});

test("hard delete is rejected for every protected history kind", () => {
  assert.equal(hasProtectedAgentHistory({ usedCredential: false, syncSession: false, claimedCommand: false }), false);
  assert.equal(hasProtectedAgentHistory({ usedCredential: true, syncSession: false, claimedCommand: false }), true);
  assert.equal(hasProtectedAgentHistory({ usedCredential: false, syncSession: true, claimedCommand: false }), true);
  assert.equal(hasProtectedAgentHistory({ usedCredential: false, syncSession: false, claimedCommand: true }), true);
});
