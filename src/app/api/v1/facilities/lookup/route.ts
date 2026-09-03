import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { facilities } from "@/db/schema";
import { apiJson } from "@/lib/api-response";
import { isValidOfficeId } from "@/lib/validation/facility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Looks up the name a facility code is already registered under, so the signup
 * form can fill it in rather than asking someone to reproduce it exactly.
 *
 * Unauthenticated because signup is: it returns nothing but a facility's own
 * name against its published 5-digit code, and never says anything about the
 * accounts attached to it.
 */
export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code")?.trim() ?? "";
  if (!isValidOfficeId(code)) {
    return apiJson({ ok: false, errorCode: "INVALID_CODE", message: "รหัสสถานบริการต้องเป็นเลข 5 หลัก" }, 400);
  }

  const rows = await db
    .select({ facilityName: facilities.facilityName, status: facilities.status })
    .from(facilities)
    .where(eq(facilities.facilityCode, code))
    .limit(1);

  const facility = rows[0];
  if (!facility) return apiJson({ ok: true, registered: false });
  return apiJson({ ok: true, registered: true, facilityName: facility.facilityName, active: facility.status === "active" });
}
