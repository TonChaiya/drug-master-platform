import { apiJson } from "@/lib/api-response";
import { withFacilityContext } from "@/lib/authorization/require-context";
import { CatalogParseError } from "@/modules/catalog/parser";
import { importDrugCatalog } from "@/modules/catalog/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export async function POST(request: Request) {
  const context = await withFacilityContext();
  if (!context.ok) return context.response;

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return apiJson({ ok: false, errorCode: "FILE_REQUIRED", message: "กรุณาแนบไฟล์ Drug Catalog" }, 400);
  if (file.size > MAX_UPLOAD_BYTES) return apiJson({ ok: false, errorCode: "FILE_TOO_LARGE", message: "ไฟล์ใหญ่เกิน 25 MB" }, 413);

  const sourceVersion = String(form?.get("sourceVersion") ?? "").trim() || null;
  const sourceDateRaw = String(form?.get("sourceDate") ?? "").trim();
  const sourceDate = /^\d{4}-\d{2}-\d{2}$/.test(sourceDateRaw) ? sourceDateRaw : null;

  try {
    const result = await importDrugCatalog({
      facilityId: context.context.facilityId,
      userId: context.context.actorUserId,
      filename: file.name,
      data: Buffer.from(await file.arrayBuffer()),
      sourceVersion,
      sourceDate,
    });
    return apiJson({ ok: true, ...result });
  } catch (error) {
    if (error instanceof CatalogParseError) {
      return apiJson({ ok: false, errorCode: error.code, message: error.message, details: error.details ?? [] }, 400);
    }
    return apiJson({ ok: false, errorCode: "CATALOG_IMPORT_FAILED", message: "นำเข้าไฟล์ไม่สำเร็จ" }, 500);
  }
}
