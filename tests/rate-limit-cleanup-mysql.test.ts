import assert from "node:assert/strict";
import { afterAll, beforeAll, test } from "vitest";
import { asc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql, { type Pool } from "mysql2/promise";
import * as schema from "@/db/schema";
import { rateLimitBuckets } from "@/db/schema";
import {
  cleanupExpiredRateLimitBuckets,
  deleteExpiredRateLimitBucketBatch,
} from "@/modules/security/rate-limit-cleanup";

let pool: Pool;

beforeAll(async () => {
  assert.equal(process.env.RATE_LIMIT_TEST_DATABASE, "drug_master_rate_limit_test");
  pool = mysql.createPool({
    host: "127.0.0.1",
    port: 3306,
    user: "root",
    database: process.env.RATE_LIMIT_TEST_DATABASE,
    connectionLimit: 4,
    timezone: "Z",
  });
  await pool.execute("DELETE FROM rate_limit_buckets");
});

afterAll(async () => {
  if (pool) {
    await pool.execute("DELETE FROM rate_limit_buckets");
    await pool.end();
  }
});

test("local MySQL cleanup deletes only rows beyond the 24-hour grace across scopes", async () => {
  const database = drizzle(pool, { schema, mode: "default" });
  const beforeSchema = await pool.query("SHOW CREATE TABLE rate_limit_buckets");
  const now = new Date("2026-11-02T12:00:00.000Z");
  await database.insert(rateLimitBuckets).values([
    {
      scope: "auth.login",
      clientKeyHash: "a".repeat(64),
      windowStart: new Date("2026-11-01T11:00:00.000Z"),
      expiresAt: new Date("2026-11-01T11:59:59.999Z"),
      requestCount: 1,
    },
    {
      scope: "auth.signup",
      clientKeyHash: "b".repeat(64),
      windowStart: new Date("2026-11-01T09:00:00.000Z"),
      expiresAt: new Date("2026-11-01T10:00:00.000Z"),
      requestCount: 1,
    },
    {
      scope: "agent.enroll",
      clientKeyHash: "c".repeat(64),
      windowStart: new Date("2026-11-01T13:00:00.000Z"),
      expiresAt: new Date("2026-11-01T13:10:00.000Z"),
      requestCount: 1,
    },
    {
      scope: "auth.login",
      clientKeyHash: "d".repeat(64),
      windowStart: new Date("2026-11-02T13:00:00.000Z"),
      expiresAt: new Date("2026-11-02T13:05:00.000Z"),
      requestCount: 1,
    },
  ]);

  const result = await cleanupExpiredRateLimitBuckets({
    now,
    deleteBatch: (cutoff, batchSize) => deleteExpiredRateLimitBucketBatch(database, cutoff, batchSize),
  });
  const remaining = await database
    .select({ scope: rateLimitBuckets.scope, clientKeyHash: rateLimitBuckets.clientKeyHash })
    .from(rateLimitBuckets)
    .orderBy(asc(rateLimitBuckets.clientKeyHash));
  const afterSchema = await pool.query("SHOW CREATE TABLE rate_limit_buckets");

  assert.deepEqual(result, { deleted: 2, batches: 1 });
  assert.deepEqual(remaining, [
    { scope: "agent.enroll", clientKeyHash: "c".repeat(64) },
    { scope: "auth.login", clientKeyHash: "d".repeat(64) },
  ]);
  assert.deepEqual(afterSchema, beforeSchema);
});
