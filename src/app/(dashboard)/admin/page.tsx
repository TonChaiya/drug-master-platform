import { redirect } from "next/navigation";
import { requireUser } from "@/modules/auth/session";
import { countFacilitylessUsers, countMisconfiguredAdmins, countPendingUsers, facilitySummaries, listUsers } from "@/modules/admin/queries";
import { formatBangkok } from "@/modules/facilities/queries";
import { readTmtCredentialStatus } from "@/modules/standards/tmt-credentials";
import { readInstallerLink } from "@/modules/agent/installer-link";
import { listTtmtOperationImports, readTmtOperations } from "@/modules/tmt/operations";
import { facilityCondition, mappedPercent } from "@/modules/admin/condition";
import { Alert, Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { IconDownload, IconLink } from "@/components/ui/icons";
import { AgentInstallerPanel } from "./agent-installer-panel";
import { FacilityAdminPanel } from "./facility-admin-panel";
import { FacilityOverviewTable, type FacilityOverviewRow } from "./facility-overview-table";
import { TmtApiPanel } from "./tmt-api-panel";
import { TmtOperationsPanel } from "./tmt-operations-panel";
import { TtmtImportPanel } from "./ttmt-import-panel";
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

  const [summaries, users, pending, misconfiguredAdmins, facilitylessUsers, tmtStatus, installerLink, tmtOperations, ttmtImports] = await Promise.all([
    facilitySummaries(),
    listUsers(),
    countPendingUsers(),
    countMisconfiguredAdmins(),
    countFacilitylessUsers(),
    readTmtCredentialStatus(),
    readInstallerLink(),
    readTmtOperations(),
    listTtmtOperationImports(),
  ]);
  const tmtReadiness = tmtOperations.readiness;

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
    exportReadyTotal: row.exportReadyTotal,
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
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={pending > 0 ? "warning" : "neutral"} dot={pending > 0}>
              รออนุมัติ {pending.toLocaleString("th-TH")} บัญชี
            </Badge>
            <Badge>สถานบริการ {summaries.length.toLocaleString("th-TH")} แห่ง</Badge>
          </div>
        }
      />

      <nav aria-label="ส่วนต่าง ๆ ของหน้าจัดการระบบ" className="flex flex-wrap gap-1.5 border-b border-border pb-3 text-xs font-medium text-primary-700 [&_a]:rounded-md [&_a]:border [&_a]:border-border [&_a]:bg-surface [&_a]:px-2.5 [&_a]:py-1.5 [&_a:hover]:border-primary-300">
        <a href="#admin-facility-overview">ภาพรวมสถานบริการ</a>
        <a href="#admin-facilities">จัดการสถานบริการ</a>
        <a href="#admin-users">บัญชีผู้ใช้</a>
        <a href="#admin-agent">ตัวติดตั้ง Agent</a>
        <a href="#admin-tmt-api">ตั้งค่า TMT API</a>
        <a href="#admin-tmt-operations">ดำเนินงาน TMT</a>
        <a href="#admin-ttmt">นำเข้า TTMT</a>
      </nav>

      {integrityProblems.length > 0 ? (
        <Alert tone="danger" title="พบข้อมูลที่ขัดกับกฎสิทธิ์">
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            {integrityProblems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <Card id="admin-facility-overview">
        <CardHeader
          title="ภาพรวมรายสถานบริการ"
          description={`ต้องแก้ ${blocked.toLocaleString("th-TH")} · รอดำเนินการ ${waiting.toLocaleString("th-TH")} · พร้อม ${ready.toLocaleString("th-TH")}`}
        />
        <CardBody flush className="pt-2.5">
          <FacilityOverviewTable rows={overviewRows} />
        </CardBody>
      </Card>

      <Card id="admin-facilities">
        <CardHeader
          title="จัดการสถานบริการ"
          description="เลือกสถานบริการเพื่อแก้การตั้งค่าหรือจัดการข้อมูล"
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

      <div className="grid min-w-0 gap-3 xl:grid-cols-2">
        <Card id="admin-agent">
          <CardHeader
            icon={<IconDownload size={16} />}
            title="ตัวติดตั้ง Agent"
            description="ลิงก์ที่ปุ่มดาวน์โหลดในหน้า “เชื่อมต่อ JHCIS” ของทุกสถานบริการชี้ไป"
          />
          <CardBody>
            <AgentInstallerPanel initial={installerLink} />
          </CardBody>
        </Card>

        <Card id="admin-tmt-api">
          <CardHeader
            icon={<IconLink size={16} />}
            title="TMT API และ readiness"
            description="ทดสอบการเชื่อมต่อแยกจากสถานะชุดข้อมูลที่ใช้งาน"
            actions={<Badge tone={tmtReadiness.assurance === "validated_unverified" ? "warning" : tmtReadiness.ready ? "success" : "danger"}>{tmtReadiness.ready ? tmtReadiness.assurance : "ยังไม่พร้อม"}</Badge>}
          />
          <CardBody>
            {tmtReadiness.assurance === "validated_unverified" ? <Alert tone="warning" className="mb-3" title="พร้อมใช้แบบ validated_unverified">ข้อมูลผ่านหลักฐาน validation ที่บันทึกไว้ แต่ยังไม่ใช่ verified จาก upstream</Alert> : null}
            <TmtApiPanel initial={tmtStatus} readiness={tmtReadiness.ready ? tmtReadiness.assurance : null} />
          </CardBody>
        </Card>
      </div>

      <Card id="admin-tmt-operations">
        <CardHeader
          title="การดำเนินงาน TMT"
          description="ติดตามงานซิงก์ ตรวจรับ และย้อนกลับชุดข้อมูล"
        />
        <CardBody>
          <TmtOperationsPanel initial={tmtOperations} />
        </CardBody>
      </Card>

      <Card id="admin-ttmt">
        <CardHeader
          title="นำเข้าและประวัติ TTMT"
          description="นำเข้าไฟล์ MasterTTMT และตรวจเวอร์ชันย้อนหลัง"
        />
        <CardBody>
          <TtmtImportPanel imports={ttmtImports} />
        </CardBody>
      </Card>

      <Card id="admin-users">
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
