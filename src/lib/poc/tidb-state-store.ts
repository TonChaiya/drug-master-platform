import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { PocEvent, PocStateSnapshot, PocStateStore, StoredAgentReport } from "@/lib/poc/state-store";
import { getPocTiDbPool } from "@/lib/poc/tidb";

interface AgentRow extends RowDataPacket {
  request_id: string;
  installation_id: string;
  machine_name: string;
  agent_version: string;
  office_id: string;
  jhcis_connected: number;
  eligible_drug_count: number;
  checked_at: Date;
  received_at: Date;
}

interface EventRow extends RowDataPacket {
  id: string;
  kind: PocEvent["kind"];
  ok: number;
  message: string;
  occurred_at: Date;
  http_status: number | null;
  latency_ms: number | null;
}

function iso(value: Date): string {
  return value.toISOString();
}

export class TiDbPocStateStore implements PocStateStore {
  async recordAgent(report: StoredAgentReport): Promise<void> {
    const connection = await getPocTiDbPool().getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute<ResultSetHeader>(
        `INSERT INTO poc_agent_reports
          (request_id, installation_id, machine_name, agent_version, office_id,
           jhcis_connected, eligible_drug_count, checked_at, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          report.requestId,
          report.installationId,
          report.machineName,
          report.agentVersion,
          report.officeId,
          report.jhcisConnected,
          report.eligibleDrugCount,
          new Date(report.checkedAt),
          new Date(report.receivedAt),
        ],
      );
      await connection.execute<ResultSetHeader>(
        `INSERT INTO poc_events (id, kind, ok, message, occurred_at)
         VALUES (?, 'agent_report', 1, ?, ?)`,
        [report.requestId, `รับผลตรวจ JHCIS ของสถานบริการ ${report.officeId}`, new Date(report.receivedAt)],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async recordEvent(event: PocEvent): Promise<void> {
    await getPocTiDbPool().execute<ResultSetHeader>(
      `INSERT INTO poc_events
        (id, kind, ok, message, occurred_at, http_status, latency_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        event.id,
        event.kind,
        event.ok,
        event.message,
        new Date(event.occurredAt),
        event.httpStatus ?? null,
        event.latencyMs ?? null,
      ],
    );
  }

  async snapshot(): Promise<PocStateSnapshot> {
    const [agentRows] = await getPocTiDbPool().query<AgentRow[]>(
      `SELECT request_id, installation_id, machine_name, agent_version, office_id,
              jhcis_connected, eligible_drug_count, checked_at, received_at
       FROM poc_agent_reports
       ORDER BY received_at DESC
       LIMIT 1`,
    );
    const [eventRows] = await getPocTiDbPool().query<EventRow[]>(
      `SELECT id, kind, ok, message, occurred_at, http_status, latency_ms
       FROM poc_events
       ORDER BY occurred_at DESC
       LIMIT 20`,
    );
    const row = agentRows[0];
    return {
      latestAgent: row
        ? {
            requestId: row.request_id,
            installationId: row.installation_id,
            machineName: row.machine_name,
            agentVersion: row.agent_version,
            officeId: row.office_id,
            jhcisConnected: row.jhcis_connected === 1,
            eligibleDrugCount: row.eligible_drug_count,
            checkedAt: iso(row.checked_at),
            receivedAt: iso(row.received_at),
          }
        : null,
      events: eventRows.map((event) => ({
        id: event.id,
        kind: event.kind,
        ok: event.ok === 1,
        message: event.message,
        occurredAt: iso(event.occurred_at),
        ...(event.http_status === null ? {} : { httpStatus: event.http_status }),
        ...(event.latency_ms === null ? {} : { latencyMs: event.latency_ms }),
      })),
      persistence: "tidb",
    };
  }
}
