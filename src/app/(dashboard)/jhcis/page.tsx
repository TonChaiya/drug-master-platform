import { redirect } from "next/navigation";
import { resolveEffectiveFacility } from "@/lib/authorization/effective-facility";
import { requireUser } from "@/modules/auth/session";
import { readInstallerLink } from "@/modules/agent/installer-link";
import { listInstallations, recentCommands, recentSyncSessions } from "@/modules/agent/queries";
import { formatBangkok } from "@/modules/facilities/queries";
import { Alert, Badge, StatusBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { NoFacilityNotice, PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { Table, TableMessage, TableScroll } from "@/components/ui/table";
import { IconLink, IconMonitor, IconRefresh } from "@/components/ui/icons";
import { EnrollmentPanel } from "./enrollment-panel";
import { AgentActions } from "./agent-actions";

export const dynamic = "force-dynamic";

export default async function JhcisPage() {
  let user;
  try {
    user = await requireUser();
  } catch {
    redirect("/login");
  }

  const facility = await resolveEffectiveFacility(user);
  if (!facility) return <NoFacilityNotice title="เชื่อมต่อ JHCIS" isAdmin={user.role === "admin"} />;

  const isAdmin = user.role === "admin";
  const [installations, sessions, commands, installer] = await Promise.all([
    // A user sees the machines they registered; an admin sees the facility's.
    listInstallations(facility.id, isAdmin ? undefined : user.id),
    recentSyncSessions(facility.id),
    recentCommands(facility.id),
    readInstallerLink(),
  ]);

  // A tray that reported a different office.offid than this facility's code was
  // refused by the server; the person signed in here is the one who can fix it.
  const mismatched = installations.filter((row) => row.lastMismatchAt !== null);
  const activeTargets = installations.filter((row) => row.status === "active");

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={`${facility.code} · ${facility.name}`}
        title="เชื่อมต่อ JHCIS"
        description="Agent เปิดเฉพาะขาออก HTTPS ไม่มีการเปิดพอร์ต MySQL ออกอินเทอร์เน็ต และรหัสฐานข้อมูลอยู่ที่เครื่องปลายทางเท่านั้น"
      />

      {mismatched.length > 0 ? (
        <Alert tone="danger" title="รหัสสถานบริการไม่ตรงกัน">
          <p>Agent จะไม่ส่งข้อมูลจนกว่า office.offid ใน JHCIS จะตรงกับรหัสสถานบริการของไอดีที่ใช้อยู่</p>
          <ul className="mt-1.5 space-y-1">
            {mismatched.map((row) => (
              <li key={row.installationId}>
                เครื่อง <strong>{row.machineLabel}</strong> รายงาน <code className="font-mono">{row.lastMismatchOfficeId ?? "—"}</code> แต่ไอดีนี้ผูกกับ{" "}
                <code className="font-mono">{facility.code}</code> · ล่าสุด {formatBangkok(row.lastMismatchAt)}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <EnrollmentPanel
        installationCount={installations.length}
        installer={{ url: installer.url, version: installer.version }}
      />

      <Card>
        <CardHeader
          icon={<IconMonitor size={16} />}
          title={isAdmin ? "เครื่องที่ลงทะเบียนแล้ว" : "เครื่องที่ไอดีนี้ลงทะเบียน"}
          description={
            isAdmin
              ? "ทุกไอดีของสถานบริการนี้"
              : "เครื่องที่ไอดีอื่นลงทะเบียนไว้จะไม่แสดงที่นี่"
          }
        />
        <CardBody flush className="pt-3">
          <TableScroll>
            <Table>
              <thead>
                <tr>
                  <th>เครื่อง</th>
                  <th>สถานบริการ</th>
                  <th>MAC</th>
                  <th>IP ล่าสุด</th>
                  <th>office.offid</th>
                  <th>เวอร์ชัน</th>
                  <th>key ที่ใช้ได้</th>
                  <th>เห็นล่าสุด</th>
                  <th>heartbeat</th>
                  <th>ลงทะเบียน</th>
                  <th>Agent</th>
                  <th>JHCIS</th>
                  {isAdmin ? <th>จัดการ</th> : null}
                </tr>
              </thead>
              <tbody>
                {installations.length === 0 ? (
                  <TableMessage colSpan={isAdmin ? 13 : 12}>
                    <EmptyState
                      compact
                      icon={<IconMonitor size={18} />}
                      title={isAdmin ? "ยังไม่มีเครื่องใดลงทะเบียนกับสถานบริการนี้" : "ไอดีนี้ยังไม่ได้ลงทะเบียนเครื่องใด"}
                      description="ติดตั้ง Agent บนเครื่องที่อยู่ในวง LAN เดียวกับ JHCIS แล้วกด “เชื่อมต่อ Agent บนเครื่องนี้” ด้านบน"
                    />
                  </TableMessage>
                ) : (
                  installations.map((row) => (
                    <tr key={row.installationId}>
                      <td>
                        <div className="font-medium">{row.machineLabel}</div>
                        <div className="cell-code text-xxs text-slate-500">{row.installationId}</div>
                      </td>
                      <td className="cell-code">{facility.code}</td>
                      <td className="cell-code text-xxs">{row.macAddress ?? "—"}</td>
                      <td className="cell-code text-xxs">{row.ipAddress ?? "—"}</td>
                      <td>
                        <span className="cell-code">{row.declaredOfficeId ?? "—"}</span>
                        {row.lastMismatchAt ? (
                          <Badge tone="danger" className="ml-1.5">
                            ไม่ตรง: {row.lastMismatchOfficeId ?? "?"}
                          </Badge>
                        ) : null}
                      </td>
                      <td className="cell-code">{row.agentVersion ?? "—"}</td>
                      <td className="cell-num">{row.activeCredentials}</td>
                      <td className="whitespace-nowrap">{formatBangkok(row.lastSeenAt)}</td>
                      <td className="whitespace-nowrap">{formatBangkok(row.lastHeartbeatAt)}</td>
                      <td>
                        {row.status === "active" ? <Badge tone="success" dot>ลงทะเบียนแล้ว</Badge> : <StatusBadge status={row.status} />}
                      </td>
                      <td className="space-y-1">
                        <StatusBadge status={row.presence} />
                        <StatusBadge status={row.credentialStatus === "active" ? "active-key" : "revoked"} />
                      </td>
                      <td><StatusBadge status={row.jhcisStatus} /></td>
                      {isAdmin ? (
                        <td>
                          <AgentActions
                            installationId={row.installationId}
                            status={row.status}
                            targets={activeTargets.filter((target) => target.installationId !== row.installationId).map((target) => ({ installationId: target.installationId, machineLabel: target.machineLabel }))}
                          />
                        </td>
                      ) : null}
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          </TableScroll>
        </CardBody>
      </Card>

      <div className="grid gap-3.5 lg:grid-cols-2">
        <Card>
          <CardHeader icon={<IconRefresh size={16} />} title="รอบดึงข้อมูลล่าสุด" description="จำนวนที่ Agent แจ้งไว้ เทียบกับที่ระบบรับจริง" />
          <CardBody flush className="pt-3">
            <TableScroll>
              <Table>
                <thead>
                  <tr>
                    <th>เริ่ม</th>
                    <th>คาด / รับ</th>
                    <th>office</th>
                    <th>สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.length === 0 ? (
                    <TableMessage colSpan={4}>
                      <EmptyState compact title="ยังไม่มีรอบการดึงข้อมูล" description="กด “ดึงรายการยาตอนนี้” ด้านบนเพื่อเริ่มรอบแรก" />
                    </TableMessage>
                  ) : (
                    sessions.map((row) => (
                      <tr key={row.id}>
                        <td className="whitespace-nowrap">{formatBangkok(row.startedAt)}</td>
                        <td className="cell-num">
                          {row.expectedRows.toLocaleString("th-TH")} / {row.receivedRows.toLocaleString("th-TH")}
                        </td>
                        <td className="cell-code">{row.declaredOfficeId}</td>
                        <td>
                          <StatusBadge status={row.status} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </Table>
            </TableScroll>
          </CardBody>
        </Card>

        <Card>
          <CardHeader icon={<IconLink size={16} />} title="คำสั่งที่ส่งไปยัง Agent" description="Agent รับคำสั่งเมื่อ poll ครั้งถัดไป" />
          <CardBody flush className="pt-3">
            <TableScroll>
              <Table>
                <thead>
                  <tr>
                    <th>คำสั่ง</th>
                    <th>สร้าง</th>
                    <th>ผล</th>
                    <th>สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {commands.length === 0 ? (
                    <TableMessage colSpan={4}>
                      <EmptyState compact title="ยังไม่มีคำสั่ง" description="คำสั่งทดสอบการเชื่อมต่อและสั่งดึงข้อมูลจะปรากฏที่นี่" />
                    </TableMessage>
                  ) : (
                    commands.map((row) => (
                      <tr key={row.id}>
                        <td className="cell-code">{row.commandType}</td>
                        <td className="whitespace-nowrap">{formatBangkok(row.createdAt)}</td>
                        <td className="max-w-56 truncate" title={row.resultMessage ?? ""}>
                          {row.resultMessage ?? "—"}
                        </td>
                        <td>
                          <StatusBadge status={row.status} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </Table>
            </TableScroll>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
