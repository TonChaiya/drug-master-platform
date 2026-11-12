import { z } from "zod";
import { dbPool } from "@/db/client";
import { apiJson, unauthorized } from "@/lib/api-response";
import { currentUser } from "@/modules/auth/session";
import { getTmtConceptDetail } from "@/modules/tmt/detail";
import { tmtV2BrowserEnabled } from "@/modules/tmt/feature";
import { requireTmtV2Ready } from "@/modules/tmt/readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ id: z.string().regex(/^\d{1,20}$/) });
const querySchema = z.object({
  depth: z.coerce.number().int().min(0).max(4).default(2),
  maxNodes: z.coerce.number().int().min(1).max(200).default(200),
});

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await currentUser())) return unauthorized();
  if (!tmtV2BrowserEnabled()) {
    return apiJson({ ok: false, errorCode: "TMT_V2_BROWSER_DISABLED", message: "TMT Browser ยังไม่เปิดใช้งาน" }, 503);
  }
  try {
    await requireTmtV2Ready(dbPool());
  } catch {
    return apiJson({ ok: false, errorCode: "TMT_V2_NOT_READY", message: "ข้อมูล TMT ยังไม่พร้อมใช้งาน" }, 503);
  }

  const params = paramsSchema.safeParse(await context.params);
  const query = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  if (!params.success || !query.success) {
    return apiJson({ ok: false, errorCode: "INVALID_QUERY", message: "รหัสหรือขอบเขตการค้นหาไม่ถูกต้อง" }, 400);
  }

  try {
    const detail = await getTmtConceptDetail(dbPool(), params.data.id, {
      graphDepth: query.data.depth,
      maxNodes: query.data.maxNodes,
    });
    if (!detail) return apiJson({ ok: false, errorCode: "TMT_CONCEPT_NOT_FOUND", message: "ไม่พบรายการ TMT" }, 404);
    return apiJson({ ok: true, detail });
  } catch {
    console.error("tmt_v2.browser_detail_failed");
    return apiJson({ ok: false, errorCode: "TMT_V2_DETAIL_FAILED", message: "โหลดรายละเอียด TMT ไม่สำเร็จ" }, 500);
  }
}
