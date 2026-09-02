import { redirect } from "next/navigation";
import { resolveEffectiveFacility } from "@/lib/authorization/effective-facility";
import { requireUser } from "@/modules/auth/session";
import { readInstallerLink } from "@/modules/agent/installer-link";
import { listInstallations, recentCommands, recentSyncSessions } from "@/modules/agent/queries";
import { formatBangkok } from "@/modules/facilities/queries";
import { EnrollmentPanel } from "./enrollment-panel";

export const dynamic = "force-dynamic";

const SESSION_STATUS: Record<string, string> = {
  receiving: "badge-warn",
  complete: "badge-ok",
  failed: "badge-danger",
  aborted: "badge-muted",
};

const COMMAND_STATUS: Record<string, string> = {
  pending: "badge-warn",
  claimed: "badge-warn",
  succeeded: "badge-ok",
  failed: "badge-danger",
  expired: "badge-muted",
};

export default async function JhcisPage() {
  let user;
  try {
    user = await requireUser();
  } catch {
    redirect("/login");
  }

  const facility = await resolveEffectiveFacility(user);
  if (!facility) {
    return (
      <section className="card card-pad">
        <h1 className="page-title">เชื่อมต่อ JHCIS</h1>
        <p className="mt-1 text-xxs text-slate-500">เลือกสถานบริการก่อนจึงจะจัดการ Agent ได้</p>
      </section>
    );
  }

  const [installations, sessions, commands, installer] = await Promise.all([
    listInstallations(facility.id),
    recentSyncSessions(facility.id),
    recentCommands(facility.id),
    readInstallerLink(),
  ]);

  // A tray that reported a different office.offid than this facility's code was
  // refused by the server; the person signed in here is the one who can fix it.
  const mismatched = installations.filter((row) => row.lastMismatchAt !== null);

  return (
    <div className="space-y-3">
      {mismatched.length > 0 ? (
        <section className="card card-pad border-danger/30 bg-danger-soft" role="alert">
          <h2 className="font-display text-sm font-extrabold text-danger">ไอดีไม่ตรงกับสถานบริการ</h2>
          <p className="mt-1 text-xxs text-danger">
            โปรดกลับไปที่สถานบริการและไอดีของท่านให้ถูกต้อง — Agent จะไม่ทำงานจนกว่ารหัสสถานบริการจะตรงกัน
          </p>
          <ul className="mt-2 space-y-1 text-xxs text-danger">
            {mismatched.map((row) => (
              <li key={row.installationId}>
                เครื่อง <strong>{row.machineLabel}</strong> รายงาน office.offid{" "}
                <code className="font-mono">{row.lastMismatchOfficeId ?? "—"}</code> แต่ไอดีที่ท่านใช้อยู่ผูกกับสถานบริการ{" "}
                <code className="font-mono">{facility.code}</code> · ล่าสุด {formatBangkok(row.lastMismatchAt)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <header>
        <h1 className="page-title">เชื่อมต่อ JHCIS</h1>
        <p className="text-xxs text-slate-500">
          {facility.code} · {facility.name} — Agent เปิดเฉพาะขาออก HTTPS ไม่มีการเปิดพอร์ต MySQL ออกอินเทอร์เน็ต
        </p>
      </header>

      <EnrollmentPanel installer={{ url: installer.url, version: installer.version }} />

      <section className="card card-pad">
        <h2 className="mb-2 text-sm font-semibold">เครื่องที่ลงทะเบียนแล้ว</h2>
        {installations.length === 0 ? (
          <p className="text-xxs text-slate-500">ยังไม่มีเครื่องใดลงทะเบียนกับสถานบริการนี้</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>เครื่อง</th>
                  <th>office.offid</th>
                  <th>เวอร์ชัน</th>
                  <th>key ที่ใช้ได้</th>
                  <th>เห็นล่าสุด</th>
                  <th>สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {installations.map((row) => (
                  <tr key={row.installationId}>
                    <td>
                      <div className="font-medium">{row.machineLabel}</div>
                      <div className="font-mono text-xxs text-slate-400">{row.installationId}</div>
                    </td>
                    <td className="font-mono">
                      {row.declaredOfficeId ?? "—"}
                      {row.lastMismatchAt ? (
                        <span className="badge-danger ml-1">ไม่ตรง: {row.lastMismatchOfficeId ?? "?"}</span>
                      ) : null}
                    </td>
                    <td className="font-mono">{row.agentVersion ?? "—"}</td>
                    <td className="tabular-nums">{row.activeCredentials}</td>
                    <td>{formatBangkok(row.lastSeenAt)}</td>
                    <td>
                      <span className={row.status === "active" ? "badge-ok" : "badge-muted"}>{row.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="card card-pad">
          <h2 className="mb-2 text-sm font-semibold">รอบดึงข้อมูลล่าสุด</h2>
          {sessions.length === 0 ? (
            <p className="text-xxs text-slate-500">ยังไม่มีรอบการดึงข้อมูล</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>เริ่ม</th>
                    <th>คาด/รับ</th>
                    <th>office</th>
                    <th>สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((row) => (
                    <tr key={row.id}>
                      <td>{formatBangkok(row.startedAt)}</td>
                      <td className="tabular-nums">
                        {row.expectedRows.toLocaleString("th-TH")} / {row.receivedRows.toLocaleString("th-TH")}
                      </td>
                      <td className="font-mono">{row.declaredOfficeId}</td>
                      <td>
                        <span className={SESSION_STATUS[row.status] ?? "badge-muted"}>{row.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card card-pad">
          <h2 className="mb-2 text-sm font-semibold">คำสั่งที่ส่งไปยัง Agent</h2>
          {commands.length === 0 ? (
            <p className="text-xxs text-slate-500">ยังไม่มีคำสั่ง</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>คำสั่ง</th>
                    <th>สร้าง</th>
                    <th>ผล</th>
                    <th>สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {commands.map((row) => (
                    <tr key={row.id}>
                      <td className="font-mono">{row.commandType}</td>
                      <td>{formatBangkok(row.createdAt)}</td>
                      <td className="max-w-56 truncate" title={row.resultMessage ?? ""}>
                        {row.resultMessage ?? "—"}
                      </td>
                      <td>
                        <span className={COMMAND_STATUS[row.status] ?? "badge-muted"}>{row.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
