import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt, isNull, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { agentCredentials, agentEnrollmentTokens, agentInstallations, auditLogs, facilities } from "@/db/schema";
import { encryptSecret } from "@/lib/crypto/secret-box";
import { agentErrors } from "./errors";
import type { EnrollRequest } from "./schemas";
import { resolveCanonicalInstallation } from "./lifecycle";

const ENROLLMENT_TTL_MS = 10 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface EnrollmentLink {
  token: string;
  expiresAt: Date;
  protocolUrl: string;
}

/**
 * Issues a short-lived enrollment token for one facility. The raw token is
 * returned once and only its hash is stored.
 */
export async function createEnrollment(
  facilityId: string,
  createdBy: string,
  appOrigin: string,
  targetInstallationId: string | null = null,
): Promise<EnrollmentLink> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ENROLLMENT_TTL_MS);
  const facilityCode = await db.transaction(async (tx) => {
    const rows = await tx.select({ facilityCode: facilities.facilityCode }).from(facilities).where(eq(facilities.id, facilityId)).limit(1);
    const facility = rows[0];
    if (!facility) throw agentErrors.enrollmentInvalid();
    if (targetInstallationId) {
      const target = await tx
        .select({ installationId: agentInstallations.installationId })
        .from(agentInstallations)
        .where(and(eq(agentInstallations.installationId, targetInstallationId), eq(agentInstallations.facilityId, facilityId)))
        .limit(1);
      if (!target[0]) throw agentErrors.enrollmentInvalid();
    }
    await tx.insert(agentEnrollmentTokens).values({
      id: randomUUID(), tokenHash: hashToken(token), facilityId, createdBy, expiresAt, targetInstallationId,
    });
    await tx.insert(auditLogs).values({
      id: randomUUID(), actorUserId: createdBy, effectiveFacilityId: facilityId,
      action: "agent.enrollment_created", entityType: "facility", entityId: facilityId,
      afterJson: targetInstallationId ? { targetInstallationId } : null,
    });
    return facility.facilityCode;
  });

  const params = new URLSearchParams({
    server: appOrigin,
    token,
    facility: facilityCode,
  });
  return { token, expiresAt, protocolUrl: `tmtagent://enroll?${params.toString()}` };
}

export interface IssuedCredential {
  keyId: string;
  secret: string;
  facilityCode: string;
  installationId: string;
}

/**
 * Redeems an enrollment token and issues a fresh credential for the
 * installation. Reconnect is supported: the same installationId may re-enroll
 * (possibly into another facility) and the old credential is revoked only
 * after the new one is written, per docs/OPERATIONS.md. Credentials of
 * OTHER installations in the same facility are never touched.
 */
