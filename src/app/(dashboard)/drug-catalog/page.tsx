import { redirect } from "next/navigation";
import { resolveEffectiveFacility } from "@/lib/authorization/effective-facility";
import { requireUser } from "@/modules/auth/session";
import { latestImport, listImports, previewImportRows } from "@/modules/catalog/service";
import { formatBangkok } from "@/modules/facilities/queries";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { NoFacilityNotice, PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { Table, TableMessage, TableScroll } from "@/components/ui/table";
import { IconCatalog } from "@/components/ui/icons";
import { CatalogImportPanel } from "./import-panel";

export const dynamic = "force-dynamic";

export default async function DrugCatalogPage() {
  let user;
  try {
    user = await requireUser();
  } catch {
    redirect("/login");
  }

  const facility = await resolveEffectiveFacility(user);
  if (!facility) return <NoFacilityNotice title="Drug Catalog" isAdmin={user.role === "admin"} />;

  const [imports, snapshot] = await Promise.all([listImports(facility.id), latestImport(facility.id)]);
  const preview = snapshot ? await previewImportRows(facility.id, snapshot.id, 25) : [];

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={`${facility.code} · ${facility.name}`}
        title="Drug Catalog"
        description="ไฟล์ที่ผ่านการประมวลผลจากระบบกลาง ใช้เป็นแหล่งอ้างอิงเดียวของ NDC24 และรหัส TMT ในการจับคู่"
        actions={
          snapshot ? (
            <Badge tone="success" dot>
              snapshot ล่าสุด {snapshot.rowCount.toLocaleString("th-TH")} แถว · {formatBangkok(snapshot.createdAt)}
            </Badge>
          ) : (
            <Badge tone="warning" dot>
              ยังไม่มี snapshot
            </Badge>
          )
        }
      />

      <CatalogImportPanel />

      <Card>
        <CardHeader title="ประวัติการนำเข้า" description="ไฟล์ที่เนื้อหาซ้ำกับที่เคยนำเข้าจะถูกปฏิเสธ" />
        <CardBody flush className="pt-3">
          <TableScroll>
            <Table>
              <thead>
                <tr>
                  <th>ไฟล์</th>
                  <th>แถว</th>
                  <th>เวอร์ชัน</th>
                  <th>วันที่ไฟล์</th>
                  <th>นำเข้าเมื่อ</th>
                  <th>SHA-256</th>
                </tr>
              </thead>
              <tbody>
                {imports.length === 0 ? (
                  <TableMessage colSpan={6}>
                    <EmptyState
                      compact
                      icon={<IconCatalog size={18} />}
                      title="ยังไม่มีการนำเข้าไฟล์สำหรับสถานบริการนี้"
                      description="นำเข้าไฟล์ Drug Catalog ด้านบน จึงจะจับคู่อัตโนมัติและอ้างอิง NDC24 ได้"
                    />
                  </TableMessage>
                ) : (
                  imports.map((row, index) => (
                    <tr key={row.id}>
                      <td>
                        <span className="font-medium">{row.filename}</span>
                        {index === 0 ? (
                          <Badge tone="success" className="ml-1.5">
                            ล่าสุด
                          </Badge>
                        ) : null}
                      </td>
                      <td className="cell-num">{row.rowCount.toLocaleString("th-TH")}</td>
                      <td>{row.sourceVersion ?? "—"}</td>
                      <td className="whitespace-nowrap">{row.sourceDate ?? "—"}</td>
                      <td className="whitespace-nowrap">{formatBangkok(row.createdAt)}</td>
                      <td className="cell-code text-slate-500" title={row.contentHash}>
                        {row.contentHash.slice(0, 12)}…
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          </TableScroll>
        </CardBody>
      </Card>

      {preview.length > 0 ? (
        <Card>
          <CardHeader
            title="ตัวอย่างแถวจริงจาก snapshot ล่าสุด"
            description="25 แถวแรก แสดงค่าตามที่อ่านได้จากไฟล์ ไม่มีการเติมหรือแปลงค่า"
          />
          <CardBody flush className="pt-3">
            <TableScroll>
              <Table>
                <thead>
                  <tr>
                    <th>แถว</th>
                    <th>HOSPDRUGCODE</th>
                    <th>PRODUCTCAT</th>
                    <th>TMTID</th>
                    <th>GENERICNAME</th>
                    <th>TRADENAME</th>
                    <th>ISED</th>
                    <th>UPDATEFLAG</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row) => (
                    <tr key={row.id}>
                      <td className="cell-num text-slate-500">{row.sourceRowNumber}</td>
                      <td className="cell-code">{row.hospdrugcode}</td>
                      <td>{row.productcat ?? "—"}</td>
                      <td className="cell-code">{row.tmtid ?? "—"}</td>
                      <td className="max-w-64 font-medium text-ink">{row.genericname ?? "—"}</td>
                      <td className="max-w-48 text-slate-600">{row.tradename ?? "—"}</td>
                      <td>{row.ised ?? "—"}</td>
                      <td>{row.updateflag ? <Badge>{row.updateflag}</Badge> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableScroll>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
