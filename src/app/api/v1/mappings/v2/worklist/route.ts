import { z } from "zod";
import { apiJson } from "@/lib/api-response";
import { withFacilityContext } from "@/lib/authorization/require-context";
import { mappingWorklistV2 } from "@/modules/mappings/v2-worklist";
import { tmtV2MappingEnabled } from "@/modules/tmt/feature";
import { readTmtConsumerContext } from "@/modules/tmt/readiness";
import type { StandardDatasetSelection } from "@/modules/standards/dataset-selection";

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
  const parsed = schema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  if (!parsed.success) return apiJson({ ok: false, errorCode: "INVALID_QUERY", message: "ตัวกรองไม่ถูกต้อง" }, 400);
  let dataset: StandardDatasetSelection | null | undefined;
  if (parsed.data.drugType !== "10") {
    const tmt = await readTmtConsumerContext();
    dataset = tmt.readiness.ready ? tmt.release : null;
  }
  const result = await mappingWorklistV2({
    facilityId: context.context.facilityId, ...parsed.data, ...(dataset === undefined ? {} : { dataset }),
  });
  return apiJson({ ok: true, ...result });
}
