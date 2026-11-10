import { apiJson } from "@/lib/api-response";
import { withFacilityContext } from "@/lib/authorization/require-context";
import { MappingRuleError } from "@/modules/mappings/product-category";
import { reconcileFromLatestCatalog } from "@/modules/mappings/service";
import { maintenanceMutationResponse } from "@/modules/maintenance/route-guard";
import { TmtV2NotReadyError } from "@/modules/tmt/readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  const context = await withFacilityContext();
  if (!context.ok) return context.response;
  const maintenance = await maintenanceMutationResponse();
  if (maintenance) return maintenance;

  try {
    const result = await reconcileFromLatestCatalog(context.context.facilityId, context.context.actorUserId);
    return apiJson({ ok: true, ...result });
  } catch (error) {
    if (error instanceof TmtV2NotReadyError) {
      return apiJson({ ok: false, errorCode: error.code, message: "ข้อมูล TMT v2 ยังไม่พร้อมใช้งาน" }, 503);
    }
    if (error instanceof MappingRuleError) {
      return apiJson({ ok: false, errorCode: error.code, message: error.message }, 409);
    }
    return apiJson({ ok: false, errorCode: "RECONCILE_FAILED", message: "จับคู่อัตโนมัติไม่สำเร็จ" }, 500);
  }
}
