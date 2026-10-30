import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { agentCredentials } from "@/db/schema";

/**
 * Reconnect safety net. docs/OPERATIONS.md requires the new credential to be
 * issued first and the previous one revoked only once the agent has confirmed it
 * stored the new secret. A successful signed request IS that confirmation, so we
 * retire only credentials explicitly replaced by the key that just proved
 * itself. The replacement link is deterministic even when createdAt values
 * collide, and never affects another installation.
 */
export async function retireSupersededCredentials(installationId: string, activeCredentialId: string): Promise<number> {
  const [result] = await db
    .update(agentCredentials)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(agentCredentials.installationId, installationId),
        eq(agentCredentials.supersededByCredentialId, activeCredentialId),
        isNull(agentCredentials.revokedAt),
      ),
    );
  return result.affectedRows;
}
