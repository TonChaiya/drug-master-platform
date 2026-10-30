import { eq, lt } from "drizzle-orm";
import { db } from "@/db/client";
import { agentCredentials, agentInstallations, agentRequestNonces, facilities } from "@/db/schema";
import { constantTimeTextEqual, decryptSecret } from "@/lib/crypto/secret-box";
import { retireSupersededCredentials } from "./auth-lifecycle";
import { agentErrors } from "./errors";
import { AGENT_PROTOCOL_VERSION, nonceHash, signRequest } from "./signature";

const MAX_CLOCK_SKEW_SECONDS = 300;
const NONCE_PATTERN = /^[a-f0-9]{32,64}$/;
const SIGNATURE_PATTERN = /^[a-f0-9]{64}$/;
const KEY_PATTERN = /^[A-Za-z0-9_-]{16,96}$/;

export interface AgentIdentity {
  credentialId: string;
  installationId: string;
  facilityId: string;
  facilityCode: string;
}

/**
 * Verifies an agent request end to end: header shape, clock skew, credential
 * lookup, HMAC over the exact body bytes, and single-use nonce. Every failure
 * returns a generic message so callers cannot probe which key exists.
 */
export async function verifyAgentRequest(request: Request, path: string, body: Uint8Array): Promise<AgentIdentity> {
  if (request.headers.get("x-agent-protocol") !== AGENT_PROTOCOL_VERSION) throw agentErrors.protocolUnsupported();

  const keyId = request.headers.get("x-agent-key")?.trim() ?? "";
  const timestamp = request.headers.get("x-agent-timestamp")?.trim() ?? "";
  const nonce = request.headers.get("x-agent-nonce")?.trim() ?? "";
  const signature = request.headers.get("x-agent-signature")?.trim() ?? "";
  if (!keyId || !timestamp || !nonce || !signature) throw agentErrors.authMissing();
  if (!KEY_PATTERN.test(keyId)) throw agentErrors.keyUnknown();
  if (!NONCE_PATTERN.test(nonce)) throw agentErrors.nonceInvalid();
  if (!SIGNATURE_PATTERN.test(signature)) throw agentErrors.signatureInvalid();

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!/^\d{10}$/.test(timestamp) || Math.abs(nowSeconds - Number(timestamp)) > MAX_CLOCK_SKEW_SECONDS) {
    throw agentErrors.timestampInvalid();
  }

  const rows = await db
    .select({
      credentialId: agentCredentials.id,
      encryptedSecret: agentCredentials.encryptedSecret,
      revokedAt: agentCredentials.revokedAt,
      installationId: agentInstallations.installationId,
      installationStatus: agentInstallations.status,
      facilityId: facilities.id,
      facilityCode: facilities.facilityCode,
      facilityStatus: facilities.status,
    })
    .from(agentCredentials)
    .innerJoin(agentInstallations, eq(agentInstallations.installationId, agentCredentials.installationId))
    .innerJoin(facilities, eq(facilities.id, agentInstallations.facilityId))
    .where(eq(agentCredentials.publicKeyId, keyId))
    .limit(1);

  const row = rows[0];
  if (!row) throw agentErrors.keyUnknown();
  if (row.revokedAt) throw agentErrors.credentialRevoked();
  if (row.installationStatus !== "active") throw agentErrors.installationInactive();
  if (row.facilityStatus !== "active") throw agentErrors.facilityInactive();

  const expected = signRequest(decryptSecret(row.encryptedSecret), { method: "POST", path, timestamp, nonce, body });
  if (!constantTimeTextEqual(signature, expected)) throw agentErrors.signatureInvalid();

  await claimNonce(row.credentialId, nonce, new Date((Number(timestamp) + MAX_CLOCK_SKEW_SECONDS) * 1000));
  await db.update(agentCredentials).set({ lastUsedAt: new Date() }).where(eq(agentCredentials.id, row.credentialId));
  await db.update(agentInstallations).set({ lastSeenAt: new Date() }).where(eq(agentInstallations.installationId, row.installationId));
  // A signed request proves the agent stored this secret, which is the trigger
  // to retire the credential it replaced.
  await retireSupersededCredentials(row.installationId, row.credentialId);

  return {
    credentialId: row.credentialId,
    installationId: row.installationId,
    facilityId: row.facilityId,
    facilityCode: row.facilityCode,
  };
}

/** Inserts the nonce; a duplicate-key error means the request is a replay. */
async function claimNonce(credentialId: string, nonce: string, expiresAt: Date): Promise<void> {
  try {
    await db.insert(agentRequestNonces).values({ credentialId, nonceHash: nonceHash(credentialId, nonce), expiresAt });
  } catch {
    throw agentErrors.nonceReplayed();
  }
}

export async function purgeExpiredNonces(): Promise<number> {
  const [result] = await db.delete(agentRequestNonces).where(lt(agentRequestNonces.expiresAt, new Date()));
  return result.affectedRows;
}

/**
 * The agent declares its own installation id in every body. It must match the
 * installation the credential was issued to, otherwise one facility's key could
 * be pointed at another installation.
 */
export function assertInstallation(identity: AgentIdentity, declaredInstallationId: string): void {
  if (identity.installationId !== declaredInstallationId) throw agentErrors.installationInactive();
}

/**
 * office.offid read from JHCIS must equal the facility code the credential
 * belongs to.
 *
 * The rejection is also written to the installation so the web can say so: the
 * person signed in at that facility is the one who has to fix the pairing, and
 * they never see the tray's error message.
 */
export async function assertOffice(identity: AgentIdentity, officeId: string): Promise<void> {
  if (constantTimeTextEqual(officeId, identity.facilityCode)) return;
  await db
    .update(agentInstallations)
    .set({ lastMismatchOfficeId: officeId.slice(0, 8), lastMismatchAt: new Date() })
    .where(eq(agentInstallations.installationId, identity.installationId));
  throw agentErrors.officeMismatch();
}

/** Clears the mismatch flag once the agent reports the right office again. */
export async function clearOfficeMismatch(installationId: string): Promise<void> {
  await db
    .update(agentInstallations)
    .set({ lastMismatchOfficeId: null, lastMismatchAt: null })
    .where(eq(agentInstallations.installationId, installationId));
}

export async function touchInstallation(
  installationId: string,
  agentVersion: string,
  officeId?: string | null,
  macAddress?: string | null,
): Promise<void> {
  await db
    .update(agentInstallations)
    .set({
      lastSeenAt: new Date(),
      agentVersion,
      ...(officeId ? { declaredOfficeId: officeId } : {}),
      // Only overwrite when the agent reported one: an older build sends
      // nothing, and blanking what we already know would be a step backwards.
      ...(macAddress ? { macAddress } : {}),
    })
    .where(eq(agentInstallations.installationId, installationId));
}

export async function recordHeartbeat(
  installationId: string,
  input: { jhcisConnected: boolean; ipAddress?: string | null },
): Promise<void> {
  const now = new Date();
  await db
    .update(agentInstallations)
    .set({
      lastHeartbeatAt: now,
      lastJhcisCheckAt: now,
      jhcisConnected: input.jhcisConnected,
      ...(input.ipAddress ? { ipAddress: input.ipAddress } : {}),
    })
    .where(eq(agentInstallations.installationId, installationId));
}
