"use client";

import { useCallback, useEffect, useState } from "react";

interface HealthResult {
  ok: boolean;
  serverTime: string;
  version: string;
}

interface TmtResult {
  ok: boolean;
  tmtVersion: string | null;
  httpStatus: number | null;
  latencyMs: number;
  errorCode: string | null;
  message: string;
}

interface AgentResult {
  installationId: string;
  machineName: string;
  agentVersion: string;
  officeId: string;
  jhcisConnected: boolean;
  eligibleDrugCount: number;
  checkedAt: string;
  requestId: string;
  receivedAt: string;
}

interface PocEvent {
  id: string;
  kind: "agent_report" | "tmt_test";
  ok: boolean;
  message: string;
  occurredAt: string;
  httpStatus?: number;
  latencyMs?: number;
}

interface StatusResult {
  ok: boolean;
  latestAgent: AgentResult | null;
  events: PocEvent[];
  persistence: "memory-ephemeral" | "tidb";
}

function dateTime(value?: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "short", timeStyle: "medium", timeZone: "Asia/Bangkok" }).format(new Date(value));
}

function StatusPill({ ok, pending = false }: { ok?: boolean; pending?: boolean }) {
  const label = pending ? "ยังไม่มีข้อมูล" : ok ? "online" : "offline";
  return <span className={`status ${pending ? "" : ok ? "ok" : "bad"}`}>{label}</span>;
}

