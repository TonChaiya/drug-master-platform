import { z } from "zod";
import { apiJson } from "@/lib/api-response";
import { withFacilityContext } from "@/lib/authorization/require-context";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { drugMappings } from "@/db/schema";
import { MappingRuleError } from "@/modules/mappings/product-category";
import { MappingV2RuleError, MAPPING_STANDARD_SOURCES, TMT_MAPPING_LEVELS, TTMT_MAPPING_LEVEL } from "@/modules/mappings/v2";
import { saveV2Mapping } from "@/modules/mappings/v2-service";
import { tmtV2MappingEnabled } from "@/modules/tmt/feature";
import { maintenanceMutationResponse } from "@/modules/maintenance/route-guard";
import { requireTmtV2Ready } from "@/modules/tmt/readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  sourceDrugId: z.uuid(),
  standardSource: z.enum(MAPPING_STANDARD_SOURCES),
  standardCode: z.string().trim().min(1).max(64),
  standardLevel: z.union([z.enum(TMT_MAPPING_LEVELS), z.literal(TTMT_MAPPING_LEVEL)]),
  productCat: z.string().trim().max(8).optional().nullable(),
  specPrep: z.string().trim().max(255).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  confirmReview: z.boolean().optional(),
}).strict();
const lookupSchema = z.object({ sourceDrugId: z.uuid() });

export async function GET(request: Request) {
  if (!tmtV2MappingEnabled()) return apiJson({ ok: false, errorCode: "TMT_V2_MAPPING_DISABLED", message: "การจับคู่รายการยายังไม่เปิดใช้งาน" }, 503);
  const context = await withFacilityContext();
  if (!context.ok) return context.response;
  try { await requireTmtV2Ready(); } catch { return apiJson({ ok: false, errorCode: "TMT_V2_NOT_READY", message: "ข้อมูล TMT ยังไม่พร้อมใช้งาน" }, 503); }
  const parsed = lookupSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  if (!parsed.success) return apiJson({ ok: false, errorCode: "INVALID_QUERY", message: "ตัวกรองไม่ถูกต้อง" }, 400);
  const [mapping] = await db.select({ standardSource: drugMappings.standardSource, standardCode: drugMappings.standardCode, standardLevel: drugMappings.standardLevel, updatedAt: drugMappings.updatedAt })
    .from(drugMappings)
    .where(and(eq(drugMappings.facilityId, context.context.facilityId), eq(drugMappings.sourceDrugId, parsed.data.sourceDrugId)))
    .limit(1);
  return apiJson({ ok: true, mapping: mapping ?? null });
}

export async function POST(request: Request) {
  if (!tmtV2MappingEnabled()) return apiJson({ ok: false, errorCode: "TMT_V2_MAPPING_DISABLED", message: "การจับคู่รายการยายังไม่เปิดใช้งาน" }, 503);
  const context = await withFacilityContext();
  if (!context.ok) return context.response;
  const maintenance = await maintenanceMutationResponse();
  if (maintenance) return maintenance;
  try { await requireTmtV2Ready(); } catch { return apiJson({ ok: false, errorCode: "TMT_V2_NOT_READY", message: "ข้อมูล TMT ยังไม่พร้อมใช้งาน" }, 503); }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiJson({ ok: false, errorCode: "INVALID_INPUT", message: "ข้อมูลการจับคู่ไม่ถูกต้อง" }, 400);
  try {
    const result = await saveV2Mapping({ facilityId: context.context.facilityId, userId: context.context.actorUserId, ...parsed.data });
    return apiJson({ ok: true, ...result });
  } catch (error) {
    if (error instanceof MappingRuleError || error instanceof MappingV2RuleError) return apiJson({ ok: false, errorCode: error.code, message: error.message }, 409);
    return apiJson({ ok: false, errorCode: "MAPPING_V2_SAVE_FAILED", message: "บันทึกการจับคู่ไม่สำเร็จ" }, 500);
  }
}
