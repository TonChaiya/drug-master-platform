import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalString, sha256Hex, signRequest } from "@/lib/poc/hmac";

interface Vector {
  secret: string;
  method: "POST";
  path: string;
  timestamp: string;
  nonce: string;
  body: string;
  bodySha256: string;
  signature: string;
}

const vector = JSON.parse(readFileSync(new URL("../fixtures/hmac-vector.json", import.meta.url), "utf8")) as Vector;
const body = new TextEncoder().encode(vector.body);

describe("Agent HMAC fixed vector", () => {
  it("hashes the exact UTF-8 body bytes", () => {
    expect(sha256Hex(body)).toBe(vector.bodySha256);
  });

  it("builds the protocol canonical form and signature", () => {
    const input = { method: vector.method, path: vector.path, timestamp: vector.timestamp, nonce: vector.nonce, body };
    expect(canonicalString(input).split("\n")).toHaveLength(6);
    expect(signRequest(vector.secret, input)).toBe(vector.signature);
  });
});
