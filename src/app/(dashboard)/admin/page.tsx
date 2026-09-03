import { redirect } from "next/navigation";
import { requireUser } from "@/modules/auth/session";
import { countFacilitylessUsers, countMisconfiguredAdmins, countPendingUsers, facilitySummaries, listUsers } from "@/modules/admin/queries";
import { formatBangkok } from "@/modules/facilities/queries";
import { readTmtCredentialStatus } from "@/modules/standards/tmt-credentials";
import { readInstallerLink } from "@/modules/agent/installer-link";
import { AgentInstallerPanel } from "./agent-installer-panel";
import { FacilityDataPanel } from "./facility-data-panel";
import { FacilityEditPanel } from "./facility-edit-panel";
import { TmtApiPanel } from "./tmt-api-panel";
import { UserTable, type AdminUserRow } from "./user-table";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  let user;
  try {
    user = await requireUser();
  } catch {
    redirect("/login");
  }
  if (user.role !== "admin") redirect("/dashboard");

  const [summaries, users, pending, misconfiguredAdmins, facilitylessUsers, tmtStatus, installerLink] = await Promise.all([
    facilitySummaries(),
    listUsers(),
    countPendingUsers(),
    countMisconfiguredAdmins(),
    countFacilitylessUsers(),
    readTmtCredentialStatus(),
    readInstallerLink(),
  ]);

  const rows: AdminUserRow[] = users.map((row) => ({
    id: row.id,
    username: row.username,
    fullName: row.fullName,
    positionName: row.positionName,
    role: row.role,
    status: row.status,
    lastLoginAt: row.lastLoginAt ? formatBangkok(row.lastLoginAt) : null,
    facilityCode: row.facilityCode,
    facilityName: row.facilityName,
  }));

  const integrityProblems = [
    misconfiguredAdmins > 0 ? `มีผู้ดูแลระบบ ${misconfiguredAdmins} บัญชีที่ถูกผูกกับสถานบริการ ซึ่งขัดกับกฎ admin ต้องไม่มี facility` : null,
    facilitylessUsers > 0 ? `มีผู้ใช้ทั่วไป ${facilitylessUsers} บัญชีที่ไม่มีสถานบริการ จึงเข้าใช้งานไม่ได้` : null,
  ].filter((problem): problem is string => problem !== null);

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="page-title">ผู้ดูแลระบบ</h1>
        <p className="text-xxs text-slate-500">
          รออนุมัติ {pending.toLocaleString("th-TH")} บัญชี · สถานบริการที่เปิดใช้งาน {summaries.length.toLocaleString("th-TH")} แห่ง
        </p>
      </header>

      {integrityProblems.length > 0 ? (
        <section className="card card-pad border-danger/30 bg-danger-soft">
          <h2 className="text-xxs font-semibold text-danger">พบข้อมูลที่ขัดกับกฎสิทธิ์</h2>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-xxs text-danger">
            {integrityProblems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="card card-pad">
        <h2 className="mb-2 text-sm font-semibold">ภาพรวมรายสถานบริการ</h2>
        {summaries.length === 0 ? (
          <p className="text-xxs text-slate-500">ยังไม่มีสถานบริการที่เปิดใช้งาน</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>รหัส</th>
                  <th>ชื่อสถานบริการ</th>
                  <th>จาก JHCIS</th>
                  <th>01 / 10</th>
                  <th>จับคู่แล้ว</th>
                  <th>คงค้าง</th>
                  <th>ไอดี</th>
                  <th>Agent</th>
                  <th>จับคู่ล่าสุด</th>
                </tr>
              </thead>
              <tbody>
                {summaries.map((row) => (
                  <tr key={row.facilityId}>
                    <td className="font-mono">{row.facilityCode}</td>
                    <td>{row.facilityName}</td>
                    <td className="tabular-nums">{row.sourceTotal.toLocaleString("th-TH")}</td>
                    <td className="tabular-nums text-xxs text-slate-500">
                      {row.type01.toLocaleString("th-TH")} / {row.type10.toLocaleString("th-TH")}
                    </td>
                    <td className="tabular-nums">{row.mappedTotal.toLocaleString("th-TH")}</td>
                    <td className="tabular-nums">
                      {row.pendingTotal > 0 ? (
                        <span className="badge-warn">{row.pendingTotal.toLocaleString("th-TH")}</span>
                      ) : (
                        <span className="badge-ok">0</span>
                      )}
                    </td>
                    <td className="tabular-nums">
                      {row.accountCount === 0 ? (
                        <span className="badge-danger" title="ไม่มีบัญชีผูกกับสถานบริการนี้ จึงไม่มีใครเข้าใช้งานได้">0</span>
                      ) : (
                        row.accountCount
                      )}
                    </td>
                    <td className="tabular-nums">
                      {row.agentCount}
                      {row.agentMismatchCount > 0 ? (
                        <span
                          className="badge-danger ml-1"
                          title={`${row.agentMismatchCount} เครื่องรายงาน office.offid ไม่ตรงกับรหัส ${row.facilityCode} จึงถูกปฏิเสธทุกคำขอ`}
                        >
                          ไม่ตรง {row.agentMismatchCount}
                        </span>
                      ) : null}
                    </td>
                    <td>{formatBangkok(row.lastMappedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card card-pad">
        <h2 className="mb-2 font-display text-base font-extrabold tracking-tight">แก้ไขสถานบริการ</h2>
        <FacilityEditPanel
          facilities={summaries.map((row) => ({
            facilityId: row.facilityId,
            facilityCode: row.facilityCode,
            facilityName: row.facilityName,
            agentCount: row.agentCount,
          }))}
        />
      </section>

      <section className="card card-pad">
        <h2 className="mb-2 font-display text-base font-extrabold tracking-tight">จัดการข้อมูลรายสถานบริการ</h2>
        <FacilityDataPanel
          facilities={summaries.map((row) => ({
            facilityId: row.facilityId,
            facilityCode: row.facilityCode,
            facilityName: row.facilityName,
            mappedTotal: row.mappedTotal,
          }))}
        />
      </section>

      <section className="card card-pad">
        <h2 className="mb-2 font-display text-base font-extrabold tracking-tight">ตัวติดตั้ง Agent</h2>
        <AgentInstallerPanel initial={installerLink} />
      </section>

      <section className="card card-pad">
        <h2 className="mb-2 font-display text-base font-extrabold tracking-tight">TMT API</h2>
        <TmtApiPanel initial={tmtStatus} />
      </section>

      <section className="card card-pad">
        <h2 className="mb-2 text-sm font-semibold">บัญชีผู้ใช้</h2>
        <p className="mb-2 text-xxs text-slate-500">
          บัญชีที่สมัครใหม่เป็น <span className="badge-warn">pending</span> เสมอ ต้องเปิดใช้งานก่อนจึงจะเข้าสู่ระบบได้
          การปิดใช้งานจะยกเลิก session ที่เปิดค้างอยู่ทันที
        </p>
        <UserTable users={rows} currentUserId={user.id} />
      </section>
    </div>
  );
}
