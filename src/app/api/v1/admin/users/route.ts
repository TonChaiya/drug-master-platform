import { z } from "zod";
import { apiJson } from "@/lib/api-response";
import { requireAdmin } from "@/lib/authorization/require-context";
import { AdminActionError, setUserStatus } from "@/modules/admin/service";
import { listUsers } from "@/modules/admin/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ userId: z.uuid(), status: z.enum(["active", "pending", "disabled"]) }).strict();

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  return apiJson({ ok: true, users: await listUsers() });
}

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiJson({ ok: false, errorCode: "INVALID_INPUT", message: "ข้อมูลไม่ถูกต้อง" }, 400);

  try {
    await setUserStatus({ actorUserId: admin.user.id, targetUserId: parsed.data.userId, status: parsed.data.status });
    return apiJson({ ok: true });
  } catch (error) {
    if (error instanceof AdminActionError) return apiJson({ ok: false, errorCode: error.code, message: error.message }, 409);
    return apiJson({ ok: false, errorCode: "ADMIN_ACTION_FAILED", message: "ดำเนินการไม่สำเร็จ" }, 500);
  }
}