export function PocDashboard({ version }: { version: string }) {
  const [token, setToken] = useState("");
  const [health, setHealth] = useState<HealthResult | null>(null);
  const [healthError, setHealthError] = useState("");
  const [tmt, setTmt] = useState<TmtResult | null>(null);
  const [status, setStatus] = useState<StatusResult | null>(null);
  const [authError, setAuthError] = useState("");
  const [testingTmt, setTestingTmt] = useState(false);

  const loadHealth = useCallback(async () => {
    try {
      const response = await fetch("/api/poc/health", { cache: "no-store" });
      if (!response.ok) throw new Error("health request failed");
      setHealth((await response.json()) as HealthResult);
      setHealthError("");
    } catch {
      setHealth(null);
      setHealthError("ติดต่อ Web API ไม่สำเร็จ");
    }
  }, []);

  const loadStatus = useCallback(async (accessToken: string) => {
    if (!accessToken) return;
    const response = await fetch("/api/poc/status", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      setAuthError(response.status === 401 ? "Dashboard token ไม่ถูกต้อง" : "อ่านสถานะ PoC ไม่สำเร็จ");
      return;
    }
    setStatus((await response.json()) as StatusResult);
    setAuthError("");
  }, []);

  useEffect(() => {
    const saved = sessionStorage.getItem("pocDashboardToken") ?? "";
    const hydrateToken = window.setTimeout(() => {
      setToken(saved);
      void loadHealth();
      if (saved) void loadStatus(saved);
    }, 0);
    const timer = window.setInterval(() => {
      void loadHealth();
      const current = sessionStorage.getItem("pocDashboardToken") ?? "";
      if (current) void loadStatus(current);
    }, 15_000);
    return () => {
      window.clearTimeout(hydrateToken);
      window.clearInterval(timer);
    };
  }, [loadHealth, loadStatus]);

  function connectDashboard() {
    sessionStorage.setItem("pocDashboardToken", token);
    void loadStatus(token);
  }

  async function testTmt() {
    if (!token) {
      setAuthError("กรอก Dashboard token ก่อนทดสอบ TMT");
      return;
    }
    setTestingTmt(true);
    try {
      const response = await fetch("/api/poc/tmt/version", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await response.json()) as TmtResult;
      setTmt(data);
      if (response.status === 401) setAuthError("Dashboard token ไม่ถูกต้อง");
      else setAuthError("");
      await loadStatus(token);
    } catch {
      setTmt({ ok: false, tmtVersion: null, httpStatus: null, latencyMs: 0, errorCode: "WEB_NETWORK", message: "browser ติดต่อ Web API ไม่สำเร็จ" });
    } finally {
      setTestingTmt(false);
    }
  }

  const agent = status?.latestAgent ?? null;
  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <h1 className="title">Connectivity PoC</h1>
          <p className="subtitle">ทดสอบ Web API, TMT API และ Windows Tray Agent</p>
        </div>
        <span className="version">web v{version}</span>
      </header>

      <div className="authbar">
        <input
          aria-label="Dashboard token"
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="POC_DASHBOARD_TOKEN"
          autoComplete="off"
        />
        <button className="btn" type="button" onClick={connectDashboard}>เชื่อม Dashboard</button>
      </div>
      {authError ? <p className="error" role="alert">{authError}</p> : null}

      <section className="grid" aria-label="สถานะการเชื่อมต่อ">
        <article className="card">
          <h2>Web API</h2>
          <StatusPill ok={health?.ok} pending={!health && !healthError} />
          <dl className="facts">
            <dt>Server time</dt><dd>{dateTime(health?.serverTime)}</dd>
            <dt>Version</dt><dd>{health?.version ?? "—"}</dd>
          </dl>
          {healthError ? <p className="error">{healthError}</p> : null}
        </article>

        <article className="card">
          <h2>TMT API</h2>
          <StatusPill ok={tmt?.ok} pending={!tmt} />
          <dl className="facts">
            <dt>HTTP</dt><dd>{tmt?.httpStatus ?? "—"}</dd>
            <dt>Latency</dt><dd>{tmt ? `${tmt.latencyMs} ms` : "—"}</dd>
            <dt>TMT version</dt><dd>{tmt?.tmtVersion ?? "—"}</dd>
            <dt>Result</dt><dd>{tmt?.errorCode ?? tmt?.message ?? "—"}</dd>
          </dl>
          <div className="card-actions">
            <button className="btn" type="button" onClick={testTmt} disabled={testingTmt}>{testingTmt ? "กำลังทดสอบ…" : "ทดสอบ TMT API"}</button>
          </div>
        </article>

        <article className="card">
          <h2>Agent ล่าสุด</h2>
          <StatusPill ok={agent?.jhcisConnected} pending={!agent} />
          <dl className="facts">
            <dt>Machine</dt><dd>{agent?.machineName ?? "—"}</dd>
            <dt>Agent</dt><dd>{agent?.agentVersion ?? "—"}</dd>
            <dt>Office ID</dt><dd>{agent?.officeId ?? "—"}</dd>
            <dt>ยา 01/10</dt><dd>{agent?.eligibleDrugCount.toLocaleString("th-TH") ?? "—"}</dd>
            <dt>Checked</dt><dd>{dateTime(agent?.checkedAt)}</dd>
            <dt>Received</dt><dd>{dateTime(agent?.receivedAt)}</dd>
            <dt>Request ID</dt><dd>{agent?.requestId ?? "—"}</dd>
          </dl>
        </article>

        <p className="notice wide">Persistence: {status?.persistence ?? "ยังไม่ทราบ"}. โหมด memory อาจหายเมื่อ process/function restart; โหมด TiDB นี้เป็นตาราง PoC เท่านั้นและยังไม่ใช่ schema ระบบจริง</p>

        <article className="card wide">
          <h2>Event ล่าสุด</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>เวลา</th><th>ประเภท</th><th>ผล</th><th>HTTP</th><th>Latency</th><th>ข้อความ</th><th>Request ID</th></tr></thead>
              <tbody>
                {status?.events.length ? status.events.map((event) => (
                  <tr key={event.id}>
                    <td>{dateTime(event.occurredAt)}</td>
                    <td>{event.kind}</td>
                    <td>{event.ok ? "สำเร็จ" : "ไม่สำเร็จ"}</td>
                    <td>{event.httpStatus ?? "—"}</td>
                    <td>{event.latencyMs === undefined ? "—" : `${event.latencyMs} ms`}</td>
                    <td>{event.message}</td>
                    <td>{event.id}</td>
                  </tr>
                )) : <tr><td className="empty" colSpan={7}>ยังไม่มี event หรือยังไม่ได้เชื่อม Dashboard</td></tr>}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    </main>
  );
}
