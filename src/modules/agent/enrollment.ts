import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { agentCredentials, agentEnrollmentTokens, agentInstallations, auditLogs, facilities } from "@/db/schema";
import { encryptSecret } from "@/lib/crypto/secret-box";
import { agentErrors } from "./errors";
import type { EnrollRequest } from "./schemas";

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
export async function createEnrollment(facilityId: string, createdBy: string, appOrigin: string): Promise<EnrollmentLink> {
  const rows = await db.select({ facilityCode: facilities.facilityCode }).from(facilities).where(eq(facilities.id, facilityId)).limit(1);
  const facility = rows[0];
  if (!facility) throw agentErrors.enrollmentInvalid();

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ENROLLMENT_TTL_MS);
  await db.insert(agentEnrollmentTokens).values({
    id: randomUUID(),
    tokenHash: hashToken(token),
    facilityId,
    createdBy,
    expiresAt,
  });
  await db.insert(auditLogs).values({
    id: randomUUID(),
    actorUserId: createdBy,
    effectiveFacilityId: facilityId,
    action: "agent.enrollment_created",
    entityType: "facility",
    entityId: facilityId,
  });

  const params = new URLSearchParams({
    server: appOrigin,
    token,
    facility: facility.facilityCode,
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

    const existing = await tx
      .select({ installationId: agentInstallations.installationId })
      .from(agentInstallations)
      .where(eq(agentInstallations.installationId, input.installationId))
      .limit(1);

    if (existing.length > 0) {
      await tx
        .update(agentInstallations)
        .set({
          facilityId: enrollment.facilityId,
          machineLabel: input.machineLabel,
          declaredOfficeId: input.officeId,
          status: "active",
          agentVersion: input.agentVersion,
          enrolledAt: now,
          lastSeenAt: now,
        })
        .where(eq(agentInstallations.installationId, input.installationId));
    } else {
      await tx.insert(agentInstallations).values({
        installationId: input.installationId,
        facilityId: enrollment.facilityId,
        machineLabel: input.machineLabel,
        declaredOfficeId: input.officeId,
        status: "active",
        agentVersion: input.agentVersion,
        enrolledAt: now,
        lastSeenAt: now,
      });
    }

    const keyId = randomBytes(18).toString("base64url");
    const secret = randomBytes(32).toString("base64url");
    await tx.insert(agentCredentials).values({
      id: randomUUID(),
      installationId: input.installationId,
      publicKeyId: keyId,
      encryptedSecret: encryptSecret(secret),
    });

    // Older credentials for THIS installation stay active until the agent proves
    // it stored the new one (first successful signed request) — see
    // retireSupersededCredentials in ./auth-lifecycle.ts. Credentials belonging
    // to other installations in the same facility are never touched.

    await tx.update(agentEnrollmentTokens).set({ consumedAt: now }).where(eq(agentEnrollmentTokens.id, enrollment.tokenId));
    await tx.insert(auditLogs).values({
      id: randomUUID(),
      actorUserId: enrollment.createdBy,
      effectiveFacilityId: enrollment.facilityId,
      action: "agent.enrolled",
      entityType: "agent_installation",
      entityId: input.installationId,
      afterJson: { machineLabel: input.machineLabel, agentVersion: input.agentVersion, keyId },
    });

    return { keyId, secret, facilityCode: enrollment.facilityCode, installationId: input.installationId };
  });
}
