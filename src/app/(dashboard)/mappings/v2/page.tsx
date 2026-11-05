import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { V2MappingWorkbench } from "@/components/mappings/v2-mapping-workbench";
import { PageHeader } from "@/components/ui/page-header";
import { db } from "@/db/client";
import { sourceDrugs } from "@/db/schema";
import { resolveEffectiveFacility } from "@/lib/authorization/effective-facility";
import { requireUser } from "@/modules/auth/session";
import { tmtV2BrowserEnabled, tmtV2MappingEnabled } from "@/modules/tmt/feature";

export const dynamic = "force-dynamic";

export default async function MappingV2Page() {
  let user;
  try { user = await requireUser(); } catch { redirect("/login"); }
  if (!tmtV2MappingEnabled() || !tmtV2BrowserEnabled()) redirect("/mappings");
  const facility = await resolveEffectiveFacility(user);
  if (!facility) redirect("/mappings");
  const rows = await db.select({ id: sourceDrugs.id, drugcode: sourceDrugs.drugcode, drugname: sourceDrugs.drugname, drugnamethai: sourceDrugs.drugnamethai, drugtype: sourceDrugs.drugtype }).from(sourceDrugs).where(eq(sourceDrugs.facilityId, facility.id)).orderBy(desc(sourceDrugs.updatedAt)).limit(100);
  return <div className="space-y-4"><PageHeader eyebrow={`${facility.code} · ${facility.name}`} title="จับคู่รายการยา v2" description="ทดลอง mapping ด้วย identity TMT/TTMT แบบแยก source โดยยังไม่ตัด legacy" /><V2MappingWorkbench sourceDrugs={rows} /></div>;
}
