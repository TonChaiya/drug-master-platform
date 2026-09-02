import { createHash, createHmac } from "node:crypto";

export const AGENT_PROTOCOL_VERSION = "1";
const CANONICAL_PREFIX = "v1";

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

/**
 * Canonical string defined in docs/OPERATIONS.md:
 *   v1\n<METHOD>\n<PATH>\n<unix timestamp>\n<nonce>\n<sha256(body bytes)>
 */
export function canonicalString(input: SignatureInput): string {
  return [CANONICAL_PREFIX, input.method, input.path, input.timestamp, input.nonce, sha256Hex(input.body)].join("\n");
}

export function signRequest(secret: string, input: SignatureInput): string {
  return createHmac("sha256", secret).update(canonicalString(input), "utf8").digest("hex");
}

export function nonceHash(credentialId: string, nonce: string): string {
  return createHash("sha256").update(`${credentialId}:${nonce}`).digest("hex");
}
