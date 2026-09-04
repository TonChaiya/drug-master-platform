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
import { EmptyState, ProgressBar } from "@/components/ui/states";
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

  const conditions = summaries.map((row) => facilityCondition(row));
  const blocked = conditions.filter((condition) => condition.tone === "danger").length;
  const waiting = conditions.filter((condition) => condition.tone === "warning").length;
  const ready = conditions.filter((condition) => condition.tone === "success").length;

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
        <CardHeader
          title="ภาพรวมรายสถานบริการ"
          description="สถานะทางซ้ายสรุปจากตัวเลขในแถวเดียวกัน สถานบริการที่ต้องแก้จะมีคำอธิบายใต้ชื่อ"
          actions={
            <div className="flex flex-wrap items-center gap-1.5">
              {blocked > 0 ? (
                <Badge tone="danger" dot>
                  ต้องแก้ด่วน {blocked.toLocaleString("th-TH")}
                </Badge>
              ) : null}
              {waiting > 0 ? (
                <Badge tone="warning" dot>
                  รอดำเนินการ {waiting.toLocaleString("th-TH")}
                </Badge>
              ) : null}
              {/* Green on a count of zero would be reassuring about nothing. */}
              <Badge tone={ready > 0 ? "success" : "neutral"} dot={ready > 0}>
                พร้อมส่งออก {ready.toLocaleString("th-TH")}
              </Badge>
            </div>
          }
        />
        <CardBody flush className="pt-3">
          <TableScroll>
            <Table>
              <thead>
                <tr>
                  <th>สถานะ</th>
                  <th>สถานบริการ</th>
                  <th>รายการยาจาก JHCIS</th>
                  <th>จับคู่มาตรฐาน</th>
                  <th>บัญชี</th>
                  <th>Agent</th>
                  <th>จับคู่ล่าสุด</th>
                </tr>
              </thead>
              <tbody>
                {summaries.length === 0 ? (
                  <TableMessage colSpan={7}>
                    <EmptyState
                      compact
                      icon={<IconShield size={18} />}
                      title="ยังไม่มีสถานบริการที่เปิดใช้งาน"
                      description="สถานบริการถูกสร้างขึ้นเมื่อบัญชีแรกของรหัสนั้นสมัครสมาชิก"
                    />
                  </TableMessage>
                ) : (
                  summaries.map((row) => {
                    const condition = facilityCondition(row);
                    const percent = mappedPercent(row);
                    return (
                      <tr key={row.facilityId}>
                        <td>
                          <Badge tone={condition.tone} dot title={condition.detail}>
                            {condition.label}
                          </Badge>
                        </td>

                        <td className="max-w-72">
                          <div className="flex items-baseline gap-1.5">
                            <span className="cell-code text-slate-500">{row.facilityCode}</span>
                            <span className="font-medium">{row.facilityName}</span>
                          </div>
                          {/* Only on rows that need something done, so the eye
                              lands on them rather than reading every line. */}
                          {condition.needsAttention ? (
                            <p className="type-help mt-0.5">{condition.detail}</p>
                          ) : null}
                        </td>

                        <td className="cell-num">
                          {row.sourceTotal === 0 ? (
                            <span className="text-slate-400">—</span>
                          ) : (
                            <>
                              <div className="font-medium">{row.sourceTotal.toLocaleString("th-TH")}</div>
                              <div className="type-help">
                                01: {row.type01.toLocaleString("th-TH")} · 10: {row.type10.toLocaleString("th-TH")}
                              </div>
                            </>
                          )}
                        </td>

                        {/* Mapped and outstanding were separate columns of bare
                            numbers; as a fraction with a bar the same two values
                            say how far along the facility is. */}
                        <td className="w-44">
                          {row.sourceTotal === 0 ? (
                            <span className="text-slate-400">—</span>
                          ) : (
                            <ProgressBar
                              value={row.mappedTotal}
                              max={row.sourceTotal}
                              tone={percent === 100 ? "success" : "warning"}
                              label={`${row.mappedTotal.toLocaleString("th-TH")} / ${row.sourceTotal.toLocaleString("th-TH")}`}
                            />
                          )}
                        </td>

                        <td className="cell-num">
                          {row.accountCount === 0 ? (
                            <Badge tone="danger" title="ไม่มีบัญชีผูกกับสถานบริการนี้ จึงไม่มีใครเข้าใช้งานได้">
                              ไม่มี
                            </Badge>
                          ) : (
                            row.accountCount.toLocaleString("th-TH")
                          )}
                        </td>

                        <td className="cell-num">
                          {row.agentCount === 0 ? (
                            <span className="text-slate-400">—</span>
                          ) : (
                            <>
                              <div>{row.agentCount.toLocaleString("th-TH")}</div>
                              {row.agentMismatchCount > 0 ? (
                                <Badge
                                  tone="danger"
                                  className="mt-0.5"
                                  title={`${row.agentMismatchCount} เครื่องรายงาน office.offid ไม่ตรงกับรหัส ${row.facilityCode} จึงถูกปฏิเสธทุกคำขอ`}
                                >
                                  ไม่ตรง {row.agentMismatchCount}
                                </Badge>
                              ) : null}
                            </>
                          )}
                        </td>

                        <td className="whitespace-nowrap">
                          {row.lastMappedAt ? formatBangkok(row.lastMappedAt) : <span className="text-slate-400">—</span>}
                        </td>
                      </tr>
                    );
                  })
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
