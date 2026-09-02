import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const AGENT_REPORT_PATH = "/api/poc/agent/report";
export const AGENT_PROTOCOL = "v1";

export interface SignatureInput {
  method: "POST";
  path: string;
  timestamp: string;
  nonce: string;
  body: Uint8Array;
}

export function sha256Hex(body: Uint8Array): string {
  return createHash("sha256").update(body).digest("hex");
}

export function canonicalString(input: SignatureInput): string {
  return [
    AGENT_PROTOCOL,
    input.method,
    input.path,
    input.timestamp,
    input.nonce,
    sha256Hex(input.body),
  ].join("\n");
}

export function signRequest(secret: string, input: SignatureInput): string {
  return createHmac("sha256", secret).update(canonicalString(input), "utf8").digest("hex");
}

export function constantTimeTextEqual(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  if (actualBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(actualBytes, expectedBytes);
}
