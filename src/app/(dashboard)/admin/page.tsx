import { redirect } from "next/navigation";
import { requireUser } from "@/modules/auth/session";
import { countFacilitylessUsers, countMisconfiguredAdmins, countPendingUsers, facilitySummaries, listUsers } from "@/modules/admin/queries";
import { formatBangkok } from "@/modules/facilities/queries";
import { readTmtCredentialStatus } from "@/modules/standards/tmt-credentials";
import { readInstallerLink } from "@/modules/agent/installer-link";
import { Alert, Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { Table, TableMessage, TableScroll } from "@/components/ui/table";
import { IconDownload, IconLink, IconShield } from "@/components/ui/icons";
import { AgentInstallerPanel } from "./agent-installer-panel";
import { FacilityAdminPanel } from "./facility-admin-panel";
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
    <div className="space-y-4">
      <PageHeader
        eyebrow="ส่วนกลาง"
        title="จัดการระบบ"
        description="ตั้งค่าที่มีผลกับทุกสถานบริการ และจัดการบัญชีผู้ใช้"
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={pending > 0 ? "warning" : "neutral"} dot={pending > 0}>
              รออนุมัติ {pending.toLocaleString("th-TH")} บัญชี
            </Badge>
            <Badge>สถานบริการ {summaries.length.toLocaleString("th-TH")} แห่ง</Badge>
          </div>
        }
      />

      {integrityProblems.length > 0 ? (
        <Alert tone="danger" title="พบข้อมูลที่ขัดกับกฎสิทธิ์">
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            {integrityProblems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <Card>
        <CardHeader title="ภาพรวมรายสถานบริการ" description="ตัวเลขทั้งหมดนับจากข้อมูลจริงในฐานข้อมูล" />
        <CardBody flush className="pt-3">
          <TableScroll>
            <Table>
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
                {summaries.length === 0 ? (
                  <TableMessage colSpan={9}>
                    <EmptyState
                      compact
                      icon={<IconShield size={18} />}
                      title="ยังไม่มีสถานบริการที่เปิดใช้งาน"
                      description="สถานบริการถูกสร้างขึ้นเมื่อบัญชีแรกของรหัสนั้นสมัครสมาชิก"
                    />
                  </TableMessage>
                ) : (
                  summaries.map((row) => (
                    <tr key={row.facilityId}>
                      <td className="cell-code">{row.facilityCode}</td>
                      <td className="font-medium">{row.facilityName}</td>
                      <td className="cell-num">{row.sourceTotal.toLocaleString("th-TH")}</td>
                      <td className="cell-num text-slate-500">
                        {row.type01.toLocaleString("th-TH")} / {row.type10.toLocaleString("th-TH")}
                      </td>
                      <td className="cell-num">{row.mappedTotal.toLocaleString("th-TH")}</td>
                      <td className="cell-num">
                        {row.pendingTotal > 0 ? (
                          <Badge tone="warning">{row.pendingTotal.toLocaleString("th-TH")}</Badge>
                        ) : (
                          <Badge tone="success">0</Badge>
                        )}
                      </td>
                      <td className="cell-num">
                        {row.accountCount === 0 ? (
                          <Badge tone="danger" title="ไม่มีบัญชีผูกกับสถานบริการนี้ จึงไม่มีใครเข้าใช้งานได้">
                            0
                          </Badge>
                        ) : (
                          row.accountCount
                        )}
                      </td>
                      <td className="cell-num">
                        {row.agentCount}
                        {row.agentMismatchCount > 0 ? (
                          <Badge
                            tone="danger"
                            className="ml-1.5"
                            title={`${row.agentMismatchCount} เครื่องรายงาน office.offid ไม่ตรงกับรหัส ${row.facilityCode} จึงถูกปฏิเสธทุกคำขอ`}
                          >
                            ไม่ตรง {row.agentMismatchCount}
                          </Badge>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap">{formatBangkok(row.lastMappedAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          </TableScroll>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="จัดการสถานบริการ"
          description="เลือกสถานบริการหนึ่งแห่ง แล้วแก้ไขชื่อหรือรหัส หรือล้างข้อมูลของแห่งนั้นได้ในที่เดียว"
        />
        <CardBody>
          <FacilityAdminPanel
            facilities={summaries.map((row) => ({
              facilityId: row.facilityId,
              facilityCode: row.facilityCode,
              facilityName: row.facilityName,
              sourceTotal: row.sourceTotal,
              mappedTotal: row.mappedTotal,
              agentCount: row.agentCount,
              accountCount: row.accountCount,
            }))}
          />
        </CardBody>
      </Card>

      <div className="grid gap-3.5 lg:grid-cols-2">
        <Card>
          <CardHeader
            icon={<IconDownload size={16} />}
            title="ตัวติดตั้ง Agent"
            description="ลิงก์ที่ปุ่มดาวน์โหลดในหน้า “เชื่อมต่อ JHCIS” ของทุกสถานบริการชี้ไป"
          />
          <CardBody>
            <AgentInstallerPanel initial={installerLink} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader icon={<IconLink size={16} />} title="TMT API" description="บัญชีที่ใช้ดึงคลังมาตรฐานจาก สมสท" />
          <CardBody>
            <TmtApiPanel initial={tmtStatus} />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="บัญชีผู้ใช้"
          description="บัญชีที่สมัครใหม่เป็นสถานะรอดำเนินการเสมอ ต้องเปิดใช้งานก่อนจึงจะเข้าสู่ระบบได้ และการปิดใช้งานจะยกเลิก session ที่เปิดค้างอยู่ทันที"
        />
        <CardBody flush className="pt-3">
          <UserTable users={rows} currentUserId={user.id} />
        </CardBody>
      </Card>
    </div>
  );
}
