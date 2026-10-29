import { z } from "zod";
import { apiJson } from "@/lib/api-response";
import { withFacilityContext } from "@/lib/authorization/require-context";
import { createExport, ExportPreviewStaleError } from "@/modules/exports/service";
import { ExportContractError } from "@/modules/exports/writer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const schema = z
  .object({ selection: z.enum(["all-mapped", "manual-changes"]), previewToken: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();

export async function POST(request: Request) {
  const context = await withFacilityContext();
  if (!context.ok) return context.response;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiJson({ ok: false, errorCode: "INVALID_INPUT", message: "ตัวเลือกไม่ถูกต้อง" }, 400);

  try {
    const bundle = await createExport({
      facilityId: context.context.facilityId,
      facilityCode: context.context.facility.code,
      userId: context.context.actorUserId,
      selection: parsed.data.selection,
      previewToken: parsed.data.previewToken,
    });
    return new Response(new Uint8Array(bundle.buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.ms-excel",
        "Content-Disposition": `attachment; filename="${bundle.filename}"`,
        "Content-Length": String(bundle.buffer.length),
        "X-Export-Row-Count": String(bundle.rowCount),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof ExportPreviewStaleError) {
      return apiJson({ ok: false, errorCode: error.code, message: error.message }, 409);
    }
    if (error instanceof ExportContractError) {
      return apiJson({ ok: false, errorCode: error.code, message: error.message }, 409);
    }
    return apiJson({ ok: false, errorCode: "EXPORT_FAILED", message: "สร้างไฟล์ส่งออกไม่สำเร็จ" }, 500);
  }
}
