import { redirect } from "next/navigation";
import { NoFacilityNotice, PageHeader } from "@/components/ui/page-header";
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
  if (!facility) return <NoFacilityNotice title="ส่งออก DrugCat" isAdmin={user.role === "admin"} />;

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={`${facility.code} · ${facility.name}`}
        title="ส่งออก DrugCat"
        description="สร้างไฟล์ .xls ตามฟอร์ม 22 คอลัมน์ของ สกส. ส่งออกเฉพาะสถานบริการที่กำลังปฏิบัติงานอยู่เท่านั้น"
      />
      <ExportPanel />
    </div>
  );
}
