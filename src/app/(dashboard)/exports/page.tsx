import { redirect } from "next/navigation";
import { resolveEffectiveFacility } from "@/lib/authorization/effective-facility";
import { requireUser } from "@/modules/auth/session";
import { ExportPanel } from "./export-panel";

export const dynamic = "force-dynamic";

export default async function ExportsPage() {
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
        <h1 className="text-base font-semibold">ส่งออก DrugCat</h1>
        <p className="mt-1 text-xxs text-slate-500">เลือกสถานบริการก่อนจึงจะส่งออกได้</p>
      </section>
    );
  }

  return (
    <div className="space-y-3">
      <header>
        <h1 className="text-base font-semibold">ส่งออก DrugCat</h1>
        <p className="text-xxs text-slate-500">
          {facility.code} · {facility.name} — ส่งออกเฉพาะสถานบริการที่กำลังปฏิบัติงานอยู่เท่านั้น
        </p>
      </header>
      <ExportPanel />
    </div>
  );
}
