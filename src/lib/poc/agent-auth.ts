import { AGENT_PROTOCOL, AGENT_REPORT_PATH, constantTimeTextEqual, signRequest } from "@/lib/poc/hmac";
import type { ReplayStore } from "@/lib/poc/replay-store";

const MAX_CLOCK_SKEW_SECONDS = 300;
const NONCE_PATTERN = /^[a-f0-9]{32,64}$/;

export type AgentAuthResult =
  | { ok: true }
  | { ok: false; status: number; errorCode: string; message: string };

export async function verifyAgentRequest(
  request: Request,
  body: Uint8Array,
  store: ReplayStore,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<AgentAuthResult> {
  const configuredKey = process.env.POC_AGENT_KEY?.trim() ?? "";
  const secret = process.env.POC_AGENT_SECRET ?? "";
  if (!configuredKey || !secret) {
    return { ok: false, status: 503, errorCode: "AGENT_AUTH_NOT_CONFIGURED", message: "server ยังไม่ได้ตั้งค่า Agent credential" };
  }

  const key = request.headers.get("x-agent-key") ?? "";
  const timestamp = request.headers.get("x-agent-timestamp") ?? "";
  const nonce = request.headers.get("x-agent-nonce") ?? "";
  const signature = request.headers.get("x-agent-signature") ?? "";
  const protocol = request.headers.get("x-agent-protocol") ?? "";
  if (!key || !timestamp || !nonce || !signature || protocol !== "1") {
    return { ok: false, status: 401, errorCode: "AGENT_AUTH_MISSING", message: "ข้อมูลยืนยัน Agent ไม่ครบ" };
  }
  if (!constantTimeTextEqual(key, configuredKey)) {
    return { ok: false, status: 401, errorCode: "AGENT_KEY_INVALID", message: "Agent key ไม่ถูกต้อง" };
  }
  if (!/^\d{10}$/.test(timestamp) || Math.abs(nowSeconds - Number(timestamp)) > MAX_CLOCK_SKEW_SECONDS) {
    return { ok: false, status: 401, errorCode: "AGENT_TIMESTAMP_INVALID", message: "เวลา Agent อยู่นอกช่วงที่อนุญาต" };
  }
  if (!NONCE_PATTERN.test(nonce)) {
    return { ok: false, status: 401, errorCode: "AGENT_NONCE_INVALID", message: "nonce ไม่ถูกต้อง" };
  }
  if (!/^[a-f0-9]{64}$/.test(signature)) {
    return { ok: false, status: 401, errorCode: "AGENT_SIGNATURE_INVALID", message: "signature ไม่ถูกต้อง" };
  }
  const expected = signRequest(secret, {
    method: "POST",
    path: AGENT_REPORT_PATH,
    timestamp,
    nonce,
    body,
  });
  if (!constantTimeTextEqual(signature, expected)) {
    return { ok: false, status: 401, errorCode: "AGENT_SIGNATURE_INVALID", message: "signature ไม่ถูกต้อง" };
  }
  const claimed = await store.claim(`${configuredKey}:${nonce}`, (Number(timestamp) + MAX_CLOCK_SKEW_SECONDS) * 1000);
  if (!claimed) {
    return { ok: false, status: 409, errorCode: "AGENT_NONCE_REPLAYED", message: "nonce นี้ถูกใช้แล้ว" };
  }
  return { ok: true };
}

export { AGENT_PROTOCOL };
