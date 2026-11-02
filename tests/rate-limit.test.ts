import assert from "node:assert/strict";
import { test, vi } from "vitest";
import {
  checkPublicRateLimit,
  ENROLL_RATE_LIMIT,
  LOGIN_RATE_LIMIT,
  SIGNUP_RATE_LIMIT,
  rateLimitExceededResponse,
  type RateLimitBucketInput,
} from "@/modules/security/rate-limit";

const secret = "s".repeat(32);

test("public endpoint policies match the approved limits", () => {
  assert.deepEqual(LOGIN_RATE_LIMIT, { scope: "auth.login", limit: 15, windowMs: 5 * 60 * 1000 });
  assert.deepEqual(SIGNUP_RATE_LIMIT, { scope: "auth.signup", limit: 5, windowMs: 30 * 60 * 1000 });
  assert.deepEqual(ENROLL_RATE_LIMIT, { scope: "agent.enroll", limit: 10, windowMs: 10 * 60 * 1000 });
});

function request(ip: string) {
  return new Request("https://example.test/api", { headers: { "x-vercel-forwarded-for": ip } });
}

test("threshold, Retry-After, and fixed-window reset", async () => {
  const counts = new Map<string, number>();
  const increment = async (input: RateLimitBucketInput) => {
    const key = `${input.scope}:${input.clientKeyHash}:${input.windowStart.toISOString()}`;
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    return count;
  };
  const firstWindow = new Date("2026-11-02T00:04:59.000Z");

  for (const [index, policy] of [LOGIN_RATE_LIMIT, SIGNUP_RATE_LIMIT, ENROLL_RATE_LIMIT].entries()) {
    const client = `203.0.113.${10 + index}`;
    for (let count = 1; count <= policy.limit; count += 1) {
      const decision = await checkPublicRateLimit(request(client), policy, { secret, now: firstWindow, increment });
      assert.equal(decision.allowed, true);
    }
    const decision = await checkPublicRateLimit(request(client), policy, { secret, now: firstWindow, increment });
    assert.equal(decision.allowed, false);
  }
  const blocked = await checkPublicRateLimit(request("203.0.113.10"), LOGIN_RATE_LIMIT, { secret, now: firstWindow, increment });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 1);
  const response = rateLimitExceededResponse(blocked);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "1");

  const reset = await checkPublicRateLimit(request("203.0.113.10"), LOGIN_RATE_LIMIT, {
    secret,
    now: new Date("2026-11-02T00:05:00.000Z"),
    increment,
  });
  assert.equal(reset.allowed, true);
});

test("scope and client keys are isolated and raw IP is never passed to storage", async () => {
  const inputs: RateLimitBucketInput[] = [];
  const increment = async (input: RateLimitBucketInput) => (inputs.push(input), 1);
  const now = new Date("2026-11-02T00:00:00.000Z");

  await checkPublicRateLimit(request("203.0.113.10"), LOGIN_RATE_LIMIT, { secret, now, increment });
  await checkPublicRateLimit(request("203.0.113.10"), SIGNUP_RATE_LIMIT, { secret, now, increment });
  await checkPublicRateLimit(request("203.0.113.11"), LOGIN_RATE_LIMIT, { secret, now, increment });

  assert.notEqual(inputs[0]?.scope, inputs[1]?.scope);
  assert.equal(inputs[0]?.clientKeyHash, inputs[1]?.clientKeyHash);
  assert.notEqual(inputs[0]?.clientKeyHash, inputs[2]?.clientKeyHash);
  assert.equal(inputs.every((input) => JSON.stringify(input).includes("203.0.113") === false), true);
  assert.match(inputs[0]?.clientKeyHash ?? "", /^[a-f0-9]{64}$/);
});

test("limiter storage failure fails open with the required security event", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const decision = await checkPublicRateLimit(request("203.0.113.10"), LOGIN_RATE_LIMIT, {
    secret,
    now: new Date("2026-11-02T00:00:00.000Z"),
    increment: async () => {
      throw new Error("database unavailable");
    },
  });

  assert.equal(decision.allowed, true);
  assert.equal(log.mock.calls[0]?.[0], "security.rate_limit_unavailable");
  assert.equal(JSON.stringify(log.mock.calls).includes("203.0.113.10"), false);
  log.mockRestore();
});
