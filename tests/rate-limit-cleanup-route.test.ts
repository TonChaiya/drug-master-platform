import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";

const cleanupMock = vi.hoisted(() => vi.fn());

vi.mock("@/modules/security/rate-limit-cleanup", () => ({
  cleanupExpiredRateLimitBuckets: cleanupMock,
}));

import { GET } from "@/app/api/internal/maintenance/rate-limits/cleanup/route";

function request(authorization?: string) {
  return new Request("https://example.test/api/internal/maintenance/rate-limits/cleanup", {
    headers: authorization ? { authorization } : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

test("missing CRON_SECRET denies without touching cleanup storage", async () => {
  vi.stubEnv("CRON_SECRET", "");

  const response = await GET(request());

  assert.equal(response.status, 401);
  assert.equal(cleanupMock.mock.calls.length, 0);
  assert.equal((await response.text()).includes("secret"), false);
});

test("wrong bearer secret denies without touching cleanup storage", async () => {
  vi.stubEnv("CRON_SECRET", "correct-secret-value");

  const response = await GET(request("Bearer wrong-secret-value"));

  assert.equal(response.status, 401);
  assert.equal(cleanupMock.mock.calls.length, 0);
  const body = await response.text();
  assert.equal(body.includes("wrong-secret-value"), false);
  assert.equal(body.includes("hash"), false);
});

test("correct bearer secret runs cleanup and returns only summary counts", async () => {
  vi.stubEnv("CRON_SECRET", "correct-secret-value");
  cleanupMock.mockResolvedValueOnce({ deleted: 123, batches: 1 });
  const log = vi.spyOn(console, "info").mockImplementation(() => undefined);

  const response = await GET(request("Bearer correct-secret-value"));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, deleted: 123, batches: 1 });
  assert.equal(cleanupMock.mock.calls.length, 1);
  assert.deepEqual(log.mock.calls[0], ["security.rate_limit_cleanup", { deleted: 123, batches: 1 }]);
});

test("database failure returns 500 and logs no sensitive error detail", async () => {
  vi.stubEnv("CRON_SECRET", "correct-secret-value");
  cleanupMock.mockRejectedValueOnce(new Error("driver leaked-secret-value hash-value"));
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

  const response = await GET(request("Bearer correct-secret-value"));

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { ok: false, errorCode: "CLEANUP_FAILED" });
  const logged = JSON.stringify(log.mock.calls);
  assert.equal(logged.includes("security.rate_limit_cleanup_failed"), true);
  assert.equal(logged.includes("leaked-secret-value"), false);
  assert.equal(logged.includes("hash-value"), false);
});
