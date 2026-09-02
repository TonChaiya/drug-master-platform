import { z } from "zod";
import { apiJson } from "@/lib/api-response";
import { withFacilityContext } from "@/lib/authorization/require-context";
import { MappingRuleError } from "@/modules/mappings/product-category";
import { saveManualMapping } from "@/modules/mappings/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();
const optionalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable();

const schema = z
  .object({
    sourceDrugId: z.uuid(),
    standardCode: z.string().trim().min(1).max(64),
    productCat: optionalText(8),
    specPrep: optionalText(255),
    dfscode: optionalText(64),
    unitPrice: optionalText(80),
    distributor: optionalText(255),
    ndc24: optionalText(32),
    packsize: optionalText(120),
    packPrice: optionalText(80),
    dateChange: optionalDate,
    dateUpdate: optionalDate,
    dateEffective: optionalDate,
    notes: optionalText(500),
  })
  .strict();

export async function POST(request: Request) {
  const context = await withFacilityContext();
  if (!context.ok) return context.response;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiJson({ ok: false, errorCode: "INVALID_INPUT", message: "ข้อมูลการจับคู่ไม่ถูกต้อง" }, 400);

  try {
    const result = await saveManualMapping({
      facilityId: context.context.facilityId,
      userId: context.context.actorUserId,
      ...parsed.data,
    });
    return apiJson({ ok: true, ...result });
  } catch (error) {
    if (error instanceof MappingRuleError) {
      return apiJson({ ok: false, errorCode: error.code, message: error.message }, 409);
    }
    return apiJson({ ok: false, errorCode: "MAPPING_SAVE_FAILED", message: "บันทึกการจับคู่ไม่สำเร็จ" }, 500);
  }
}