export async function redeemEnrollment(input: EnrollRequest): Promise<IssuedCredential> {
  const now = new Date();
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        tokenId: agentEnrollmentTokens.id,
        facilityId: agentEnrollmentTokens.facilityId,
        createdBy: agentEnrollmentTokens.createdBy,
        targetInstallationId: agentEnrollmentTokens.targetInstallationId,
        facilityCode: facilities.facilityCode,
        facilityStatus: facilities.status,
      })
      .from(agentEnrollmentTokens)
      .innerJoin(facilities, eq(facilities.id, agentEnrollmentTokens.facilityId))
      .where(
        and(
          eq(agentEnrollmentTokens.tokenHash, hashToken(input.enrollmentToken)),
          isNull(agentEnrollmentTokens.consumedAt),
          gt(agentEnrollmentTokens.expiresAt, now),
        ),
      )
      .limit(1);

    const enrollment = rows[0];
    if (!enrollment) throw agentErrors.enrollmentInvalid();
    if (enrollment.facilityStatus !== "active") throw agentErrors.facilityInactive();
    // The agent must have read office.offid and it must match this facility.
    if (enrollment.facilityCode !== input.officeId) throw agentErrors.officeMismatch();

    const installationId = resolveCanonicalInstallation({
      requestedInstallationId: input.installationId,
      targetInstallationId: enrollment.targetInstallationId,
    });

    if (enrollment.targetInstallationId) {
      const target = await tx
        .select({ installationId: agentInstallations.installationId })
        .from(agentInstallations)
        .where(and(eq(agentInstallations.installationId, installationId), eq(agentInstallations.facilityId, enrollment.facilityId)))
        .limit(1);
      if (!target[0]) throw agentErrors.enrollmentInvalid();
    } else if (input.macAddress) {
      const duplicate = await tx
        .select({ installationId: agentInstallations.installationId })
        .from(agentInstallations)
        .where(
          and(
            eq(agentInstallations.facilityId, enrollment.facilityId),
            eq(agentInstallations.status, "active"),
            eq(agentInstallations.machineLabel, input.machineLabel),
            eq(agentInstallations.macAddress, input.macAddress),
            ne(agentInstallations.installationId, installationId),
          ),
        )
        .limit(1);
      if (duplicate[0]) throw agentErrors.possibleDuplicate();
    }

    const [consumed] = await tx
      .update(agentEnrollmentTokens)
      .set({ consumedAt: now })
      .where(and(eq(agentEnrollmentTokens.id, enrollment.tokenId), isNull(agentEnrollmentTokens.consumedAt)));
    if (consumed.affectedRows !== 1) throw agentErrors.enrollmentInvalid();

    const existing = await tx
      .select({ installationId: agentInstallations.installationId })
      .from(agentInstallations)
      .where(eq(agentInstallations.installationId, installationId))
      .limit(1);

    if (existing.length > 0) {
      await tx
        .update(agentInstallations)
        .set({
          facilityId: enrollment.facilityId,
          machineLabel: input.machineLabel,
          declaredOfficeId: input.officeId,
          status: "active",
          supersededByInstallationId: null,
          agentVersion: input.agentVersion,
          // Re-enrolling hands the machine to whoever issued the new link.
          enrolledBy: enrollment.createdBy,
          macAddress: input.macAddress ?? null,
          enrolledAt: now,
          lastSeenAt: now,
          lastHeartbeatAt: null,
          lastJhcisCheckAt: null,
          jhcisConnected: null,
        })
        .where(eq(agentInstallations.installationId, installationId));
    } else {
      await tx.insert(agentInstallations).values({
        installationId,
        facilityId: enrollment.facilityId,
        machineLabel: input.machineLabel,
        declaredOfficeId: input.officeId,
        status: "active",
        agentVersion: input.agentVersion,
        enrolledBy: enrollment.createdBy,
        macAddress: input.macAddress ?? null,
        enrolledAt: now,
        lastSeenAt: now,
      });
    }

    const keyId = randomBytes(18).toString("base64url");
    const secret = randomBytes(32).toString("base64url");
    const credentialId = randomUUID();
    await tx
      .update(agentCredentials)
      .set({ supersededByCredentialId: credentialId })
      .where(and(eq(agentCredentials.installationId, installationId), isNull(agentCredentials.revokedAt)));
    await tx.insert(agentCredentials).values({
      id: credentialId,
      installationId,
      publicKeyId: keyId,
      encryptedSecret: encryptSecret(secret),
    });

    // Older credentials for THIS installation stay active until the agent proves
    // it stored the new one (first successful signed request) — see
    // retireSupersededCredentials in ./auth-lifecycle.ts. Credentials belonging
    // to other installations in the same facility are never touched.

    await tx.insert(auditLogs).values({
      id: randomUUID(),
      actorUserId: enrollment.createdBy,
      effectiveFacilityId: enrollment.facilityId,
      action: "agent.enrolled",
      entityType: "agent_installation",
      entityId: installationId,
      afterJson: { machineLabel: input.machineLabel, agentVersion: input.agentVersion, keyId },
    });

    return { keyId, secret, facilityCode: enrollment.facilityCode, installationId };
  });
}
