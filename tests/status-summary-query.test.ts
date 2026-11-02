import assert from "node:assert/strict";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { test } from "vitest";

const hasDatabase = Boolean(
  process.env.DB_HOST && process.env.DB_PORT && process.env.DB_USERNAME && process.env.DB_DATABASE,
);

test.runIf(hasDatabase)("mapping summary executes its batched lifecycle query on MySQL", async () => {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD ?? "",
    database: process.env.DB_DATABASE,
    connectionLimit: 1,
  });
  try {
    const database = drizzle({ client: pool });
    const { mappingLifecycleSummaries } = await import("@/modules/mappings/summary");
    const lifecycle = await mappingLifecycleSummaries(undefined, database);
    assert.ok(lifecycle instanceof Map);
    for (const summary of lifecycle.values()) {
      assert.equal(summary.sourceTotal, summary.mappedTotal + summary.pendingTotal + summary.needsReviewTotal);
      assert.ok(summary.exportReadyTotal <= summary.mappedTotal);
    }
  } finally {
    await pool.end();
  }
});
