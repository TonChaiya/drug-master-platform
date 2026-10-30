import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, test } from "vitest";
import { and, count, eq, inArray } from "drizzle-orm";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const hasDatabase = Boolean(
  process.env.DB_HOST &&
    process.env.DB_PORT &&
    process.env.DB_USERNAME &&
    process.env.DB_PASSWORD &&
    process.env.DB_DATABASE,
);

const facilityA = randomUUID();
const facilityB = randomUUID();
const sourceA = randomUUID();
const sourceB = randomUUID();
const userA = randomUUID();
const standardCatalog = `T-${randomUUID()}`;
const standardManual = `T-${randomUUID()}`;
const mappingIds: string[] = [];
const importIds: string[] = [];

async function loadModules() {
  const [{ db }, schema, mappingService, mappingQueries, exportDelta] = await Promise.all([
    import("@/db/client"),
    import("@/db/schema"),
    import("@/modules/mappings/service"),
    import("@/modules/mappings/queries"),
    import("@/modules/exports/delta"),
  ]);
  return { db, schema, mappingService, mappingQueries, exportDelta };
}

let modules: Awaited<ReturnType<typeof loadModules>>;
let mappingIdA = "";
let mappingUpdatedAtBeforeConfirm = new Date(0);

async function addImport(facilityId: string, createdAt: Date, tmtid?: string) {
  const { db, schema } = modules;
  const importId = randomUUID();
  importIds.push(importId);
  await db.insert(schema.drugCatalogImports).values({
    id: importId,
    facilityId,
    filename: `${importId}.xlsx`,
    contentHash: importId.replaceAll("-", ""),
    rowCount: tmtid === undefined ? 0 : 1,
    importedBy: userA,
    createdAt,
  });
  if (tmtid !== undefined) {
    await db.insert(schema.drugCatalogRows).values({
      id: randomUUID(),
      importId,
      facilityId,
      sourceRowNumber: 2,
      hospdrugcode: facilityId === facilityA ? "REVIEW-A" : "REVIEW-B",
      tmtid,
    });
  }
  return importId;
}

async function statusFor(facilityId: string, drugcode: string) {
  const result = await modules.mappingQueries.mappingWorklist({
    facilityId,
    query: drugcode,
    status: "all",
    pageSize: 20,
  });
  return result.rows.find((row) => row.drugcode === drugcode)?.status;
}

