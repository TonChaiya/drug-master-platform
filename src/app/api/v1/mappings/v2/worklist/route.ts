import { z } from "zod";
import { apiJson } from "@/lib/api-response";
import { withFacilityContext } from "@/lib/authorization/require-context";
import { mappingWorklistV2 } from "@/modules/mappings/v2-worklist";
import { tmtV2MappingEnabled } from "@/modules/tmt/feature";
import { requireTmtV2Ready } from "@/modules/tmt/readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  query: z.string().trim().max(120).optional(),
  status: z.enum(["all", "mapped", "pending", "needs_review"]).optional(),
  drugType: z.enum(["all", "01", "10"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

export async function GET(request: Request) {
  if (!tmtV2MappingEnabled()) return apiJson({ ok: false, errorCode: "TMT_V2_MAPPING_DISABLED", message: "การจับคู่รายการยายังไม่เปิดใช้งาน" }, 503);
  const context = await withFacilityContext();
  if (!context.ok) return context.response;
  try { await requireTmtV2Ready(); } catch { return apiJson({ ok: false, errorCode: "TMT_V2_NOT_READY", message: "ข้อมูล TMT ยังไม่พร้อมใช้งาน" }, 503); }
  const parsed = schema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  if (!parsed.success) return apiJson({ ok: false, errorCode: "INVALID_QUERY", message: "ตัวกรองไม่ถูกต้อง" }, 400);
  const result = await mappingWorklistV2({ facilityId: context.context.facilityId, ...parsed.data });
  return apiJson({ ok: true, ...result });
}
