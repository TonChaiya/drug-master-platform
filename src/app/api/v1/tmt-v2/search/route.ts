import { z } from "zod";
import { dbPool } from "@/db/client";
import { apiJson, unauthorized } from "@/lib/api-response";
import { currentUser } from "@/modules/auth/session";
import { tmtV2BrowserEnabled } from "@/modules/tmt/feature";
import { searchTmt } from "@/modules/tmt/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const optionalText = z.string().trim().max(120).optional();
const schema = z.object({
  q: optionalText,
  level: z.enum(["subs", "vtm", "gp", "gpu", "gpp", "tp", "tpu", "tpp"]).optional(),
  status: z.enum(["active", "cancelled", "unknown"]).optional(),
  mappingEligible: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  manufacturer: optionalText,
  registration: optionalText,
  atc: optionalText,
  nlem: optionalText,
  limit: z.coerce.number().int().min(1).max(100).optional(),
}).refine((value) => [value.q, value.manufacturer, value.registration, value.atc, value.nlem].some(Boolean));

export async function GET(request: Request) {
  if (!(await currentUser())) return unauthorized();
  if (!tmtV2BrowserEnabled()) {
    return apiJson({ ok: false, errorCode: "TMT_V2_BROWSER_DISABLED", message: "TMT Browser v2 ยังไม่เปิดใช้งาน" }, 503);
  }

  const parsed = schema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  if (!parsed.success) return apiJson({ ok: false, errorCode: "INVALID_QUERY", message: "ตัวกรองไม่ถูกต้อง" }, 400);

  try {
    const { q, ...filters } = parsed.data;
    const rows = await searchTmt(dbPool(), { query: q, ...filters });
    return apiJson({ ok: true, rows, count: rows.length });
  } catch {
    console.error("tmt_v2.browser_search_failed");
    return apiJson({ ok: false, errorCode: "TMT_V2_SEARCH_FAILED", message: "ค้นหาข้อมูล TMT ไม่สำเร็จ" }, 500);
  }
}
