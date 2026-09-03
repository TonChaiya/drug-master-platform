import { randomUUID } from "node:crypto";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { agentSyncSessions, agentSyncStaging, auditLogs, sourceDrugs } from "@/db/schema";
import { agentErrors } from "./errors";
import type { AgentIdentity } from "./auth";
import type { SourceRow } from "./schemas";

const MAX_EXPECTED_ROWS = 200_000;
/** Rows per upsert statement. Each statement is one round trip to TiDB. */
const UPSERT_CHUNK = 500;

/** Opens a receiving session. Nothing reaches source_drugs until finish() succeeds. */
export async function beginSync(identity: AgentIdentity, officeId: string, expectedRows: number): Promise<{ sessionId: string; batchSize: number }> {
  if (expectedRows < 0 || expectedRows > MAX_EXPECTED_ROWS) throw agentErrors.batchInvalid();
  const sessionId = randomUUID();
  await db.insert(agentSyncSessions).values({
    id: sessionId,
    installationId: identity.installationId,
    facilityId: identity.facilityId,
    declaredOfficeId: officeId,
    expectedRows,
    receivedRows: 0,
    status: "receiving",
    startedAt: new Date(),
  });
  return { sessionId, batchSize: 300 };
}

async function requireReceivingSession(identity: AgentIdentity, sessionId: string, officeId: string) {
  const rows = await db
    .select()
    .from(agentSyncSessions)
    .where(
      and(
        eq(agentSyncSessions.id, sessionId),
        eq(agentSyncSessions.installationId, identity.installationId),
        eq(agentSyncSessions.facilityId, identity.facilityId),
        eq(agentSyncSessions.status, "receiving"),
      ),
    )
    .limit(1);
  const session = rows[0];
  if (!session) throw agentErrors.sessionInvalid();
  // officeId is re-checked on begin, batch and finish.
  if (session.declaredOfficeId !== officeId) throw agentErrors.officeMismatch();
  return session;
}

/** Stages one batch. Re-sending the same batch is idempotent (unique session+drugcode). */
export async function stageBatch(identity: AgentIdentity, sessionId: string, officeId: string, rows: SourceRow[]): Promise<{ staged: number; receivedRows: number }> {
  await requireReceivingSession(identity, sessionId, officeId);

  const values = rows.map((row) => ({
    id: randomUUID(),
    sessionId,
    facilityId: identity.facilityId,
    drugcode: row.drugcode,
    payloadJson: row,
  }));

  await db
    .insert(agentSyncStaging)
    .values(values)
    .onDuplicateKeyUpdate({ set: { payloadJson: sql`values(${agentSyncStaging.payloadJson})` } });

  const [counted] = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(agentSyncStaging)
    .where(eq(agentSyncStaging.sessionId, sessionId));
  const receivedRows = Number(counted?.total ?? 0);

  await db.update(agentSyncSessions).set({ receivedRows }).where(eq(agentSyncSessions.id, sessionId));
  return { staged: values.length, receivedRows };
}

export interface SyncResult {
  received: number;
  inserted: number;
  updated: number;
  deactivated: number;
}

/**
 * Commits the staged snapshot in one transaction: upsert every staged row, then
 * deactivate any previously active drug of this facility that the agent did not
 * send. Retrying finish() on an already-committed session is rejected, so the
 * caller must treat a completed session as terminal.
 */
