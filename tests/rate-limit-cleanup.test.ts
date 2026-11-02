import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { cleanupExpiredRateLimitBuckets } from "@/modules/security/rate-limit-cleanup";

const now = new Date("2026-11-02T12:00:00.000Z");

test("cleanup stops after a partial batch and reports deleted rows", async () => {
  const deleteBatch = vi.fn()
    .mockResolvedValueOnce(1_000)
    .mockResolvedValueOnce(250);

  const result = await cleanupExpiredRateLimitBuckets({ now, deleteBatch });

  assert.deepEqual(result, { deleted: 1_250, batches: 2 });
  assert.equal(deleteBatch.mock.calls.length, 2);
  assert.equal(deleteBatch.mock.calls[0]?.[0].toISOString(), "2026-11-01T12:00:00.000Z");
  assert.equal(deleteBatch.mock.calls[0]?.[1], 1_000);
});

test("cleanup caps one invocation at ten batches and ten thousand rows", async () => {
  const deleteBatch = vi.fn().mockResolvedValue(1_000);

  const result = await cleanupExpiredRateLimitBuckets({ now, deleteBatch });

  assert.deepEqual(result, { deleted: 10_000, batches: 10 });
  assert.equal(deleteBatch.mock.calls.length, 10);
});

test("cleanup reports zero when no expired rows exist", async () => {
  const deleteBatch = vi.fn().mockResolvedValue(0);

  const result = await cleanupExpiredRateLimitBuckets({ now, deleteBatch });

  assert.deepEqual(result, { deleted: 0, batches: 0 });
  assert.equal(deleteBatch.mock.calls.length, 1);
});
