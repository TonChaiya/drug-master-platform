import { apiJson } from "@/lib/api-response";
import { AuthError, signup } from "@/modules/auth/service";
import { signupSchema } from "@/modules/auth/schemas";

const MAX_BODY_BYTES = 16 * 1024;

export async function POST(request: Request) {
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BODY_BYTES) return apiJson({ ok: false, errorCode: "PAYLOAD_TOO_LARGE" }, 413);
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    return apiJson({ ok: false, errorCode: "INVALID_JSON", message: "ข้อมูลไม่ถูกต้อง" }, 400);
  }
  const parsed = signupSchema.safeParse(raw);
  if (!parsed.success) return apiJson({ ok: false, errorCode: "INVALID_INPUT", message: "กรุณาตรวจข้อมูลสมัครสมาชิก" }, 422);
  try {
    await signup(parsed.data);
    return apiJson({ ok: true, message: "สมัครสมาชิกสำเร็จ กรุณาติดต่อผู้พัฒนาเพื่ออนุมัติไอดี" }, 201);
  } catch (error) {
    if (error instanceof AuthError && error.code === "USERNAME_TAKEN") return apiJson({ ok: false, errorCode: error.code, message: "ชื่อผู้ใช้นี้ไม่พร้อมใช้งาน" }, 409);
    if (error instanceof AuthError && error.code === "FACILITY_NAME_MISMATCH") {
      // Naming the registered facility turns a dead end into something the
      // person can fix: either they mistyped the name, or the code is wrong.
      return apiJson(
        {
          ok: false,
          errorCode: error.code,
          message: `รหัส ${parsed.data.facilityCode} ลงทะเบียนไว้ในชื่อ “${error.registeredFacilityName}” — หากเป็นสถานบริการเดียวกัน กรุณากรอกชื่อให้ตรง`,
          registeredFacilityName: error.registeredFacilityName,
        },
        409,
      );
    }
    return apiJson({ ok: false, errorCode: "SERVICE_UNAVAILABLE", message: "สมัครสมาชิกไม่สำเร็จชั่วคราว" }, 503);
  }
}
