import { z } from "zod";
import { apiJson } from "@/lib/api-response";
import { requireAdmin } from "@/lib/authorization/require-context";
import { AdminActionError, updateFacility } from "@/modules/admin/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z
  .object({
    facilityId: z.uuid(),
    facilityName: z.string().trim().min(2).max(255),
    facilityCode: z.string().trim().regex(/^\d{5}$/),
  })
  .strict();

/**
 * Renames a facility or changes its 5-digit code. The code is what every
 * enrolled agent matches JHCIS `office.offid` against, so a change that breaks
 * that pairing is reported back in `agentWarning` rather than left to surface
 * later as a mismatch banner.
 */
export async function PATCH(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiJson(
      { ok: false, errorCode: "INVALID_INPUT", message: `ข้อมูลไม่ถูกต้องที่ ${parsed.error.issues[0]?.path.join(".") || "ฟอร์ม"}` },
      400,
    );
  }

  try {
    const result = await updateFacility({ actorUserId: admin.user.id, ...parsed.data });
    return apiJson({ ok: true, ...result });
  } catch (error) {
    if (error instanceof AdminActionError) return apiJson({ ok: false, errorCode: error.code, message: error.message }, 409);
    return apiJson({ ok: false, errorCode: "ADMIN_ACTION_FAILED", message: "บันทึกไม่สำเร็จ" }, 500);
  }
}
