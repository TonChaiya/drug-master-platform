import { apiJson } from "@/lib/api-response";
import { loginSchema } from "@/modules/auth/schemas";
import { AuthError, authenticate } from "@/modules/auth/service";
import { createSession, setSessionCookie } from "@/modules/auth/session";

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiJson({ ok: false, errorCode: "INVALID_JSON", message: "ข้อมูลไม่ถูกต้อง" }, 400);
  }
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) return apiJson({ ok: false, errorCode: "INVALID_CREDENTIALS", message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" }, 401);
  try {
    const user = await authenticate(parsed.data.username, parsed.data.password);
    const session = await createSession(user.id, request);
    await setSessionCookie(session.token, session.expiresAt);
    return apiJson({ ok: true, role: user.role, mustChangePassword: user.mustChangePassword === 1 });
  } catch (error) {
    if (error instanceof AuthError) return apiJson({ ok: false, errorCode: "INVALID_CREDENTIALS", message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง หรือบัญชียังไม่เปิดใช้งาน" }, 401);
    // A wrong password and an unreachable database looked identical to whoever
    // was staring at the login form. Keep the response vague, but leave the real
    // cause in the platform log so a deploy can actually be debugged.
    console.error("auth.login_failed", error);
    return apiJson(
      { ok: false, errorCode: "SERVICE_UNAVAILABLE", message: "เข้าสู่ระบบไม่สำเร็จชั่วคราว — ตรวจสถานะระบบที่ /api/v1/health" },
      503,
    );
  }
}
