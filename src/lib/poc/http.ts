import { NextResponse } from "next/server";

export function noStoreJson(body: unknown, init?: ResponseInit): NextResponse {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

export function unauthorized(): NextResponse {
  return noStoreJson({ ok: false, errorCode: "UNAUTHORIZED", message: "ไม่ได้รับอนุญาต" }, { status: 401 });
}
