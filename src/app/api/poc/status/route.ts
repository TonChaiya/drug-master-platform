import { isDashboardAuthorized } from "@/lib/poc/dashboard-auth";
import { noStoreJson, unauthorized } from "@/lib/poc/http";
import { pocStateStore } from "@/lib/poc/state-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isDashboardAuthorized(request)) return unauthorized();
  try {
    return noStoreJson({ ok: true, ...(await pocStateStore.snapshot()) });
  } catch {
    return noStoreJson(
      { ok: false, errorCode: "PERSISTENCE_UNAVAILABLE", message: "ระบบจัดเก็บข้อมูลไม่พร้อมใช้งานชั่วคราว" },
      { status: 503 },
    );
  }
}
