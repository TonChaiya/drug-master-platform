import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { count, eq, gt } from "drizzle-orm";
import { test } from "vitest";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const hasDatabase = Boolean(
  process.env.DB_HOST &&
    process.env.DB_PORT &&
    process.env.DB_USERNAME &&
    process.env.DB_PASSWORD &&
    process.env.DB_DATABASE,
);

test.runIf(hasDatabase)("mapping worklist queries every lifecycle status on TiDB", async () => {
  const [{ db }, { drugCatalogRows, sourceDrugs }, { mappingWorklist }] = await Promise.all([
    import("@/db/client"),
    import("@/db/schema"),
    import("@/modules/mappings/queries"),
  ]);
  const [source] = await db
    .select({ facilityId: sourceDrugs.facilityId })
    .from(sourceDrugs)
    .where(eq(sourceDrugs.active, 1))
    .limit(1);

  assert.ok(source, "database fixture needs one active source drug");
  for (const status of ["pending", "needs_review", "mapped", "all"] as const) {
    const result = await mappingWorklist({ facilityId: source.facilityId, status, page: 1, pageSize: 5 });
    assert.ok(Array.isArray(result.rows));
  }

  const [duplicateHistory] = await db
    .select({
      facilityId: drugCatalogRows.facilityId,
      drugcode: drugCatalogRows.hospdrugcode,
      snapshots: count(),
    })
    .from(drugCatalogRows)
    .groupBy(drugCatalogRows.facilityId, drugCatalogRows.hospdrugcode)
    .having(gt(count(), 1))
    .limit(1);
  assert.ok(duplicateHistory, "database fixture needs one drug present in multiple snapshots");

  const result = await mappingWorklist({
    facilityId: duplicateHistory.facilityId,
    query: duplicateHistory.drugcode,
    status: "all",
    page: 1,
    pageSize: 200,
  });
  assert.equal(result.rows.filter((row) => row.drugcode === duplicateHistory.drugcode).length, 1);
});