describe.runIf(hasDatabase).sequential("mapping review acknowledgement", () => {
  beforeAll(async () => {
    modules = await loadModules();
    const { db, schema } = modules;
    await db.insert(schema.facilities).values([
      { id: facilityA, facilityCode: `A${facilityA.slice(0, 4)}`, facilityName: "Review test A", status: "active" },
      { id: facilityB, facilityCode: `B${facilityB.slice(0, 4)}`, facilityName: "Review test B", status: "active" },
    ]);
    await db.insert(schema.standardProducts).values([
      {
        id: randomUUID(),
        standardCode: standardCatalog,
        standardType: "TMT",
        status: "active",
        sourceVersion: "review-test",
      },
      {
        id: randomUUID(),
        standardCode: standardManual,
        standardType: "TMT",
        status: "active",
        sourceVersion: "review-test",
      },
    ]);
    await db.insert(schema.sourceDrugs).values([
      {
        id: sourceA,
        facilityId: facilityA,
        drugcode: "REVIEW-A",
        drugtype: "01",
        active: 1,
        lastSeenSyncId: randomUUID(),
      },
      {
        id: sourceB,
        facilityId: facilityB,
        drugcode: "REVIEW-B",
        drugtype: "01",
        active: 1,
        lastSeenSyncId: randomUUID(),
      },
    ]);
    await addImport(facilityA, new Date("2026-10-30T01:00:00.000Z"), standardCatalog);
    await addImport(facilityB, new Date("2026-10-30T01:00:00.000Z"), standardCatalog);
  });

  afterAll(async () => {
    if (!modules) return;
    const { db, schema } = modules;
    await db.delete(schema.auditLogs).where(inArray(schema.auditLogs.effectiveFacilityId, [facilityA, facilityB]));
    await db.delete(schema.drugMappings).where(inArray(schema.drugMappings.facilityId, [facilityA, facilityB]));
    await db.delete(schema.drugCatalogRows).where(inArray(schema.drugCatalogRows.facilityId, [facilityA, facilityB]));
    await db.delete(schema.drugCatalogImports).where(inArray(schema.drugCatalogImports.id, importIds));
    await db.delete(schema.sourceDrugs).where(inArray(schema.sourceDrugs.facilityId, [facilityA, facilityB]));
    await db.delete(schema.facilities).where(inArray(schema.facilities.id, [facilityA, facilityB]));
    await db
      .delete(schema.standardProducts)
      .where(inArray(schema.standardProducts.standardCode, [standardCatalog, standardManual]));
  });

  test("normal save leaves an unresolved catalog conflict in needs_review", async () => {
    const result = await modules.mappingService.saveManualMapping({
      facilityId: facilityA,
      userId: userA,
      sourceDrugId: sourceA,
      standardCode: standardManual,
    });
    mappingIdA = result.mappingId;
    mappingIds.push(mappingIdA);
    assert.equal(result.reviewConfirmed, false);
    assert.equal(await statusFor(facilityA, "REVIEW-A"), "needs_review");
  });

  test("save and confirm records the DB mapping version and resolves review", async () => {
    const { db, schema } = modules;
    const [before] = await db
      .select({ updatedAt: schema.drugMappings.updatedAt })
      .from(schema.drugMappings)
      .where(and(eq(schema.drugMappings.facilityId, facilityA), eq(schema.drugMappings.id, mappingIdA)));
    assert.ok(before);
    mappingUpdatedAtBeforeConfirm = before.updatedAt;

    const result = await modules.mappingService.saveManualMapping({
      facilityId: facilityA,
      userId: userA,
      sourceDrugId: sourceA,
      standardCode: standardManual,
      confirmReview: true,
    });
    assert.equal(result.reviewConfirmed, true);
    const [mapping] = await db
      .select({ updatedAt: schema.drugMappings.updatedAt })
      .from(schema.drugMappings)
      .where(eq(schema.drugMappings.id, mappingIdA));
    const [ack] = await db
      .select()
      .from(schema.mappingReviewAcknowledgements)
      .where(
        and(
          eq(schema.mappingReviewAcknowledgements.facilityId, facilityA),
          eq(schema.mappingReviewAcknowledgements.mappingId, mappingIdA),
        ),
      );
    assert.ok(mapping && ack);
    assert.equal(mapping.updatedAt.getTime(), mappingUpdatedAtBeforeConfirm.getTime(), "confirm-only must not update mapping");
    assert.equal(ack.mappingUpdatedAt.getTime(), mapping.updatedAt.getTime(), "acknowledgement must use the DB row version");
    assert.equal(await statusFor(facilityA, "REVIEW-A"), "mapped");
  });

  test("repeated same-state confirm is a no-op and does not duplicate audit", async () => {
    const { db, schema } = modules;
    const result = await modules.mappingService.saveManualMapping({
      facilityId: facilityA,
      userId: userA,
      sourceDrugId: sourceA,
      standardCode: standardManual,
      confirmReview: true,
    });
    assert.equal(result.reviewNoop, true);
    const [audits] = await db
      .select({ total: count() })
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.effectiveFacilityId, facilityA),
          eq(schema.auditLogs.entityId, mappingIdA),
          eq(schema.auditLogs.action, "mapping.review_confirmed"),
        ),
      );
    assert.equal(Number(audits?.total), 1);
  });

  test("a later mapping write makes the acknowledgement stale without changing another facility", async () => {
    const { db, schema } = modules;
    const mappingB = await modules.mappingService.saveManualMapping({
      facilityId: facilityB,
      userId: userA,
      sourceDrugId: sourceB,
      standardCode: standardManual,
    });
    await modules.mappingService.saveManualMapping({
      facilityId: facilityB,
      userId: userA,
      sourceDrugId: sourceB,
      standardCode: standardManual,
      notes: "saved and confirmed atomically",
      confirmReview: true,
    });
    const [mappingAfterSave] = await db
      .select({ updatedAt: schema.drugMappings.updatedAt })
      .from(schema.drugMappings)
      .where(eq(schema.drugMappings.id, mappingB.mappingId));
    const [ackAfterSave] = await db
      .select({ mappingUpdatedAt: schema.mappingReviewAcknowledgements.mappingUpdatedAt })
      .from(schema.mappingReviewAcknowledgements)
      .where(
        and(
          eq(schema.mappingReviewAcknowledgements.facilityId, facilityB),
          eq(schema.mappingReviewAcknowledgements.mappingId, mappingB.mappingId),
        ),
      );
    assert.ok(mappingAfterSave && ackAfterSave);
    assert.equal(ackAfterSave.mappingUpdatedAt.getTime(), mappingAfterSave.updatedAt.getTime());
    assert.equal(await statusFor(facilityB, "REVIEW-B"), "mapped");
    await new Promise((resolve) => setTimeout(resolve, 5));
    await modules.mappingService.saveManualMapping({
      facilityId: facilityA,
      userId: userA,
      sourceDrugId: sourceA,
      standardCode: standardManual,
      notes: "changed after review",
    });
    assert.equal(await statusFor(facilityA, "REVIEW-A"), "needs_review");
    assert.equal(await statusFor(facilityB, "REVIEW-B"), "mapped");
  });

  test("catalog TMT change makes a current acknowledgement stale", async () => {
    await modules.mappingService.saveManualMapping({
      facilityId: facilityA,
      userId: userA,
      sourceDrugId: sourceA,
      standardCode: standardManual,
      confirmReview: true,
    });
    await addImport(facilityA, new Date("2026-10-30T02:00:00.000Z"), `${standardCatalog}-changed`);
    assert.equal(await statusFor(facilityA, "REVIEW-A"), "needs_review");
  });

  test("catalog absence can be confirmed, and returning catalog state invalidates it", async () => {
    await addImport(facilityA, new Date("2026-10-30T03:00:00.000Z"));
    assert.equal(await statusFor(facilityA, "REVIEW-A"), "needs_review");
    await modules.mappingService.saveManualMapping({
      facilityId: facilityA,
      userId: userA,
      sourceDrugId: sourceA,
      standardCode: standardManual,
      confirmReview: true,
    });
    assert.equal(await statusFor(facilityA, "REVIEW-A"), "mapped");
    await addImport(facilityA, new Date("2026-10-30T04:00:00.000Z"), standardCatalog);
    assert.equal(await statusFor(facilityA, "REVIEW-A"), "needs_review");
  });

  test("confirm-only leaves export delta version unchanged", () => {
    const candidate = {
      facilityId: facilityA,
      mappingId: mappingIdA,
      mappingSource: "manual",
      mappingUpdatedAt: mappingUpdatedAtBeforeConfirm,
      checkpointExportId: "prior-export",
      status: "mapped" as const,
      standardValid: true,
    };
    const checkpoint = {
      facilityId: facilityA,
      mappingId: mappingIdA,
      mappingUpdatedAt: mappingUpdatedAtBeforeConfirm,
    };
    assert.equal(modules.exportDelta.isExportCandidate(candidate, checkpoint, "manual-changes"), false);
  });
});
