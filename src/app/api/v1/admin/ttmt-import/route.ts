import { z } from "zod";
import { apiJson } from "@/lib/api-response";
import { requireAdmin } from "@/lib/authorization/require-context";
import { maintenanceMutationResponse } from "@/modules/maintenance/route-guard";
import { TtmtImportError, importMasterTtmtV2 } from "@/modules/standards/ttmt-v2-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const versionSchema = z.string().trim().min(1).max(120);

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  const maintenance = await maintenanceMutationResponse();
  if (maintenance) return maintenance;

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const parsedVersion = versionSchema.safeParse(form?.get("version"));
  if (!(file instanceof File)) return apiJson({ ok: false, errorCode: "FILE_REQUIRED", message: "กรุณาแนบไฟล์ MasterTTMT" }, 400);
  if (!parsedVersion.success) return apiJson({ ok: false, errorCode: "TTMT_VERSION_REQUIRED", message: "ต้องระบุเวอร์ชันของไฟล์ MasterTTMT" }, 400);
  if (!/\.xlsx?$/i.test(file.name)) return apiJson({ ok: false, errorCode: "FILE_TYPE_INVALID", message: "รองรับเฉพาะไฟล์ .xls หรือ .xlsx" }, 400);
  if (file.size > MAX_UPLOAD_BYTES) return apiJson({ ok: false, errorCode: "FILE_TOO_LARGE", message: "ไฟล์ใหญ่เกิน 25 MB" }, 413);

  try {
    const result = await importMasterTtmtV2({
      filename: file.name, version: parsedVersion.data, data: Buffer.from(await file.arrayBuffer()), importedBy: admin.user.id, dryRun: false,
    });
    return apiJson({ ok: true, ...result });
  } catch (error) {
    if (error instanceof TtmtImportError) {
      return apiJson({ ok: false, errorCode: error.code, message: error.message, details: error.details ?? [] }, 400);
    }
    return apiJson({ ok: false, errorCode: "TTMT_IMPORT_FAILED", message: "นำเข้าไฟล์ไม่สำเร็จ" }, 500);
  }
}
