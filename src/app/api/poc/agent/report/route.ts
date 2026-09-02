import { randomUUID } from "node:crypto";
import { verifyAgentRequest } from "@/lib/poc/agent-auth";
import { noStoreJson } from "@/lib/poc/http";
import { replayStore } from "@/lib/poc/replay-store";
import { agentReportSchema } from "@/lib/poc/schemas";
import { pocStateStore } from "@/lib/poc/state-store";

export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 64 * 1024;

export async function POST(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return noStoreJson({ ok: false, errorCode: "PAYLOAD_TOO_LARGE", message: "payload ต้องไม่เกิน 64 KiB" }, { status: 413 });
  }

  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength > MAX_BODY_BYTES) {
    return noStoreJson({ ok: false, errorCode: "PAYLOAD_TOO_LARGE", message: "payload ต้องไม่เกิน 64 KiB" }, { status: 413 });
  }
  let auth: Awaited<ReturnType<typeof verifyAgentRequest>>;
  try {
    auth = await verifyAgentRequest(request, body, replayStore);
  } catch {
    return noStoreJson(
      { ok: false, errorCode: "PERSISTENCE_UNAVAILABLE", message: "ระบบจัดเก็บข้อมูลไม่พร้อมใช้งานชั่วคราว" },
      { status: 503 },
    );
  }
  if (!auth.ok) return noStoreJson({ ok: false, errorCode: auth.errorCode, message: auth.message }, { status: auth.status });

  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    return noStoreJson({ ok: false, errorCode: "INVALID_JSON", message: "รูปแบบ JSON ไม่ถูกต้อง" }, { status: 400 });
  }
  const parsed = agentReportSchema.safeParse(raw);
  if (!parsed.success) {
    return noStoreJson({ ok: false, errorCode: "INVALID_PAYLOAD", message: "ข้อมูลรายงานไม่ถูกต้อง" }, { status: 422 });
  }
  const allowedOfficeId = process.env.POC_ALLOWED_OFFICE_ID?.trim();
  if (allowedOfficeId && parsed.data.officeId !== allowedOfficeId) {
    return noStoreJson({ ok: false, errorCode: "OFFICE_ID_MISMATCH", message: "รหัสสถานบริการไม่ตรงกับขอบเขต PoC" }, { status: 403 });
  }

  const requestId = randomUUID();
  const receivedAt = new Date().toISOString();
  try {
    await pocStateStore.recordAgent({ ...parsed.data, requestId, receivedAt });
  } catch {
    return noStoreJson(
      { ok: false, errorCode: "PERSISTENCE_UNAVAILABLE", message: "ระบบจัดเก็บข้อมูลไม่พร้อมใช้งานชั่วคราว" },
      { status: 503 },
    );
  }
  const persistence = process.env.NODE_ENV !== "test" && process.env.POC_STATE_STORE === "tidb" ? "tidb" : "memory-ephemeral";
  return noStoreJson({ ok: true, requestId, receivedAt, persistence }, { status: 202 });
}
