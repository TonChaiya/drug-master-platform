import { redirect } from "next/navigation";
import { requireUser } from "@/modules/auth/session";
import { standardCounts } from "@/modules/standards/search";
import { listStandardImports } from "@/modules/standards/ttmt-import";
import { formatBangkok } from "@/modules/facilities/queries";
import { readSyncProgress } from "@/modules/standards/sync";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { Table, TableMessage, TableScroll } from "@/components/ui/table";
import { IconStandards } from "@/components/ui/icons";
import { StandardsPanel } from "./standards-panel";

export const dynamic = "force-dynamic";

export default async function StandardsPage() {
  let user;
  try {
    user = await requireUser();
  } catch {
    redirect("/login");
  }

  const [counts, imports, progress] = await Promise.all([standardCounts(), listStandardImports(10), readSyncProgress()]);

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="คลังมาตรฐานที่ใช้ร่วมกันทุกสถานบริการ"
        title="มาตรฐาน TMT / TTMT"
        description="รหัสมาตรฐานที่เปิดใช้งานอยู่ ใช้เป็นคำตอบของการจับคู่รายการยาทุกสถานบริการ"
        actions={
          <div className="flex items-center gap-2">
            <Badge tone="info">TMT {counts.tmt.toLocaleString("th-TH")}</Badge>
            <Badge tone="info">TTMT {counts.ttmt.toLocaleString("th-TH")}</Badge>
          </div>
        }
      />

      <StandardsPanel initialProgress={progress} isAdmin={user.role === "admin"} />

      <Card>
        <CardHeader title="ประวัตินำเข้า MasterTTMT" description="สิบครั้งล่าสุด" />
        <CardBody flush className="pt-3">
          <TableScroll>
            <Table>
              <thead>
                <tr>
                  <th>ชนิด</th>
                  <th>เวอร์ชัน</th>
                  <th>จำนวนแถว</th>
                  <th>เริ่ม</th>
                  <th>สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {imports.length === 0 ? (
                  <TableMessage colSpan={5}>
                    <EmptyState
                      compact
                      icon={<IconStandards size={18} />}
                      title="ยังไม่มีประวัติการนำเข้า"
                      description="ประวัติจะปรากฏที่นี่หลังผู้ดูแลระบบนำเข้าไฟล์ MasterTTMT ครั้งแรก"
                    />
                  </TableMessage>
                ) : (
                  imports.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <Badge>{row.kind}</Badge>
                      </td>
                      <td className="cell-code">{row.version}</td>
                      <td className="cell-num">{row.rowCount.toLocaleString("th-TH")}</td>
                      <td className="whitespace-nowrap">{formatBangkok(row.startedAt)}</td>
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
  );
}
