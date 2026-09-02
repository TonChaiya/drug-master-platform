import { and, eq, isNull, lt, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { agentCredentials } from "@/db/schema";

/**
 * Reconnect safety net. docs/OPERATIONS.md requires the new credential to be
 * issued first and the previous one revoked only once the agent has confirmed it
 * stored the new secret. A successful signed request IS that confirmation, so we
 * retire every older active credential of the SAME installation here — never
 * credentials of other installations in the facility.
 */
export async function retireSupersededCredentials(installationId: string, activeCredentialId: string): Promise<number> {
  const rows = await db
    .select({ createdAt: agentCredentials.createdAt })
    .from(agentCredentials)
    .where(eq(agentCredentials.id, activeCredentialId))
    .limit(1);
  const current = rows[0];
  if (!current) return 0;

  const [result] = await db
    .update(agentCredentials)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(agentCredentials.installationId, installationId),
        ne(agentCredentials.id, activeCredentialId),
        isNull(agentCredentials.revokedAt),
        lt(agentCredentials.createdAt, current.createdAt),
      ),
    );
  return result.affectedRows;
}
