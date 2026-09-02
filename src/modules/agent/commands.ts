import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNull, lt, or } from "drizzle-orm";
import { db } from "@/db/client";
import { agentCommands, auditLogs } from "@/db/schema";
import { agentErrors } from "./errors";
import type { AgentIdentity } from "./auth";

export const COMMAND_TYPES = ["sync_now", "test_connection", "refresh_config", "upgrade_notice"] as const;
export type CommandType = (typeof COMMAND_TYPES)[number];

const COMMAND_TTL_MS = 30 * 60 * 1000;
const CLAIM_TTL_MS = 20 * 60 * 1000;

export interface QueuedCommand {
  id: string;
  commandType: CommandType;
  payload: unknown;
  claimToken: string;
}

/**
 * Queues one command per facility+idempotencyKey. Re-queueing while a pending or
 * claimed command with the same key exists returns the existing one instead of
 * stacking duplicates.
 */
export async function queueCommand(
  facilityId: string,
  commandType: CommandType,
  requestedBy: string,
  payload?: Record<string, unknown>,
): Promise<string> {
  const existing = await db
    .select({ id: agentCommands.id })
    .from(agentCommands)
    .where(
      and(
        eq(agentCommands.facilityId, facilityId),
        eq(agentCommands.commandType, commandType),
        or(eq(agentCommands.status, "pending"), eq(agentCommands.status, "claimed")),
      ),
    )
    .limit(1);
  if (existing[0]) return existing[0].id;

  const id = randomUUID();
  await db.insert(agentCommands).values({
    id,
    facilityId,
    commandType,
    payloadJson: payload ?? null,
    status: "pending",
    idempotencyKey: `${commandType}:${id}`,
    requestedBy,
    expiresAt: new Date(Date.now() + COMMAND_TTL_MS),
  });
  await db.insert(auditLogs).values({
    id: randomUUID(),
    actorUserId: requestedBy,
    effectiveFacilityId: facilityId,
    action: "agent.command_queued",
    entityType: "agent_command",
    entityId: id,
    afterJson: { commandType },
  });
  return id;
}

/** Expires stale work so a crashed agent cannot hold a command forever. */
async function releaseExpired(facilityId: string): Promise<void> {
  const now = new Date();
  await db
    .update(agentCommands)
    .set({ status: "expired", finishedAt: now, resultCode: "EXPIRED" })
    .where(and(eq(agentCommands.facilityId, facilityId), eq(agentCommands.status, "pending"), lt(agentCommands.expiresAt, now)));
  await db
    .update(agentCommands)
    .set({ status: "pending", claimToken: null, claimedInstallationId: null, claimedAt: null })
    .where(
      and(
        eq(agentCommands.facilityId, facilityId),
        eq(agentCommands.status, "claimed"),
        lt(agentCommands.claimedAt, new Date(Date.now() - CLAIM_TTL_MS)),
      ),
    );
}

/**
 * Atomically claims the oldest pending command for this facility. The claim is a
 * conditional UPDATE, so two agents polling at once cannot both win the row.
 */
export async function claimNextCommand(identity: AgentIdentity): Promise<QueuedCommand | null> {
  await releaseExpired(identity.facilityId);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const candidates = await db
      .select({ id: agentCommands.id, commandType: agentCommands.commandType, payloadJson: agentCommands.payloadJson })
      .from(agentCommands)
      .where(and(eq(agentCommands.facilityId, identity.facilityId), eq(agentCommands.status, "pending")))
      .orderBy(asc(agentCommands.createdAt))
      .limit(1);
    const candidate = candidates[0];
    if (!candidate) return null;

    const claimToken = randomUUID();
    const [result] = await db
      .update(agentCommands)
      .set({
        status: "claimed",
        claimToken,
        claimedInstallationId: identity.installationId,
        claimedAt: new Date(),
      })
      .where(and(eq(agentCommands.id, candidate.id), eq(agentCommands.status, "pending"), isNull(agentCommands.claimToken)));

    if (result.affectedRows === 1) {
      return {
        id: candidate.id,
        commandType: candidate.commandType as CommandType,
        payload: candidate.payloadJson ?? null,
        claimToken,
      };
    }
  }
  return null;
}

export async function completeCommand(
  identity: AgentIdentity,
  commandId: string,
  claimToken: string,
  success: boolean,
  resultCode?: string,
  resultMessage?: string,
): Promise<void> {
  const [result] = await db
    .update(agentCommands)
    .set({
      status: success ? "succeeded" : "failed",
      resultCode: resultCode?.slice(0, 48) ?? (success ? "OK" : "FAILED"),
      resultMessage: resultMessage?.slice(0, 500) ?? null,
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(agentCommands.id, commandId),
        eq(agentCommands.facilityId, identity.facilityId),
        eq(agentCommands.status, "claimed"),
        eq(agentCommands.claimToken, claimToken),
        eq(agentCommands.claimedInstallationId, identity.installationId),
      ),
    );
  if (result.affectedRows !== 1) throw agentErrors.commandInvalid();
}

export async function latestCommand(facilityId: string) {
  const rows = await db
    .select()
    .from(agentCommands)
    .where(eq(agentCommands.facilityId, facilityId))
    .orderBy(desc(agentCommands.createdAt))
    .limit(1);
  return rows[0] ?? null;
}
