import type { AgentReport } from "@/lib/poc/schemas";

export type EventKind = "agent_report" | "tmt_test";

export interface PocEvent {
  id: string;
  kind: EventKind;
  ok: boolean;
  message: string;
  occurredAt: string;
  httpStatus?: number;
  latencyMs?: number;
}

export interface StoredAgentReport extends AgentReport {
  requestId: string;
  receivedAt: string;
}

export interface PocStateSnapshot {
  latestAgent: StoredAgentReport | null;
  events: PocEvent[];
  persistence: "memory-ephemeral";
}

export interface PocStateStore {
  recordAgent(report: StoredAgentReport): Promise<void>;
  recordEvent(event: PocEvent): Promise<void>;
  snapshot(): Promise<PocStateSnapshot>;
}

export class MemoryPocStateStore implements PocStateStore {
  private latestAgent: StoredAgentReport | null = null;
  private events: PocEvent[] = [];

  async recordAgent(report: StoredAgentReport): Promise<void> {
    this.latestAgent = structuredClone(report);
    await this.recordEvent({
      id: report.requestId,
      kind: "agent_report",
      ok: true,
      message: `รับผลตรวจ JHCIS ของสถานบริการ ${report.officeId}`,
      occurredAt: report.receivedAt,
    });
  }

  async recordEvent(event: PocEvent): Promise<void> {
    this.events = [structuredClone(event), ...this.events].slice(0, 20);
  }

  async snapshot(): Promise<PocStateSnapshot> {
    return {
      latestAgent: this.latestAgent ? structuredClone(this.latestAgent) : null,
      events: structuredClone(this.events),
      persistence: "memory-ephemeral",
    };
  }
}

declare global {
  var pocStateStore: PocStateStore | undefined;
}

export const pocStateStore = globalThis.pocStateStore ?? new MemoryPocStateStore();
if (process.env.NODE_ENV !== "production") globalThis.pocStateStore = pocStateStore;
