import { redirect } from "next/navigation";
import { V2MappingWorkbench } from "@/components/mappings/v2-mapping-workbench";
import { Alert } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { resolveEffectiveFacility } from "@/lib/authorization/effective-facility";
import { requireUser } from "@/modules/auth/session";
import { tmtV2BrowserEnabled, tmtV2CatalogEnabled, tmtV2MappingEnabled } from "@/modules/tmt/feature";
import { readTmtV2Readiness } from "@/modules/tmt/readiness";

export const dynamic = "force-dynamic";

export default async function MappingV2Page() {
  let user;
  try { user = await requireUser(); } catch { redirect("/login"); }
  if (!tmtV2MappingEnabled() || !tmtV2BrowserEnabled()) redirect("/mappings");
  const readiness = await readTmtV2Readiness();
  if (!readiness.ready) {
    return (
      <div className="space-y-4">
        <PageHeader title="จับคู่รายการยา" description="Mapping identity แบบแยก TMT/TTMT" />
        <Alert tone="warning" title="ข้อมูล TMT ยังไม่พร้อมใช้งาน">
          latest TMT sync ต้องมี verified หรือ validated-unverified readiness ก่อนเปิดการจับคู่รายการยา
        </Alert>
      </div>
    );
  }
  const facility = await resolveEffectiveFacility(user);
  if (!facility) redirect("/mappings");
  return <div className="space-y-4"><PageHeader eyebrow={`${facility.code} · ${facility.name} · การจับคู่รายการยา`} title="จับคู่รายการยา" description="ค้นหา กรอง และจับคู่รายการ JHCIS ด้วย identity TMT/TTMT ตามชนิดยา" />{readiness.assurance === "validated_unverified" ? <Alert tone="warning" title="กำลังใช้ข้อมูล TMT แบบ degraded">ชุดข้อมูลผ่าน validation แล้ว แต่ upstream ยังไม่ยืนยัน version</Alert> : null}<V2MappingWorkbench reconcileAvailable={tmtV2CatalogEnabled()} /></div>;
}