export async function finishSync(identity: AgentIdentity, sessionId: string, officeId: string): Promise<SyncResult> {
  const session = await requireReceivingSession(identity, sessionId, officeId);

  const staged = await db
    .select({ drugcode: agentSyncStaging.drugcode, payloadJson: agentSyncStaging.payloadJson })
    .from(agentSyncStaging)
    .where(eq(agentSyncStaging.sessionId, sessionId));

  if (staged.length !== session.expectedRows) {
    await db.update(agentSyncSessions).set({ status: "failed", finishedAt: new Date() }).where(eq(agentSyncSessions.id, sessionId));
    throw agentErrors.rowCountMismatch(session.expectedRows, staged.length);
  }

  const now = new Date();
  const rows = staged.map((item) => item.payloadJson as SourceRow);

  const result = await db.transaction(async (tx) => {
    const existing = await tx
      .select({ drugcode: sourceDrugs.drugcode })
      .from(sourceDrugs)
      .where(eq(sourceDrugs.facilityId, identity.facilityId));
    const known = new Set(existing.map((row) => row.drugcode));

    // Counted from what was already there, because the upsert cannot say which
    // rows it inserted and asking afterwards would cost another round trip.
    const inserted = rows.reduce((total, row) => (known.has(row.drugcode) ? total : total + 1), 0);
    const updated = rows.length - inserted;

    const values = rows.map((row) => ({
      id: randomUUID(),
      facilityId: identity.facilityId,
      drugcode: row.drugcode,
      drugname: row.drugname ?? null,
      drugnamethai: row.drugnamethai ?? null,
      druggenericname: row.druggenericname ?? null,
      drugtype: row.drugtype,
      pack: row.pack ?? null,
      unitsell: row.unitsell ?? null,
      unitusage: row.unitusage ?? null,
      cost: row.cost == null ? null : String(row.cost),
      sell: row.sell == null ? null : String(row.sell),
      nationaccount: row.nationaccount ?? null,
      drugcode24: row.drugcode24 ?? null,
      active: 1,
      lastSeenSyncId: sessionId,
      updatedAt: now,
    }));

    /*
     * One statement per chunk instead of one per drug.
     *
     * The old loop issued an UPDATE or INSERT for every row, and every one was a
     * round trip to TiDB — about 45 ms each, so a facility with 188 drugs spent
     * eight seconds waiting on the network to do a second of work. The unique
     * key on (facility_id, drugcode) makes the whole batch a single upsert.
     */
    for (let start = 0; start < values.length; start += UPSERT_CHUNK) {
      const chunk = values.slice(start, start + UPSERT_CHUNK);
      if (chunk.length === 0) continue;
      await tx
        .insert(sourceDrugs)
        .values(chunk)
        .onDuplicateKeyUpdate({
          set: {
            drugname: sql`values(${sourceDrugs.drugname})`,
            drugnamethai: sql`values(${sourceDrugs.drugnamethai})`,
            druggenericname: sql`values(${sourceDrugs.druggenericname})`,
            drugtype: sql`values(${sourceDrugs.drugtype})`,
            pack: sql`values(${sourceDrugs.pack})`,
            unitsell: sql`values(${sourceDrugs.unitsell})`,
            unitusage: sql`values(${sourceDrugs.unitusage})`,
            cost: sql`values(${sourceDrugs.cost})`,
            sell: sql`values(${sourceDrugs.sell})`,
            nationaccount: sql`values(${sourceDrugs.nationaccount})`,
            drugcode24: sql`values(${sourceDrugs.drugcode24})`,
            active: sql`values(${sourceDrugs.active})`,
            lastSeenSyncId: sql`values(${sourceDrugs.lastSeenSyncId})`,
            updatedAt: sql`values(${sourceDrugs.updatedAt})`,
          },
        });
    }

    // Anything not present in this snapshot is no longer active in JHCIS.
    const [deactivateResult] = await tx
      .update(sourceDrugs)
      .set({ active: 0, updatedAt: now })
      .where(and(eq(sourceDrugs.facilityId, identity.facilityId), ne(sourceDrugs.lastSeenSyncId, sessionId), eq(sourceDrugs.active, 1)));

    await tx
      .update(agentSyncSessions)
      .set({ status: "complete", receivedRows: rows.length, finishedAt: now })
      .where(eq(agentSyncSessions.id, sessionId));

    await tx.delete(agentSyncStaging).where(eq(agentSyncStaging.sessionId, sessionId));

    await tx.insert(auditLogs).values({
      id: randomUUID(),
      effectiveFacilityId: identity.facilityId,
      action: "agent.sync_committed",
      entityType: "agent_sync_session",
      entityId: sessionId,
      afterJson: { received: rows.length, inserted, updated, deactivated: deactivateResult.affectedRows },
    });

    return { received: rows.length, inserted, updated, deactivated: deactivateResult.affectedRows };
  });

  return result;
}

/** Abandons receiving sessions the agent never finished. */
export async function abortStaleSessions(facilityId: string, keepSessionId: string): Promise<void> {
  const stale = await db
    .select({ id: agentSyncSessions.id })
    .from(agentSyncSessions)
    .where(and(eq(agentSyncSessions.facilityId, facilityId), eq(agentSyncSessions.status, "receiving"), ne(agentSyncSessions.id, keepSessionId)));
  if (stale.length === 0) return;
  const ids = stale.map((row) => row.id);
  await db.delete(agentSyncStaging).where(inArray(agentSyncStaging.sessionId, ids));
  await db.update(agentSyncSessions).set({ status: "aborted", finishedAt: new Date() }).where(inArray(agentSyncSessions.id, ids));
}
