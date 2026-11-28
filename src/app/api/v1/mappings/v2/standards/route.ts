import { z } from "zod";
import { dbPool } from "@/db/client";
import { apiJson } from "@/lib/api-response";
import { withFacilityContext } from "@/lib/authorization/require-context";
import { activeStandardReleaseEnabled, tmtV2MappingEnabled } from "@/modules/tmt/feature";
import { readActiveStandardRelease } from "@/modules/standards/active-release";
import { searchTtmtStandards } from "@/modules/standards/ttmt-search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const filter = z.string().trim().min(2).max(120).optional();
const schema = z.object({
  source: z.literal("TTMT"),
  q: filter,
  code: filter,
  tradeName: filter,
  genericName: filter,
  manufacturer: filter,
  registrationNumber: filter,
}).refine((value) => [value.q, value.code, value.tradeName, value.genericName, value.manufacturer, value.registrationNumber].some(Boolean));

export async function GET(request: Request) {
  if (!tmtV2MappingEnabled()) return apiJson({ ok: false, errorCode: "TMT_V2_MAPPING_DISABLED", message: "การจับคู่รายการยายังไม่เปิดใช้งาน" }, 503);
  const context = await withFacilityContext();
  if (!context.ok) return context.response;
  const parsed = schema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  if (!parsed.success) return apiJson({ ok: false, errorCode: "INVALID_QUERY", message: "ตัวกรองไม่ถูกต้อง" }, 400);
  try {
    const pool = dbPool();
    const release = activeStandardReleaseEnabled() ? await readActiveStandardRelease(pool) : undefined;
    const filters = {
      query: parsed.data.q,
      code: parsed.data.code,
      tradeName: parsed.data.tradeName,
      genericName: parsed.data.genericName,
      manufacturer: parsed.data.manufacturer,
      registrationNumber: parsed.data.registrationNumber,
    };
    const rows = await searchTtmtStandards(pool, filters, release);
    return apiJson({
      ok: true,
      rows: rows.map((row) => ({ source: "TTMT", code: row.code, level: "product", fsn: row.fsn, activeIngredient: row.activeIngredient, tradeName: row.tradeName, manufacturer: row.manufacturer, registrationNumber: row.registrationNumber, active: row.status === "active", sourceVersion: row.sourceVersion })),
    });
  } catch {
    console.error("mapping_v2.ttmt_search_failed");
    return apiJson({ ok: false, errorCode: "TTMT_SEARCH_FAILED", message: "ค้นหาข้อมูล TTMT ไม่สำเร็จ" }, 500);
  }
}
