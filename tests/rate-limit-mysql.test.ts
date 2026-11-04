import assert from "node:assert/strict";
import { afterAll, beforeAll, describe, test } from "vitest";
import { drizzle } from "drizzle-orm/mysql2";
import type { Pool } from "mysql2/promise";
import * as schema from "@/db/schema";
import { incrementRateLimitBucket, type RateLimitBucketInput } from "@/modules/security/rate-limit";
import { createIntegrationTestPool, dbIntegrationTestsEnabled, integrationTestDbConfig } from "./helpers/db-integration";

let pool: Pool;

describe.runIf(dbIntegrationTestsEnabled())("rate limiter on isolated local MySQL", () => {
beforeAll(async () => {
  pool = createIntegrationTestPool(integrationTestDbConfig(), { connectionLimit: 20 });
  await pool.execute("DELETE FROM rate_limit_buckets");
});

afterAll(async () => {
  if (pool) await pool.end();
});

test("concurrent increments are atomic on Laragon MySQL", async () => {
  const database = drizzle(pool, { schema, mode: "default" });
  const input: RateLimitBucketInput = {
    scope: "auth.login",
    clientKeyHash: "a".repeat(64),
    windowStart: new Date("2026-11-02T00:00:00.000Z"),
    expiresAt: new Date("2026-11-02T00:05:00.000Z"),
  };
  const counts = await Promise.all(Array.from({ length: 40 }, () => incrementRateLimitBucket(database, input)));

  assert.deepEqual([...counts].sort((a, b) => a - b), Array.from({ length: 40 }, (_, index) => index + 1));
});
});
