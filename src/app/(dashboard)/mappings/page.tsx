import { redirect } from "next/navigation";
import { resolveEffectiveFacility } from "@/lib/authorization/effective-facility";
import { requireUser } from "@/modules/auth/session";
import { latestImport } from "@/modules/catalog/service";
import { MappingWorkbench } from "./mapping-workbench";

export const dynamic = "force-dynamic";

export default async function MappingsPage() {
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
        <h1 className="text-base font-semibold">จับคู่รายการยา</h1>
        <p className="mt-1 text-xxs text-slate-500">เลือกสถานบริการก่อนจึงจะจับคู่ได้</p>
      </section>
    );
  }

  const snapshot = await latestImport(facility.id);

  return (
    <div className="space-y-3">
      <header>
        <h1 className="text-base font-semibold">จับคู่รายการยา</h1>
        <p className="text-xxs text-slate-500">
          {facility.code} · {facility.name} — บันทึกสำเร็จแล้วพร้อมส่งออกทันที ไม่มีขั้นตอนอนุมัติ
        </p>
      </header>
      <MappingWorkbench hasCatalog={Boolean(snapshot)} />
    </div>
  );
}
