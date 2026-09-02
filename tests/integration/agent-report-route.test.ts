import { beforeEach, describe, expect, it } from "vitest";
import { signRequest } from "@/lib/poc/hmac";
import { POST } from "@/app/api/poc/agent/report/route";

const KEY = "poc_test_key";
const SECRET = "poc_test_secret_which_is_not_real";

function payload(officeId = "05957") {
  return {
    installationId: "123e4567-e89b-42d3-a456-426614174000",
    machineName: "POC-TEST",
    agentVersion: "0.1.0",
    officeId,
    jhcisConnected: true,
    eligibleDrugCount: 12,
    checkedAt: new Date().toISOString(),
  };
}

function signedRequest(value: unknown, nonce: string): Request {
  const body = new TextEncoder().encode(JSON.stringify(value));
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signRequest(SECRET, {
    method: "POST",
    path: "/api/poc/agent/report",
    timestamp,
    nonce,
    body,
  });
  return new Request("http://localhost/api/poc/agent/report", {
    method: "POST",
    body,
    headers: {
      "Content-Type": "application/json",
      "X-Agent-Key": KEY,
      "X-Agent-Timestamp": timestamp,
      "X-Agent-Nonce": nonce,
      "X-Agent-Signature": signature,
      "X-Agent-Protocol": "1",
    },
  });
}

beforeEach(() => {
  process.env.POC_AGENT_KEY = KEY;
  process.env.POC_AGENT_SECRET = SECRET;
  process.env.POC_ALLOWED_OFFICE_ID = "05957";
});

describe("POST /api/poc/agent/report", () => {
  it("rejects missing HMAC", async () => {
    const response = await POST(new Request("http://localhost/api/poc/agent/report", { method: "POST", body: "{}" }));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ errorCode: "AGENT_AUTH_MISSING" });
  });

  it("accepts a valid signed report and rejects replay", async () => {
    const nonce = "10000000000000000000000000000001";
    const first = await POST(signedRequest(payload(), nonce));
    expect(first.status).toBe(202);
    await expect(first.json()).resolves.toMatchObject({ ok: true, persistence: "memory-ephemeral" });
    const replay = await POST(signedRequest(payload(), nonce));
    expect(replay.status).toBe(409);
  });

  it("rejects malformed and mismatched office IDs", async () => {
    const malformed = await POST(signedRequest(payload("00001"), "20000000000000000000000000000001"));
    expect(malformed.status).toBe(422);
    const mismatched = await POST(signedRequest(payload("12345"), "20000000000000000000000000000002"));
    expect(mismatched.status).toBe(403);
  });

  it("rejects payloads over 64 KiB before parsing", async () => {
    const response = await POST(new Request("http://localhost/api/poc/agent/report", { method: "POST", body: "x".repeat(65 * 1024) }));
    expect(response.status).toBe(413);
  });
});
