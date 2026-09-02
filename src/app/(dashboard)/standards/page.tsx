import { redirect } from "next/navigation";
import { requireUser } from "@/modules/auth/session";
import { standardCounts } from "@/modules/standards/search";
import { listStandardImports } from "@/modules/standards/ttmt-import";
import { formatBangkok } from "@/modules/facilities/queries";
import { StandardsPanel } from "./standards-panel";

export const dynamic = "force-dynamic";

export default async function StandardsPage() {
  let user;
  try {
    user = await requireUser();
  } catch {
    redirect("/login");
  }

  const [counts, imports] = await Promise.all([standardCounts(), listStandardImports(10)]);

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-base font-semibold">มาตรฐาน TMT / TTMT</h1>
        <p className="text-xxs text-slate-500">
          เปิดใช้งานอยู่ — TMT {counts.tmt.toLocaleString("th-TH")} · TTMT {counts.ttmt.toLocaleString("th-TH")}
        </p>
      </header>

      <StandardsPanel isAdmin={user.role === "admin"} />

      <section className="card card-pad">
        <h2 className="mb-2 text-sm font-semibold">ประวัตินำเข้า MasterTTMT</h2>
        {imports.length === 0 ? (
          <p className="text-xxs text-slate-500">ยังไม่มีประวัติการนำเข้า</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
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
                {imports.map((row) => (
                  <tr key={row.id}>
                    <td className="font-mono">{row.kind}</td>
                    <td className="font-mono">{row.version}</td>
                    <td className="tabular-nums">{row.rowCount.toLocaleString("th-TH")}</td>
                    <td>{formatBangkok(row.startedAt)}</td>
                    <td>
                      <span className={row.status === "succeeded" ? "badge-ok" : row.status === "failed" ? "badge-danger" : "badge-warn"}>
                        {row.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
