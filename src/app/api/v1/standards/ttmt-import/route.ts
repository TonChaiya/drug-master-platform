import { apiJson } from "@/lib/api-response";
import { requireAdmin } from "@/lib/authorization/require-context";
import { TtmtImportError, importMasterTtmt } from "@/modules/standards/ttmt-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const version = String(form?.get("version") ?? "").trim();
  if (!(file instanceof File)) return apiJson({ ok: false, errorCode: "FILE_REQUIRED", message: "กรุณาแนบไฟล์ MasterTTMT" }, 400);
  if (file.size > MAX_UPLOAD_BYTES) return apiJson({ ok: false, errorCode: "FILE_TOO_LARGE", message: "ไฟล์ใหญ่เกิน 25 MB" }, 413);

  try {
    const result = await importMasterTtmt({
      userId: admin.user.id,
      filename: file.name,
      version,
      data: Buffer.from(await file.arrayBuffer()),
    });
    return apiJson({ ok: true, ...result });
  } catch (error) {
    if (error instanceof TtmtImportError) {
      return apiJson({ ok: false, errorCode: error.code, message: error.message, details: error.details ?? [] }, 400);
    }
    return apiJson({ ok: false, errorCode: "TTMT_IMPORT_FAILED", message: "นำเข้าไฟล์ไม่สำเร็จ" }, 500);
  }
}
