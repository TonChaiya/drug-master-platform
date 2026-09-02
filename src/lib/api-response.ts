import { NextResponse } from "next/server";

export function apiJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function unauthorized(): NextResponse {
  return apiJson({ ok: false, errorCode: "UNAUTHENTICATED", message: "กรุณาเข้าสู่ระบบ" }, 401);
}

export function forbidden(): NextResponse {
  return apiJson({ ok: false, errorCode: "FORBIDDEN", message: "ไม่มีสิทธิ์ดำเนินการ" }, 403);
}
