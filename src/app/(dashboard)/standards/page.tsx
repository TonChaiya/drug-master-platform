import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { TmtBrowser } from "@/app/(dashboard)/admin/tmt-v2/tmt-browser";
import { Alert, Badge, StatusBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { IconStandards } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { Table, TableMessage, TableScroll } from "@/components/ui/table";
import { db, dbPool } from "@/db/client";
import { ttmtImports } from "@/db/schema";
import { requireUser } from "@/modules/auth/session";
import { formatBangkok } from "@/modules/facilities/queries";
import { readStandardDatasetCounts } from "@/modules/standards/versioned-read";
import { tmtV2BrowserEnabled } from "@/modules/tmt/feature";
import { readTmtConsumerContext } from "@/modules/tmt/readiness";
import { TtmtSearch } from "./ttmt-search";

export const dynamic = "force-dynamic";

export default async function StandardsPage() {
  try {
    await requireUser();
  } catch {
    redirect("/login");
  }

  const pool = dbPool();
  const context = await readTmtConsumerContext(pool);
  const { readiness } = context;
  const [datasetCounts, imports] = await Promise.all([
    readStandardDatasetCounts(pool, context.release),
    db.select().from(ttmtImports).where(eq(ttmtImports.status, "succeeded")).orderBy(desc(ttmtImports.completedAt)).limit(10),
  ]);
  const browserReady = tmtV2BrowserEnabled() && readiness.ready;
  const assuranceLabel = readiness.ready
    ? readiness.assurance === "verified" ? "ยืนยันเวอร์ชันแล้ว" : "ตรวจสอบครบแบบ degraded"
    : "ยังไม่พร้อมใช้งาน";

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="ขั้นตอนที่ 2 · คลังมาตรฐานส่วนกลาง"
        title="Standards Hub · TMT / TTMT"
        description="ค้นหามาตรฐานปัจจุบันก่อนใช้ Drug Catalog และการจับคู่รายการยา — TMT กับ TTMT แยก namespace ชัดเจน"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={readiness.ready ? "success" : "danger"}>TMT {datasetCounts.tmtTotal.toLocaleString("th-TH")}</Badge>
            <Badge tone="info">TTMT {datasetCounts.ttmtTotal.toLocaleString("th-TH")}</Badge>
            <Badge tone={readiness.assurance === "validated_unverified" ? "warning" : readiness.ready ? "success" : "danger"}>{assuranceLabel}</Badge>
          </div>
        }
      />

      {readiness.ready && readiness.assurance === "validated_unverified" ? (
        <Alert tone="warning" title="ข้อมูล TMT พร้อมใช้แบบ validated-unverified">
          ชุดข้อมูลผ่าน checkpoint, invariants และการตรวจรับที่บันทึกไว้แล้ว แต่ upstream ยังไม่ส่งเวอร์ชัน จึงไม่เรียกว่า verified
        </Alert>
      ) : null}

      <section className="space-y-3" aria-labelledby="tmt-v2-heading">
        <div><h2 id="tmt-v2-heading" className="type-section-title">ค้นหา TMT</h2><p className="type-help mt-1">แสดงระดับ สี FSN ชื่อการค้า ผู้ผลิต เลขทะเบียน สถานะ และความพร้อมจับคู่จากข้อมูล TMT</p></div>
        {browserReady ? <TmtBrowser mode="advanced" /> : <Alert tone="danger" title="ข้อมูล TMT ยังไม่พร้อมค้นหา">ตรวจ readiness และการตั้งค่าระบบก่อนใช้งาน ระบบจะไม่สลับไปใช้ชุดข้อมูลอื่นโดยอัตโนมัติ</Alert>}
      </section>

      <TtmtSearch />

      <Card>
        <CardHeader title="ประวัตินำเข้า TTMT ปัจจุบัน" description="ข้อมูลจากประวัตินำเข้า TTMT ปัจจุบัน แยกจากประวัติ MasterTMT เดิม" />
        <CardBody flush className="pt-3">
          <TableScroll><Table><thead><tr><th>เวอร์ชันข้อมูล TTMT</th><th>จำนวนแถว</th><th>นำเข้าเมื่อ</th><th>สถานะ</th></tr></thead><tbody>
            {imports.length === 0 ? <TableMessage colSpan={4}><EmptyState compact icon={<IconStandards size={18} />} title="ยังไม่มี TTMT ที่นำเข้าสำเร็จ" /></TableMessage> : imports.map((row) => (
              <tr key={row.id}><td className="cell-code">{row.version}</td><td className="cell-num">{row.rowCount.toLocaleString("th-TH")}</td><td>{formatBangkok(row.completedAt)}</td><td><StatusBadge status={row.status} /></td></tr>
            ))}
          </tbody></Table></TableScroll>
        </CardBody>
      </Card>

      <Alert tone="info" title="ใช้คลังมาตรฐานปัจจุบันเพียงระบบเดียว">
        ข้อมูลสำหรับความเข้ากันได้ยังคงเก็บภายใน แต่ไม่แสดงเป็น workflow แยกและไม่ถูกนำเสนอว่าเป็นข้อมูล TMT ปัจจุบัน
      </Alert>
    </div>
  );
}
