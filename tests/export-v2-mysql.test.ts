import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { readFile, readdir } from "node:fs/promises";
import { and, count, eq } from "drizzle-orm";
import mysql, { type Connection, type Pool } from "mysql2/promise";
import { afterAll, beforeAll, describe, test } from "vitest";

const expectedDatabase = "drug_master_export_v2_test";
const enabled = process.env.ALLOW_DB_INTEGRATION_TESTS === "1";
const host = process.env.EXPORT_V2_TEST_HOST;
const port = Number(process.env.EXPORT_V2_TEST_PORT);
const user = process.env.EXPORT_V2_TEST_USERNAME;
let server: Connection;
let pool: Pool;

describe.runIf(enabled)("catalog and export v2 on isolated Laragon MySQL", () => {
  beforeAll(async () => {
    assert.equal(process.env.NODE_ENV, "test");
    assert.equal(host, "127.0.0.1");
    assert.ok(port === 3306 || port === 3307, "Export v2 test requires the configured Laragon MySQL port");
    assert.equal(process.env.EXPORT_V2_TEST_DATABASE, expectedDatabase);
    assert.equal(user, "root");
    assert.notEqual(process.env.DB_DATABASE, "jhcisdb");
    server = await mysql.createConnection({ host, port, user, password: process.env.EXPORT_V2_TEST_PASSWORD ?? "", multipleStatements: true });
    const [[identity]] = await server.query<mysql.RowDataPacket[]>("SELECT @@hostname AS hostname, @@port AS port");
    assert.equal(Number(identity?.port), port);
    await server.query(`DROP DATABASE IF EXISTS \`${expectedDatabase}\``);
    await server.query(`CREATE DATABASE \`${expectedDatabase}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await server.query(`USE \`${expectedDatabase}\``);
    await server.query(`CREATE TABLE schema_migrations (filename VARCHAR(255) NOT NULL PRIMARY KEY, content_hash CHAR(64) NOT NULL, applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3))`);
    const directory = new URL("../src/db/migrations/", import.meta.url);
    const filenames = (await readdir(directory)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
    for (const filename of filenames) {
      const migration = await readFile(new URL(filename, directory), "utf8");
      await server.query(migration);
      await server.execute("INSERT INTO schema_migrations (filename, content_hash) VALUES (?, ?)", [filename, createHash("sha256").update(migration).digest("hex")]);
    }
    assert.equal(filenames.at(-1), "0016_mapping_v2_identity.sql");
    pool = mysql.createPool({ host, port, user, password: process.env.EXPORT_V2_TEST_PASSWORD ?? "", database: expectedDatabase, timezone: "Z", connectionLimit: 8 });
    const globals = globalThis as typeof globalThis & { appDbPool?: Pool; appDb?: unknown };
    globals.appDbPool = pool;
    globals.appDb = undefined;
    process.env.TMT_V2_CATALOG_ENABLED = "1";
    process.env.TMT_V2_EXPORT_ENABLED = "1";
  }, 60_000);

  afterAll(async () => {
    const globals = globalThis as typeof globalThis & { appDbPool?: Pool; appDb?: unknown };
    globals.appDb = undefined;
    globals.appDbPool = undefined;
    if (pool) await pool.end();
    if (server) {
      await server.query("USE mysql");
      await server.query(`DROP DATABASE IF EXISTS \`${expectedDatabase}\``);
      await server.end();
    }
    delete process.env.TMT_V2_CATALOG_ENABLED;
    delete process.env.TMT_V2_EXPORT_ENABLED;
  });

  test("catalog → mapping v2 → full/delta export preserves source identity, lifecycle, checkpoints and rollback", async () => {
    const [schema, { db }, { saveV2Mapping }, { reconcileFromLatestCatalogV2 }, exportsV2, exportService, { mappingLifecycleSummaries }, workbook, sheetTools, catalogHeaders] = await Promise.all([
      import("@/db/schema"), import("@/db/client"), import("@/modules/mappings/v2-service"),
      import("@/modules/mappings/reconcile-v2"), import("@/modules/exports/rows-v2"),
      import("@/modules/exports/service"), import("@/modules/mappings/summary"), import("@/lib/excel/workbook"),
      import("@/lib/excel/sheet"), import("@/modules/catalog/headers"),
    ]);
    const facilityA = randomUUID();
    const facilityB = randomUUID();
    const userId = randomUUID();
    const sourceTmt = randomUUID();
    const sourceTtmt = randomUUID();
    const sourceAuto = randomUUID();
    const sourceGpu = randomUUID();
    const sourceB = randomUUID();
    const syncId = randomUUID();
    const importId = randomUUID();
    await db.insert(schema.facilities).values([
      { id: facilityA, facilityCode: "A6001", facilityName: "Phase 6 A", status: "active" },
      { id: facilityB, facilityCode: "B6001", facilityName: "Phase 6 B", status: "active" },
    ]);
    await db.insert(schema.users).values({ id: userId, facilityId: facilityA, username: "phase6", usernameNormalized: "phase6", fullName: "Phase 6", positionName: "Tester", passwordHash: "not-used", role: "facility_admin", status: "active" });
    await db.insert(schema.sourceDrugs).values([
      { id: sourceTmt, facilityId: facilityA, drugcode: "00123", drugname: "ยาไทย", drugtype: "01", sell: "12.5000", active: 1, lastSeenSyncId: syncId },
      { id: sourceTtmt, facilityId: facilityA, drugcode: "TT-01", drugtype: "10", active: 1, lastSeenSyncId: syncId },
      { id: sourceAuto, facilityId: facilityA, drugcode: "AUTO-01", drugtype: "01", active: 1, lastSeenSyncId: syncId },
      { id: sourceGpu, facilityId: facilityA, drugcode: "GPU-ONLY", drugtype: "01", active: 1, lastSeenSyncId: syncId },
      { id: sourceB, facilityId: facilityB, drugcode: "B-01", drugtype: "01", active: 1, lastSeenSyncId: syncId },
    ]);
    await db.insert(schema.drugCatalogImports).values({ id: importId, facilityId: facilityA, filename: "phase6.xls", contentHash: "a".repeat(64), rowCount: 4, importedBy: userId });
    await db.insert(schema.drugCatalogRows).values([
      { id: randomUUID(), importId, facilityId: facilityA, sourceRowNumber: 2, hospdrugcode: "00123", productcat: "1", tmtid: "764169", ndc24: "000000000000000000000001" },
      { id: randomUUID(), importId, facilityId: facilityA, sourceRowNumber: 3, hospdrugcode: "TT-01", productcat: "3", tmtid: "565818" },
      { id: randomUUID(), importId, facilityId: facilityA, sourceRowNumber: 4, hospdrugcode: "AUTO-01", productcat: "1", tmtid: "565818" },
      { id: randomUUID(), importId, facilityId: facilityA, sourceRowNumber: 5, hospdrugcode: "GPU-ONLY", productcat: "1", tmtid: "764169" },
    ]);
    const at = new Date("2026-11-05T00:00:00Z");
    await db.insert(schema.tmtSyncRuns).values({
      id: randomUUID(), tmtVersion: "v1", mode: "full", status: "succeeded", startedAt: at, finishedAt: at,
    });
    await db.insert(schema.tmtConcept).values([
      { tmtid: 764169n, fsn: "GPU 764169", changeDate: "2026-11-01", levelName: "gpu", sourceVersion: "v1", lastSeenVersion: "v1", syncedAt: at },
      { tmtid: 565818n, fsn: "TPU 565818", changeDate: "2026-11-01", levelName: "tpu", sourceVersion: "v1", lastSeenVersion: "v1", syncedAt: at },
    ]);
    await db.insert(schema.tmtMastertmt).values({
      tpucode: 565818n, activeingredient: "ยาทดสอบ", strength: "5 mg", dosageform: "tablet", contvalue: "1",
      contunit: "tablet", dispunit: "box", tradename: "TMT TRADE", manufacturer: "ผู้ผลิตไทย", fsn: "TMT FSN",
      status: 0, sourceVersion: "v1", lastSeenVersion: "v1", syncedAt: at,
    });
    await db.insert(schema.tmtNlem).values({ tpuid: 565818n, fsn: "TMT FSN", nlem: "ED*", changeDate: "2026-11-01", sourceVersion: "v1", syncedAt: at });
    await db.insert(schema.tmtRegno).values([
      { tpuid: 565818n, fsn: "TMT FSN", regno: "REG-A", normalizedRegno: "rega", changeDate: "2026-11-01", sourceVersion: "v1", syncedAt: at },
      { tpuid: 565818n, fsn: "TMT FSN", regno: "REG-B", normalizedRegno: "regb", changeDate: "2026-11-01", sourceVersion: "v1", syncedAt: at },
    ]);
    await db.insert(schema.tmtAtc).values([
      { tpuid: 565818n, fsn: "TMT FSN", atc: "A01", changeDate: "2026-11-01", sourceVersion: "v1", syncedAt: at },
      { tpuid: 565818n, fsn: "TMT FSN", atc: "B02", changeDate: "2026-11-01", sourceVersion: "v1", syncedAt: at },
    ]);
    const ttmtImport = randomUUID();
    await db.insert(schema.ttmtImports).values({ id: ttmtImport, version: "ttmt-v1", filename: "ttmt.xlsx", contentHash: "b".repeat(64), rowCount: 1, status: "succeeded", importedBy: userId, startedAt: at, completedAt: at });
    await db.insert(schema.ttmtProducts).values({
      ttmtcode: "565818", activeingredient: "TTMT generic", strength: "20 mg", dosageform: "capsule",
      dispunit: "capsule", tradename: "TTMT TRADE", manufacturer: "TTMT maker", fsn: "TTMT FSN",
      status: "active", nlem: "NED", sourceVersion: "ttmt-v1", sourceImportId: ttmtImport,
    });

    const tmtMapping = await saveV2Mapping({ facilityId: facilityA, userId, sourceDrugId: sourceTmt, standardSource: "TMT", standardCode: "565818", standardLevel: "tpu", confirmReview: true });
    await saveV2Mapping({ facilityId: facilityA, userId, sourceDrugId: sourceTtmt, standardSource: "TTMT", standardCode: "565818", standardLevel: "product", confirmReview: true });
    await saveV2Mapping({ facilityId: facilityB, userId, sourceDrugId: sourceB, standardSource: "TMT", standardCode: "565818", standardLevel: "tpu" });
    const reconciled = await reconcileFromLatestCatalogV2(facilityA, userId);
    assert.equal(reconciled.created, 1, "direct TPU catalog row is auto-mapped");
    assert.equal(reconciled.skippedNoStandard, 1, "GPU-only row is not auto-mapped as a commercial product");
    const [manual] = await db.select({ code: schema.drugMappings.standardCode, source: schema.drugMappings.standardSource, level: schema.drugMappings.standardLevel })
      .from(schema.drugMappings).where(eq(schema.drugMappings.id, tmtMapping.mappingId));
    assert.deepEqual(manual, { code: "565818", source: "TMT", level: "tpu" }, "catalog GPU never overwrites the selected TPU");

    const full = await exportsV2.buildExportCandidatesV2(facilityA, "all-mapped");
    assert.equal(full.length, 3);
    const tmtRow = full.find((candidate) => candidate.row.hospdrugcode === "00123")?.row;
    const ttmtRow = full.find((candidate) => candidate.row.hospdrugcode === "TT-01")?.row;
    assert.equal(tmtRow?.tmtid, "565818");
    assert.equal(tmtRow?.ised, "E*");
    assert.equal(tmtRow?.genericname, "ยาทดสอบ");
    assert.equal(tmtRow?.ndc24, "000000000000000000000001");
    assert.equal(ttmtRow?.tmtid, "565818");
    assert.equal(ttmtRow?.genericname, "TTMT generic");
    assert.equal(ttmtRow?.tradename, "TTMT TRADE");
    assert.equal(ttmtRow?.ised, "N");

    const preview = await exportService.createExportPreview(facilityA, "all-mapped");
    const bundle = await exportService.createExport({ facilityId: facilityA, facilityCode: "A6001", userId, selection: "all-mapped", previewToken: preview.previewToken });
    assert.equal(bundle.rowCount, 3);
    const outputPath = process.env.EXPORT_V2_WORKBOOK_PATH ?? join(tmpdir(), "phase6-drugcat-v2.xls");
    await writeFile(outputPath, bundle.buffer);
    const sheet = workbook.readFirstSheet(await readFile(outputPath));
    const cell = (row: number, column: number) => sheetTools.cellText(sheet, row, column);
    assert.deepEqual(catalogHeaders.DRUGCAT_HEADERS.map((_, column) => cell(0, column)), [...catalogHeaders.DRUGCAT_HEADERS]);
    assert.equal(catalogHeaders.DRUGCAT_HEADERS.length, 22);
    assert.equal(cell(0, 22), "", "the locked header must end at column 22");
    assert.equal(sheet.rows.length, 4, "one header plus three export-ready mappings");
    assert.ok(sheet.rows.every((row) => row.length === 22), "every persisted row must have exactly 22 columns");
    assert.equal(cell(1, 1), "00123", "HOSPDRUGCODE leading zero survives the real file round trip");
    assert.equal(cell(1, 2), "1");
    assert.equal(cell(1, 3), "565818");
    assert.equal(cell(1, 4), "");
    assert.equal(cell(1, 5), "ยาทดสอบ");
    assert.equal(cell(1, 14), "E*");
    assert.equal(cell(1, 15), "000000000000000000000001", "NDC24 leading zeroes survive");
    assert.equal(cell(1, 16), "");
    assert.equal(cell(1, 17), "");
    assert.equal(cell(1, 18), "E");
    for (const column of [19, 20, 21]) assert.match(cell(1, column), /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(sheet.rows.flat().includes("ผู้ผลิตไทย"), "Thai text survives the persisted workbook");
    assert.ok(sheet.rows.slice(1).every((row) => row[3] !== "764169"), "GPU 764169 must never be an exported TMTID");
    assert.equal((await exportsV2.buildExportCandidatesV2(facilityA, "manual-changes")).length, 0);

    await new Promise((resolve) => setTimeout(resolve, 5));
    await saveV2Mapping({ facilityId: facilityA, userId, sourceDrugId: sourceTmt, standardSource: "TMT", standardCode: "565818", standardLevel: "tpu", notes: "export-significant edit", confirmReview: true });
    assert.equal((await exportsV2.buildExportCandidatesV2(facilityA, "manual-changes")).length, 1);
    const deltaPreview = await exportService.createExportPreview(facilityA, "manual-changes");
    await exportService.createExport({ facilityId: facilityA, facilityCode: "A6001", userId, selection: "manual-changes", previewToken: deltaPreview.previewToken });
    assert.equal((await exportsV2.buildExportCandidatesV2(facilityA, "manual-changes")).length, 0);
    await db.update(schema.tmtMastertmt).set({ syncedAt: new Date("2026-11-05T01:00:00Z") }).where(eq(schema.tmtMastertmt.tpucode, 565818n));
    assert.equal((await exportsV2.buildExportCandidatesV2(facilityA, "manual-changes")).length, 0, "standard sync metadata is not a mapping delta version");

    const stalePreview = await exportService.createExportPreview(facilityA, "all-mapped");
    const [checkpointBefore] = await db.select().from(schema.mappingExportCheckpoints).where(and(eq(schema.mappingExportCheckpoints.facilityId, facilityA), eq(schema.mappingExportCheckpoints.mappingId, tmtMapping.mappingId)));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await saveV2Mapping({ facilityId: facilityA, userId, sourceDrugId: sourceTmt, standardSource: "TMT", standardCode: "565818", standardLevel: "tpu", notes: "stale preview edit", confirmReview: true });
    await assert.rejects(
      () => exportService.createExport({ facilityId: facilityA, facilityCode: "A6001", userId, selection: "all-mapped", previewToken: stalePreview.previewToken }),
      { code: "EXPORT_PREVIEW_STALE" },
    );
    const [checkpointAfterFailure] = await db.select().from(schema.mappingExportCheckpoints).where(and(eq(schema.mappingExportCheckpoints.facilityId, facilityA), eq(schema.mappingExportCheckpoints.mappingId, tmtMapping.mappingId)));
    assert.equal(checkpointAfterFailure?.mappingUpdatedAt.getTime(), checkpointBefore?.mappingUpdatedAt.getTime(), "failed export rolls back checkpoint advancement");

    await db.update(schema.tmtMastertmt).set({ status: 1 }).where(eq(schema.tmtMastertmt.tpucode, 565818n));
    const invalidFull = await exportsV2.buildExportCandidatesV2(facilityA, "all-mapped");
    assert.deepEqual(invalidFull.map((candidate) => candidate.row.hospdrugcode), ["TT-01"], "inactive TPU is excluded while TTMT same-code remains active");
    const summary = (await mappingLifecycleSummaries(facilityA)).get(facilityA);
    assert.ok(summary);
    assert.ok(summary.needsReviewTotal >= 2);
    assert.equal(summary.exportReadyTotal, 1);
    await db.update(schema.tmtMastertmt).set({ status: 0 }).where(eq(schema.tmtMastertmt.tpucode, 565818n));

    const facilityAPreview = await exportService.createExportPreview(facilityA, "all-mapped");
    await assert.rejects(
      () => exportService.createExport({ facilityId: facilityB, facilityCode: "B6001", userId, selection: "all-mapped", previewToken: facilityAPreview.previewToken }),
      { code: "EXPORT_PREVIEW_STALE" },
    );
    const [facilityBCheckpoints] = await db.select({ total: count() }).from(schema.mappingExportCheckpoints).where(eq(schema.mappingExportCheckpoints.facilityId, facilityB));
    assert.equal(Number(facilityBCheckpoints?.total), 0);
    assert.equal((await exportsV2.buildExportCandidatesV2(facilityB, "all-mapped")).length, 1);

    const [plan] = await server.query<mysql.RowDataPacket[]>("EXPLAIN SELECT * FROM drug_mappings WHERE facility_id=? AND standard_source=?", [facilityA, "TMT"]);
    assert.ok(plan.some((row) => String(row.key ?? "").includes("idx_mappings_facility_standard_source")));
  }, 120_000);
});
