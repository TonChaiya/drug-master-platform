import assert from "node:assert/strict";
import { drizzle } from "drizzle-orm/mysql2";
import { test } from "vitest";
import { createIntegrationTestPool, dbIntegrationTestsEnabled, integrationTestDbConfig } from "./helpers/db-integration";

const hasDatabase = dbIntegrationTestsEnabled();

test.runIf(hasDatabase)("mapping summary executes its batched lifecycle query on MySQL", async () => {
  const pool = createIntegrationTestPool(integrationTestDbConfig(), { connectionLimit: 1 });
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
