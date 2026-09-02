import { redirect } from "next/navigation";
import { resolveEffectiveFacility } from "@/lib/authorization/effective-facility";
import { requireUser } from "@/modules/auth/session";
import { latestImport, listImports, previewImportRows } from "@/modules/catalog/service";
import { formatBangkok } from "@/modules/facilities/queries";
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
  if (!facility) {
    return (
      <section className="card card-pad">
        <h1 className="page-title">Drug Catalog</h1>
        <p className="mt-1 text-xxs text-slate-500">เลือกสถานบริการก่อนจึงจะนำเข้าไฟล์ได้</p>
      </section>
    );
  }

  const [imports, snapshot] = await Promise.all([listImports(facility.id), latestImport(facility.id)]);
  const preview = snapshot ? await previewImportRows(facility.id, snapshot.id, 25) : [];

  return (
    <div className="space-y-3">
      <header>
        <h1 className="page-title">Drug Catalog</h1>
        <p className="text-xxs text-slate-500">
          {facility.code} · {facility.name}
          {snapshot ? ` — snapshot ล่าสุด ${snapshot.rowCount.toLocaleString("th-TH")} แถว (${formatBangkok(snapshot.createdAt)})` : " — ยังไม่มี snapshot"}
        </p>
      </header>

      <CatalogImportPanel />

      <section className="card card-pad">
        <h2 className="mb-2 text-sm font-semibold">ประวัติการนำเข้า</h2>
        {imports.length === 0 ? (
          <p className="text-xxs text-slate-500">ยังไม่มีการนำเข้าไฟล์สำหรับสถานบริการนี้</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
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
                {imports.map((row, index) => (
                  <tr key={row.id}>
                    <td>
                      {row.filename}
                      {index === 0 ? <span className="badge-ok ml-1.5">ล่าสุด</span> : null}
                    </td>
                    <td className="tabular-nums">{row.rowCount.toLocaleString("th-TH")}</td>
                    <td>{row.sourceVersion ?? "—"}</td>
                    <td>{row.sourceDate ?? "—"}</td>
                    <td>{formatBangkok(row.createdAt)}</td>
                    <td className="font-mono text-xxs text-slate-400">{row.contentHash.slice(0, 12)}…</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {preview.length > 0 ? (
        <section className="card card-pad">
          <h2 className="mb-2 text-sm font-semibold">ตัวอย่างแถวจริงจาก snapshot ล่าสุด (25 แถวแรก)</h2>
          <div className="overflow-x-auto">
            <table className="data-table">
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
                    <td className="tabular-nums">{row.sourceRowNumber}</td>
                    <td className="font-mono">{row.hospdrugcode}</td>
                    <td>{row.productcat ?? "—"}</td>
                    <td className="font-mono">{row.tmtid ?? "—"}</td>
                    <td className="max-w-64">{row.genericname ?? "—"}</td>
                    <td>{row.tradename ?? "—"}</td>
                    <td>{row.ised ?? "—"}</td>
                    <td>{row.updateflag ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
