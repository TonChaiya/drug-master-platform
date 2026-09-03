import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { facilities } from "@/db/schema";
import { apiJson } from "@/lib/api-response";
import { requireAdmin } from "@/lib/authorization/require-context";
import { AdminActionError, clearFacilityData } from "@/modules/admin/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Destructive and admin-only. The facility is named explicitly and re-confirmed
 * by its 5-digit code, so a mis-click cannot wipe the wrong one
 * (docs/OPERATIONS.md).
 */
const schema = z
  .object({
    facilityId: z.uuid(),
    confirmFacilityCode: z.string().trim().regex(/^\d{5}$/),
    scope: z.enum(["mappings", "catalog", "source", "agents", "all"]),
  })
  .strict();

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiJson({ ok: false, errorCode: "INVALID_INPUT", message: "ข้อมูลไม่ถูกต้อง" }, 400);

  const rows = await db
    .select({ id: facilities.id, code: facilities.facilityCode })
    .from(facilities)
    .where(eq(facilities.id, parsed.data.facilityId))
    .limit(1);
  const facility = rows[0];
  if (!facility) return apiJson({ ok: false, errorCode: "FACILITY_NOT_FOUND", message: "ไม่พบสถานบริการ" }, 404);
  if (facility.code !== parsed.data.confirmFacilityCode) {
    return apiJson({ ok: false, errorCode: "CONFIRMATION_MISMATCH", message: "รหัสสถานบริการที่ยืนยันไม่ตรงกัน" }, 409);
  }

  try {
    const deleted = await clearFacilityData({
      actorUserId: admin.user.id,
      facilityId: facility.id,
      scope: parsed.data.scope,
    });
    return apiJson({ ok: true, deleted });
  } catch (error) {
    if (error instanceof AdminActionError) return apiJson({ ok: false, errorCode: error.code, message: error.message }, 409);
    return apiJson({ ok: false, errorCode: "ADMIN_ACTION_FAILED", message: "ล้างข้อมูลไม่สำเร็จ" }, 500);
  }
}
