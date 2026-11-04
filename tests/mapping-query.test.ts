import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, test } from "vitest";
import { count, eq, gt, inArray } from "drizzle-orm";
import type { Pool } from "mysql2/promise";
import {
  clearIntegrationTestPool,
  createIntegrationTestPool,
  dbIntegrationTestsEnabled,
  installIntegrationTestPool,
  integrationTestDbConfig,
} from "./helpers/db-integration";

const enabled = dbIntegrationTestsEnabled();
const facilityId = randomUUID();
const sourceId = randomUUID();
const importIds = [randomUUID(), randomUUID()];
const drugcode = "QUERY-DUPLICATE-HISTORY";
let pool: Pool;
let modules: Awaited<ReturnType<typeof loadModules>>;

async function loadModules() {
  const [{ db }, schema, mappingQueries] = await Promise.all([
    import("@/db/client"),
    import("@/db/schema"),
    import("@/modules/mappings/queries"),
  ]);
  return { db, schema, mappingQueries };
}

describe.runIf(enabled).sequential("mapping worklist on isolated local MySQL", () => {
  beforeAll(async () => {
    pool = createIntegrationTestPool(integrationTestDbConfig());
    installIntegrationTestPool(pool);
    modules = await loadModules();
    const { db, schema } = modules;
    await db.insert(schema.facilities).values({ id: facilityId, facilityCode: `Q${facilityId.slice(0, 4)}`, facilityName: "Mapping query test" });
    await db.insert(schema.sourceDrugs).values({
      id: sourceId,
      facilityId,
      drugcode,
      drugtype: "01",
      active: 1,
      lastSeenSyncId: randomUUID(),
    });
    await db.insert(schema.drugCatalogImports).values(importIds.map((id, index) => ({
      id,
      facilityId,
      filename: `${id}.xlsx`,
      contentHash: id.replaceAll("-", ""),
      rowCount: 1,
      importedBy: randomUUID(),
      createdAt: new Date(`2026-11-0${index + 1}T00:00:00.000Z`),
    })));
    await db.insert(schema.drugCatalogRows).values(importIds.map((importId, index) => ({
      id: randomUUID(),
      importId,
      facilityId,
      sourceRowNumber: 2,
      hospdrugcode: drugcode,
      tmtid: `TMT-${index + 1}`,
    })));
  });

  afterAll(async () => {
    if (!modules) return;
    const { db, schema } = modules;
    await db.delete(schema.drugCatalogRows).where(eq(schema.drugCatalogRows.facilityId, facilityId));
    await db.delete(schema.drugCatalogImports).where(inArray(schema.drugCatalogImports.id, importIds));
    await db.delete(schema.sourceDrugs).where(eq(schema.sourceDrugs.facilityId, facilityId));
    await db.delete(schema.facilities).where(eq(schema.facilities.id, facilityId));
    clearIntegrationTestPool();
    await pool.end();
  });

  test("queries every lifecycle status and deduplicates historical snapshots", async () => {
    const { db, schema, mappingQueries } = modules;
    for (const status of ["pending", "needs_review", "mapped", "all"] as const) {
      const result = await mappingQueries.mappingWorklist({ facilityId, status, page: 1, pageSize: 5 });
      assert.ok(Array.isArray(result.rows));
    }

    const [duplicateHistory] = await db
      .select({ facilityId: schema.drugCatalogRows.facilityId, drugcode: schema.drugCatalogRows.hospdrugcode, snapshots: count() })
      .from(schema.drugCatalogRows)
      .where(eq(schema.drugCatalogRows.facilityId, facilityId))
      .groupBy(schema.drugCatalogRows.facilityId, schema.drugCatalogRows.hospdrugcode)
      .having(gt(count(), 1))
      .limit(1);
    assert.ok(duplicateHistory);

    const result = await mappingQueries.mappingWorklist({
      facilityId,
      query: duplicateHistory.drugcode,
      status: "all",
      page: 1,
      pageSize: 200,
    });
    assert.equal(result.rows.filter((row) => row.drugcode === duplicateHistory.drugcode).length, 1);
  });
});
