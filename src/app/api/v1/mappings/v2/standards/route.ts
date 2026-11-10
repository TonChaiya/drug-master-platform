import { and, eq, like, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { ttmtImports, ttmtProducts } from "@/db/schema";
import { apiJson } from "@/lib/api-response";
import { withFacilityContext } from "@/lib/authorization/require-context";
import { tmtV2MappingEnabled } from "@/modules/tmt/feature";
import { requireTmtV2Ready } from "@/modules/tmt/readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ source: z.literal("TTMT"), q: z.string().trim().min(2).max(120) });

export async function GET(request: Request) {
  if (!tmtV2MappingEnabled()) return apiJson({ ok: false, errorCode: "TMT_V2_MAPPING_DISABLED", message: "Mapping v2 ยังไม่เปิดใช้งาน" }, 503);
  const context = await withFacilityContext();
  if (!context.ok) return context.response;
  try { await requireTmtV2Ready(); } catch { return apiJson({ ok: false, errorCode: "TMT_V2_NOT_READY", message: "ข้อมูล TMT v2 ยังไม่พร้อมใช้งาน" }, 503); }
  const parsed = schema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  if (!parsed.success) return apiJson({ ok: false, errorCode: "INVALID_QUERY", message: "ตัวกรองไม่ถูกต้อง" }, 400);
  const query = parsed.data.q;
  try {
    const rows = await db
      .select({ code: ttmtProducts.ttmtcode, fsn: ttmtProducts.fsn, activeIngredient: ttmtProducts.activeingredient, tradeName: ttmtProducts.tradename, status: ttmtProducts.status, sourceVersion: ttmtProducts.sourceVersion, importStatus: ttmtImports.status })
      .from(ttmtProducts)
      .innerJoin(ttmtImports, eq(ttmtImports.id, ttmtProducts.sourceImportId))
      .where(and(eq(ttmtImports.status, "succeeded"), or(like(ttmtProducts.ttmtcode, `${query}%`), like(ttmtProducts.normalizedGeneric, `${query.toLowerCase()}%`), like(ttmtProducts.normalizedTrade, `${query.toLowerCase()}%`))))
      .limit(30);
    return apiJson({
      ok: true,
      rows: rows.map((row) => ({ source: "TTMT", code: row.code, level: "product", fsn: row.fsn, activeIngredient: row.activeIngredient, tradeName: row.tradeName, active: row.status === "active", sourceVersion: row.sourceVersion })),
    });
  } catch {
    console.error("mapping_v2.ttmt_search_failed");
    return apiJson({ ok: false, errorCode: "TTMT_SEARCH_FAILED", message: "ค้นหาข้อมูล TTMT ไม่สำเร็จ" }, 500);
  }
}
