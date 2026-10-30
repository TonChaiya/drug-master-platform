import { test } from "vitest";
import { strict as assert } from "node:assert";
import { deriveInstallationState, resolveCanonicalInstallation } from "@/modules/agent/lifecycle";
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
