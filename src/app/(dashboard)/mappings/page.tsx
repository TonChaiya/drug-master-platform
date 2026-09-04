import { redirect } from "next/navigation";
import { NoFacilityNotice, PageHeader } from "@/components/ui/page-header";
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
  if (!facility) return <NoFacilityNotice title="จับคู่รายการยา" isAdmin={user.role === "admin"} />;

  const snapshot = await latestImport(facility.id);

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={`${facility.code} · ${facility.name}`}
        title="จับคู่รายการยา"
        description="จับคู่รหัสยาของ JHCIS กับรหัส TMT/TTMT บันทึกแล้วพร้อมส่งออกทันที ไม่มีขั้นตอนอนุมัติ"
      />
      <MappingWorkbench hasCatalog={Boolean(snapshot)} />
    </div>
  );
}
