import { redirect } from "next/navigation";
import { V2MappingWorkbench } from "@/components/mappings/v2-mapping-workbench";
import { Alert } from "@/components/ui/badge";
import { NoFacilityNotice, PageHeader } from "@/components/ui/page-header";
import { dbPool } from "@/db/client";
import { resolveEffectiveFacility } from "@/lib/authorization/effective-facility";
import { requireUser } from "@/modules/auth/session";
import { latestImport } from "@/modules/catalog/service";
import { tmtV2BrowserEnabled, tmtV2CatalogEnabled, tmtV2MappingEnabled } from "@/modules/tmt/feature";
import { readTmtConsumerContext } from "@/modules/tmt/readiness";
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

  if (tmtV2MappingEnabled() && tmtV2BrowserEnabled()) {
    const { readiness } = await readTmtConsumerContext(dbPool());
    if (!readiness.ready) {
      return (
        <div className="space-y-4">
          <PageHeader title="จับคู่รายการยา" description="จับคู่รายการ JHCIS กับมาตรฐาน TMT/TTMT ปัจจุบัน" />
          <Alert tone="warning" title="ข้อมูล TMT ยังไม่พร้อมใช้งาน">
            latest TMT sync ต้องมี verified หรือ validated-unverified readiness ก่อนเปิดการจับคู่รายการยา
          </Alert>
        </div>
      );
    }
    return (
      <div className="space-y-4">
        <PageHeader eyebrow={`${facility.code} · ${facility.name} · การจับคู่รายการยา`} title="จับคู่รายการยา" description="ค้นหา กรอง และจับคู่รายการ JHCIS ด้วย identity TMT/TTMT ตามชนิดยา" />
        {readiness.assurance === "validated_unverified" ? <Alert tone="warning" title="กำลังใช้ข้อมูล TMT แบบ degraded">ชุดข้อมูลผ่าน validation แล้ว แต่ upstream ยังไม่ยืนยัน version</Alert> : null}
        <V2MappingWorkbench reconcileAvailable={tmtV2CatalogEnabled()} />
      </div>
    );
  }

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
