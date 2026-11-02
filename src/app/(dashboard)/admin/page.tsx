import { redirect } from "next/navigation";
import { requireUser } from "@/modules/auth/session";
import { countFacilitylessUsers, countMisconfiguredAdmins, countPendingUsers, facilitySummaries, listUsers } from "@/modules/admin/queries";
import { formatBangkok } from "@/modules/facilities/queries";
import { readTmtCredentialStatus } from "@/modules/standards/tmt-credentials";
import { readInstallerLink } from "@/modules/agent/installer-link";
import { facilityCondition, mappedPercent } from "@/modules/admin/condition";
import { Alert, Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { IconDownload, IconLink } from "@/components/ui/icons";
import { AgentInstallerPanel } from "./agent-installer-panel";
import { FacilityAdminPanel } from "./facility-admin-panel";
import { FacilityOverviewTable, type FacilityOverviewRow } from "./facility-overview-table";
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

  const conditions = summaries.map((row) => facilityCondition(row));
  const blocked = conditions.filter((condition) => condition.tone === "danger").length;
  const waiting = conditions.filter((condition) => condition.tone === "warning").length;
  const ready = conditions.filter((condition) => condition.tone === "success").length;
  const overviewRows: FacilityOverviewRow[] = summaries.map((row) => ({
    facilityId: row.facilityId,
    facilityCode: row.facilityCode,
    facilityName: row.facilityName,
    sourceTotal: row.sourceTotal,
    type01: row.type01,
    type10: row.type10,
    mappedTotal: row.mappedTotal,
    pendingTotal: row.pendingTotal,
    needsReviewTotal: row.needsReviewTotal,
    installationCount: row.installationCount,
    agentCount: row.agentCount,
    disabledAgentCount: row.disabledAgentCount,
    supersededAgentCount: row.supersededAgentCount,
    usableAgentCount: row.usableAgentCount,
    onlineAgentCount: row.onlineAgentCount,
    offlineAgentCount: row.offlineAgentCount,
    jhcisConnectedCount: row.jhcisConnectedCount,
    jhcisUnreachableCount: row.jhcisUnreachableCount,
    jhcisUnknownCount: row.jhcisUnknownCount,
    agentMismatchCount: row.agentMismatchCount,
    activeAccountCount: row.activeAccountCount,
    pendingAccountCount: row.pendingAccountCount,
    disabledAccountCount: row.disabledAccountCount,
    lastMappedAtLabel: row.lastMappedAt ? formatBangkok(row.lastMappedAt) : null,
    mappedPercent: mappedPercent(row),
    condition: facilityCondition(row),
  }));

  const integrityProblems = [
    misconfiguredAdmins > 0 ? `มีผู้ดูแลระบบ ${misconfiguredAdmins} บัญชีที่ถูกผูกกับสถานบริการ ซึ่งขัดกับกฎ admin ต้องไม่มี facility` : null,
    facilitylessUsers > 0 ? `มีผู้ใช้ทั่วไป ${facilitylessUsers} บัญชีที่ไม่มีสถานบริการ จึงเข้าใช้งานไม่ได้` : null,
  ].filter((problem): problem is string => problem !== null);

  return (
    <div className="space-y-3">
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
        <CardHeader
          title="ภาพรวมรายสถานบริการ"
          description={`ต้องแก้ ${blocked.toLocaleString("th-TH")} · รอดำเนินการ ${waiting.toLocaleString("th-TH")} · พร้อม ${ready.toLocaleString("th-TH")}`}
        />
        <CardBody flush className="pt-2.5">
          <FacilityOverviewTable rows={overviewRows} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="จัดการสถานบริการ"
          description="เลือกสถานบริการเมื่อจำเป็นต้องแก้ configuration หรือล้างข้อมูล"
        />
        <CardBody className="pt-3">
          <FacilityAdminPanel
            facilities={summaries.map((row) => ({
              facilityId: row.facilityId,
              facilityCode: row.facilityCode,
              facilityName: row.facilityName,
              sourceTotal: row.sourceTotal,
              mappedTotal: row.mappedTotal,
              agentCount: row.agentCount,
              accountCount: row.totalAccountCount,
            }))}
          />
        </CardBody>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
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
          description="ค้นหา กรอง และจัดการบัญชีตามสถานะ"
        />
        <CardBody flush className="pt-2.5">
          <UserTable users={rows} currentUserId={user.id} />
        </CardBody>
      </Card>
    </div>
  );
}
