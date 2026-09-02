import { randomUUID } from "node:crypto";
import { isDashboardAuthorized } from "@/lib/poc/dashboard-auth";
import { noStoreJson, unauthorized } from "@/lib/poc/http";
import { pocStateStore } from "@/lib/poc/state-store";
import { fetchTmtVersion } from "@/lib/poc/tmt-client";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isDashboardAuthorized(request)) return unauthorized();
  const result = await fetchTmtVersion();
  await pocStateStore.recordEvent({
    id: randomUUID(),
    kind: "tmt_test",
    ok: result.ok,
    message: result.message,
    occurredAt: new Date().toISOString(),
    ...(result.httpStatus === null ? {} : { httpStatus: result.httpStatus }),
    latencyMs: result.latencyMs,
  });
  return noStoreJson(result, { status: result.ok ? 200 : 502 });
}
