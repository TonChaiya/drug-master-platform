import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/db/client";
import { auditLogs, facilities } from "@/db/schema";
import { apiJson, forbidden, unauthorized } from "@/lib/api-response";
import { EFFECTIVE_FACILITY_COOKIE } from "@/lib/authorization/effective-facility";
import { currentUser } from "@/modules/auth/session";

export const runtime = "nodejs";

const schema = z.object({ facilityId: z.uuid().nullable() }).strict();

/** Admin-only explicit facility context switch, recorded in the audit log. */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return unauthorized();
  if (user.role !== "admin") return forbidden();

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiJson({ ok: false, errorCode: "INVALID_INPUT", message: "ข้อมูลไม่ถูกต้อง" }, 400);

  const jar = await cookies();
  if (!parsed.data.facilityId) {
    jar.delete(EFFECTIVE_FACILITY_COOKIE);
    return apiJson({ ok: true, facilityId: null });
  }

  const rows = await db
    .select({ id: facilities.id, status: facilities.status })
    .from(facilities)
    .where(eq(facilities.id, parsed.data.facilityId))
    .limit(1);
  if (!rows[0] || rows[0].status !== "active") return apiJson({ ok: false, errorCode: "FACILITY_NOT_FOUND", message: "ไม่พบสถานบริการ" }, 404);

  jar.set(EFFECTIVE_FACILITY_COOKIE, rows[0].id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 8 * 60 * 60,
  });
  await db.insert(auditLogs).values({
    id: randomUUID(),
    actorUserId: user.id,
    effectiveFacilityId: rows[0].id,
    action: "admin.facility_context_selected",
    entityType: "facility",
    entityId: rows[0].id,
  });
  return apiJson({ ok: true, facilityId: rows[0].id });
}
