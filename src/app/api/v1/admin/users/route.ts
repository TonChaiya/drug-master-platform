import { z } from "zod";
import { apiJson } from "@/lib/api-response";
import { requireAdmin } from "@/lib/authorization/require-context";
import { AdminActionError, deleteUser, setUserStatus, updateUserCredentials } from "@/modules/admin/service";
import { listUsers } from "@/modules/admin/queries";
import { newPasswordSchema, usernameSchema } from "@/modules/auth/schemas";
import { currentSessionTokenHash } from "@/modules/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ userId: z.uuid(), status: z.enum(["active", "pending", "disabled"]) }).strict();

/** Both fields optional, but sending neither is a no-op worth rejecting. */
const credentialsSchema = z
  .object({ userId: z.uuid(), username: usernameSchema.optional(), password: newPasswordSchema.optional() })
  .strict()
  .refine((value) => value.username !== undefined || value.password !== undefined, {
    message: "ต้องระบุไอดีหรือรหัสผ่านอย่างน้อยหนึ่งอย่าง",
  });

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

/** Sets a username and/or password on any account, the admin's own included. */
export async function PATCH(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const parsed = credentialsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiJson(
      { ok: false, errorCode: "INVALID_INPUT", message: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" },
      400,
    );
  }

  try {
    const result = await updateUserCredentials({
      actorUserId: admin.user.id,
      targetUserId: parsed.data.userId,
      username: parsed.data.username,
      password: parsed.data.password,
      keepSessionTokenHash: await currentSessionTokenHash(),
    });
    return apiJson({ ok: true, ...result });
  } catch (error) {
    if (error instanceof AdminActionError) return apiJson({ ok: false, errorCode: error.code, message: error.message }, 409);
    return apiJson({ ok: false, errorCode: "ADMIN_ACTION_FAILED", message: "แก้ไขบัญชีไม่สำเร็จ" }, 500);
  }
}

/** Permanent. Guarded against deleting yourself or the last active admin. */
export async function DELETE(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const parsed = z.object({ userId: z.uuid() }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiJson({ ok: false, errorCode: "INVALID_INPUT", message: "ข้อมูลไม่ถูกต้อง" }, 400);

  try {
    await deleteUser({ actorUserId: admin.user.id, targetUserId: parsed.data.userId });
    return apiJson({ ok: true });
  } catch (error) {
    if (error instanceof AdminActionError) return apiJson({ ok: false, errorCode: error.code, message: error.message }, 409);
    return apiJson({ ok: false, errorCode: "ADMIN_ACTION_FAILED", message: "ลบบัญชีไม่สำเร็จ" }, 500);
  }
}
