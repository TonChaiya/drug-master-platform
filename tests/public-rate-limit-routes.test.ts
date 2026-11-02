import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  authenticate: vi.fn(),
  createSession: vi.fn(),
  setSessionCookie: vi.fn(),
  signup: vi.fn(),
  redeemEnrollment: vi.fn(),
}));

vi.mock("@/modules/security/rate-limit", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/modules/security/rate-limit")>();
  return { ...original, checkPublicRateLimit: mocks.check };
});
vi.mock("@/modules/auth/service", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/modules/auth/service")>();
  return { ...original, authenticate: mocks.authenticate, signup: mocks.signup };
});
vi.mock("@/modules/auth/session", () => ({ createSession: mocks.createSession, setSessionCookie: mocks.setSessionCookie }));
vi.mock("@/modules/agent/enrollment", () => ({ redeemEnrollment: mocks.redeemEnrollment }));

import { POST as login } from "@/app/api/v1/auth/login/route";
import { POST as signup } from "@/app/api/v1/auth/signup/route";
import { POST as enroll } from "@/app/api/v1/agent/enroll/route";

const blocked = { allowed: false as const, retryAfterSeconds: 60 };
const allowed = { allowed: true as const, retryAfterSeconds: 0 };

function jsonRequest(path: string, body: unknown) {
  return new Request(`https://example.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-vercel-forwarded-for": "203.0.113.10" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.check.mockResolvedValue(allowed);
});

test("blocked login returns 429 before parsing credentials or authenticating", async () => {
  mocks.check.mockResolvedValueOnce(blocked);
  const response = await login(new Request("https://example.test/api/v1/auth/login", { method: "POST", body: "not-json" }));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "60");
  assert.equal(mocks.authenticate.mock.calls.length, 0);
});

test("blocked signup writes no user, facility, or audit data", async () => {
  mocks.check.mockResolvedValueOnce(blocked);
  const response = await signup(jsonRequest("/api/v1/auth/signup", {}));
  assert.equal(response.status, 429);
  assert.equal(mocks.signup.mock.calls.length, 0);
});

test("blocked enrollment preserves the enrollment token", async () => {
  mocks.check.mockResolvedValueOnce(blocked);
  const response = await enroll(jsonRequest("/api/v1/agent/enroll", { enrollmentToken: "secret" }));
  assert.equal(response.status, 429);
  assert.equal(mocks.redeemEnrollment.mock.calls.length, 0);
});

test("allowed login still enters the existing authentication flow", async () => {
  mocks.authenticate.mockResolvedValueOnce({ id: "user-1", role: "user", mustChangePassword: 0 });
  mocks.createSession.mockResolvedValueOnce({ token: "session", expiresAt: new Date("2099-01-01T00:00:00Z") });
  const response = await login(jsonRequest("/api/v1/auth/login", { username: "tester", password: "valid-password" }));
  assert.equal(response.status, 200);
  assert.equal(mocks.authenticate.mock.calls.length, 1);
  assert.equal(mocks.createSession.mock.calls.length, 1);
});

test("allowed signup and enrollment keep their existing service flows", async () => {
  mocks.signup.mockResolvedValueOnce(undefined);
  const signupResponse = await signup(jsonRequest("/api/v1/auth/signup", {
    username: "tester",
    password: "valid-password",
    fullName: "Test User",
    positionName: "Pharmacist",
    facilityCode: "05957",
    facilityName: "Test Facility",
  }));
  assert.equal(signupResponse.status, 201);
  assert.equal(mocks.signup.mock.calls.length, 1);

  mocks.redeemEnrollment.mockResolvedValueOnce({
    keyId: "key-id",
    secret: "agent-secret",
    facilityCode: "05957",
    installationId: "11111111-1111-4111-8111-111111111111",
  });
  const enrollResponse = await enroll(jsonRequest("/api/v1/agent/enroll", {
    enrollmentToken: "t".repeat(43),
    installationId: "11111111-1111-4111-8111-111111111111",
    machineLabel: "JHCIS-PC",
    officeId: "05957",
    agentVersion: "1.3.0",
    macAddress: "00:11:22:33:44:55",
  }));
  assert.equal(enrollResponse.status, 200);
  assert.equal(mocks.redeemEnrollment.mock.calls.length, 1);
});
