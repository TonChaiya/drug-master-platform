import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { count, eq } from "drizzle-orm";
import mysql, { type Connection, type Pool } from "mysql2/promise";
import { afterAll, beforeAll, describe, test } from "vitest";

const database = "drug_master_mapping_v2_test";
const enabled = process.env.ALLOW_DB_INTEGRATION_TESTS === "1";
let server: Connection;
let pool: Pool;
let createdHere = false;
const previousFlags = {
  active: process.env.ACTIVE_STANDARD_RELEASE_ENABLED,
  export: process.env.TMT_V2_EXPORT_ENABLED,
};

function restoreFlag(name: "ACTIVE_STANDARD_RELEASE_ENABLED" | "TMT_V2_EXPORT_ENABLED", value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function migrate(connection: Connection): Promise<void> {
  await connection.query("CREATE TABLE schema_migrations (filename VARCHAR(255) NOT NULL PRIMARY KEY, content_hash CHAR(64) NOT NULL, applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3))");
  const directory = new URL("../src/db/migrations/", import.meta.url);
  for (const filename of (await readdir(directory)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort()) {
    const migration = await readFile(new URL(filename, directory), "utf8");
    await connection.query(migration);
    await connection.execute("INSERT INTO schema_migrations (filename,content_hash) VALUES (?,?)", [filename, createHash("sha256").update(migration).digest("hex")]);
  }
}

describe.runIf(enabled)("Phase 2C active release consumers on isolated Laragon MySQL", () => {
  beforeAll(async () => {
    assert.equal(process.env.NODE_ENV, "test");
    assert.equal(process.env.TMT_V2_TEST_HOST, "127.0.0.1");
    assert.equal(Number(process.env.TMT_V2_TEST_PORT), 3306);
    assert.equal(process.env.TMT_V2_TEST_DATABASE, database);
    assert.equal(process.env.TMT_V2_TEST_USERNAME, "root");
    server = await mysql.createConnection({
      host: "127.0.0.1", port: 3306, user: "root",
      password: process.env.TMT_V2_TEST_PASSWORD ?? "", multipleStatements: true,
    });
    const [[identity]] = await server.query<mysql.RowDataPacket[]>("SELECT @@port AS port,@@version AS version,@@datadir AS datadir");
    assert.equal(Number(identity?.port), 3306);
    assert.match(String(identity?.version), /^8\.4\.3/);
    assert.match(String(identity?.datadir), /laragon/i);
    const [existing] = await server.execute<mysql.RowDataPacket[]>("SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME=?", [database]);
    assert.equal(existing.length, 0, "refuse to reuse a pre-existing database");

    await server.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    createdHere = true;
    await server.query(`USE \`${database}\``);
    await migrate(server);
    pool = mysql.createPool({ host: "127.0.0.1", port: 3306, user: "root", password: process.env.TMT_V2_TEST_PASSWORD ?? "", database, timezone: "Z" });
    const globals = globalThis as typeof globalThis & { appDbPool?: Pool; appDb?: unknown };
    globals.appDbPool = pool;
    globals.appDb = undefined;
    process.env.ACTIVE_STANDARD_RELEASE_ENABLED = "1";
    process.env.TMT_V2_EXPORT_ENABLED = "1";

    const { db } = await import("@/db/client");
    const schema = await import("@/db/schema");
    const now = new Date("2026-11-13T00:00:00.000Z");
    const facilityId = "00000000-0000-4000-8000-000000000201";
    const sourceDrugId = "00000000-0000-4000-8000-000000000202";
    const mappingId = "00000000-0000-4000-8000-000000000203";
    const runId = "00000000-0000-4000-8000-000000000204";
    const importId = "00000000-0000-4000-8000-000000000205";
    const tmtA = "00000000-0000-4000-8000-000000000211";
    const ttmtA = "00000000-0000-4000-8000-000000000212";
    const tmtB = "00000000-0000-4000-8000-000000000213";
    const ttmtB = "00000000-0000-4000-8000-000000000214";
    const releaseA = "00000000-0000-4000-8000-000000000221";
    const releaseB = "00000000-0000-4000-8000-000000000222";

    await db.insert(schema.facilities).values({ id: facilityId, facilityCode: "P2C01", facilityName: "Phase 2C synthetic", status: "active" });
    await db.insert(schema.sourceDrugs).values({ id: sourceDrugId, facilityId, drugcode: "P2C-01", drugtype: "01", active: 1, lastSeenSyncId: randomUUID() });
    await db.insert(schema.drugMappings).values({
      id: mappingId, facilityId, sourceDrugId, standardCode: "565818", standardSource: "TMT", standardLevel: "tpu",
      productCat: "1", updateFlag: "A", source: "manual", mappedBy: randomUUID(), mappedAt: now, updatedAt: now,
    });
    await db.insert(schema.ttmtImports).values({ id: importId, version: "phase2c", filename: "synthetic.xlsx", contentHash: "a".repeat(64), rowCount: 1, status: "succeeded", startedAt: now, completedAt: now });
    await db.insert(schema.tmtSyncRuns).values({ id: runId, tmtVersion: "unverified:phase2c0000000000", mode: "full_unverified", status: "unverified", errorCode: "TMT_VERSION_UNVERIFIED", startedAt: now, finishedAt: now });
    await db.insert(schema.tmtRunValidations).values({
      runId, policyVersion: "validated-unverified-v1", status: "passed", validatedAt: now,
      requiredCheckpointCount: 14, requiredSucceededCount: 14, optionalFailureCount: 0, blockingInvariantCount: 0,
      invariantEvidence: "{}", gpu764169Passed: 1, ttmtImportId: importId, ttmtContentHash: "a".repeat(64),
      ttmtRowCount: 1, evidenceSha256: "b".repeat(64),
    });
    await db.insert(schema.standardDatasets).values([
      { id: tmtA, source: "TMT", state: "validated", sourceVersion: "A" },
      { id: ttmtA, source: "TTMT", state: "validated", sourceVersion: "A" },
      { id: tmtB, source: "TMT", state: "validated", sourceVersion: "B" },
      { id: ttmtB, source: "TTMT", state: "validated", sourceVersion: "B" },
    ]);
    await db.insert(schema.standardReleases).values([
      { id: releaseA, state: "approved", tmtDatasetId: tmtA, ttmtDatasetId: ttmtA, validationRunId: runId, approvedAt: now },
      { id: releaseB, state: "approved", tmtDatasetId: tmtB, ttmtDatasetId: ttmtB, validationRunId: runId, approvedAt: now },
    ]);
    await db.insert(schema.standardDatasetPointers).values({ pointerKey: "active-standard-release", activeReleaseId: releaseA });
    for (const [datasetId, label] of [[tmtA, "A"], [tmtB, "B"]] as const) {
      await db.insert(schema.tmtDatasetConcepts).values({ datasetId, tmtid: 565818n, fsn: `TPU ${label}`, changeDate: "2026-11-13", levelName: "tpu", normalizedFsn: `tpu ${label.toLowerCase()}`, sourceVersion: label, lastSeenVersion: label, syncedAt: now });
      await server.execute("INSERT INTO tmt_dataset_tpu (dataset_id,tpuid,fsn,manufacturer,change_date,normalized_fsn,source_version,last_seen_version,synced_at) VALUES (?,?,?,?,?,?,?,?,?)", [datasetId, "565818", `TPU ${label}`, "Maker", "2026-11-13", `tpu ${label.toLowerCase()}`, label, label, now]);
      await db.insert(schema.tmtDatasetMastertmt).values({ datasetId, tpucode: 565818n, activeingredient: "Synthetic", dosageform: "tablet", fsn: "Synthetic TPU", status: 0, sourceVersion: label, lastSeenVersion: label, syncedAt: now });
    }
    for (const [datasetId, label] of [[ttmtA, "A"], [ttmtB, "B"]] as const) {
      await db.insert(schema.ttmtDatasetProducts).values({ datasetId, ttmtcode: "TTMT-1", fsn: `TTMT ${label}`, status: "active", sourceVersion: label, sourceImportId: importId });
    }
    await db.insert(schema.tmtConcept).values({ tmtid: 565818n, fsn: "LIVE TPU", changeDate: "2026-11-13", levelName: "tpu", normalizedFsn: "live tpu", sourceVersion: "live", lastSeenVersion: "live", syncedAt: now });
    await server.execute("INSERT INTO tmt_tpu (tpuid,fsn,manufacturer,change_date,normalized_fsn,source_version,last_seen_version,synced_at) VALUES (?,?,?,?,?,?,?,?)", ["565818", "LIVE TPU", "Live Maker", "2026-11-13", "live tpu", "live", "live", now]);
    await db.insert(schema.tmtMastertmt).values({ tpucode: 565818n, activeingredient: "Live Synthetic", dosageform: "tablet", fsn: "LIVE TPU", status: 0, sourceVersion: "live", lastSeenVersion: "live", syncedAt: now });
  }, 30_000);

  afterAll(async () => {
    restoreFlag("ACTIVE_STANDARD_RELEASE_ENABLED", previousFlags.active);
    restoreFlag("TMT_V2_EXPORT_ENABLED", previousFlags.export);
    const globals = globalThis as typeof globalThis & { appDbPool?: Pool; appDb?: unknown };
    globals.appDb = undefined;
    globals.appDbPool = undefined;
    await pool?.end();
    if (!server) return;
    const [[identity]] = await server.query<mysql.RowDataPacket[]>("SELECT @@port AS port,@@version AS version,@@datadir AS datadir");
    assert.equal(Number(identity?.port), 3306);
    assert.match(String(identity?.version), /^8\.4\.3/);
    assert.match(String(identity?.datadir), /laragon/i);
    if (createdHere) {
      const [before] = await server.execute<mysql.RowDataPacket[]>("SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME=?", [database]);
      assert.equal(before.length, 1);
      await server.query("USE mysql");
      await server.query(`DROP DATABASE \`${database}\``);
      const [after] = await server.execute<mysql.RowDataPacket[]>("SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME=?", [database]);
      assert.equal(after.length, 0);
    }
    await server.end();
  });

  test("approved resolver and consumers stay inside one dataset while flag-off keeps live reads", async () => {
    const [{ readActiveStandardRelease }, { searchTmt }, { searchTtmtStandards }, { loadMappedStandardsV2 }] = await Promise.all([
      import("@/modules/standards/active-release"), import("@/modules/tmt/search"), import("@/modules/standards/ttmt-search"), import("@/modules/mappings/v2-consumer"),
    ]);
    const release = await readActiveStandardRelease(pool);
    assert.equal(release.releaseId, "00000000-0000-4000-8000-000000000221");
    const versioned = await searchTmt(pool, { tmtId: "565818" }, release);
    assert.equal(versioned[0]?.conceptFsn, "TPU A");
    const ttmt = await searchTtmtStandards(pool, "TTMT", release);
    assert.equal(ttmt[0]?.fsn, "TTMT A");
    const mapped = await loadMappedStandardsV2([{ source: "TMT", code: "565818", level: "tpu", productCat: "1" }], undefined, release);
    assert.equal(mapped.values().next().value?.fsn, "Synthetic TPU");

    process.env.ACTIVE_STANDARD_RELEASE_ENABLED = "0";
    const legacy = await searchTmt(pool, { tmtId: "565818" });
    assert.equal(legacy[0]?.conceptFsn, "LIVE TPU");
    process.env.ACTIVE_STANDARD_RELEASE_ENABLED = "1";
  });

  test("missing or unapproved active release fails closed", async () => {
    const { readActiveStandardRelease, ActiveStandardReleaseError } = await import("@/modules/standards/active-release");
    await server.execute("UPDATE standard_releases SET state='candidate' WHERE id='00000000-0000-4000-8000-000000000221'");
    await assert.rejects(() => readActiveStandardRelease(pool), ActiveStandardReleaseError);
    await server.execute("UPDATE standard_releases SET state='approved' WHERE id='00000000-0000-4000-8000-000000000221'");
  });

  test("release switch stales identical preview without consuming token or advancing checkpoints", async () => {
    const [{ db }, schema, exportService] = await Promise.all([import("@/db/client"), import("@/db/schema"), import("@/modules/exports/service")]);
    const facilityId = "00000000-0000-4000-8000-000000000201";
    const preview = await exportService.createExportPreview(facilityId, "all-mapped");
    await db.update(schema.standardDatasetPointers).set({ activeReleaseId: "00000000-0000-4000-8000-000000000222" }).where(eq(schema.standardDatasetPointers.pointerKey, "active-standard-release"));
    await assert.rejects(
      () => exportService.createExport({ facilityId, facilityCode: "P2C01", userId: randomUUID(), selection: "all-mapped", previewToken: preview.previewToken }),
      { code: "EXPORT_PREVIEW_STALE" },
    );
    const [tokens] = await db.select({ consumedAt: schema.exportPreviewTokens.consumedAt }).from(schema.exportPreviewTokens);
    assert.equal(tokens?.consumedAt, null);
    const [checkpoints] = await db.select({ total: count() }).from(schema.mappingExportCheckpoints);
    assert.equal(Number(checkpoints?.total), 0);

    const currentPreview = await exportService.createExportPreview(facilityId, "all-mapped");
    await exportService.createExport({ facilityId, facilityCode: "P2C01", userId: randomUUID(), selection: "all-mapped", previewToken: currentPreview.previewToken });
    const releaseA = { releaseId: "00000000-0000-4000-8000-000000000221", tmtDatasetId: "00000000-0000-4000-8000-000000000211", ttmtDatasetId: "00000000-0000-4000-8000-000000000212" };
    const { buildExportCandidatesV2 } = await import("@/modules/exports/rows-v2");
    assert.equal((await buildExportCandidatesV2(facilityId, "manual-changes", db, false, releaseA)).length, 0, "release metadata alone is not a mapping delta");
  });

  test("application pointer lock blocks a concurrent release switch", async () => {
    const [{ db }, { readLockedActiveStandardRelease }] = await Promise.all([import("@/db/client"), import("@/modules/standards/active-release")]);
    const second = await mysql.createConnection({ host: "127.0.0.1", port: 3306, user: "root", password: process.env.TMT_V2_TEST_PASSWORD ?? "", database });
    await second.query("SET SESSION innodb_lock_wait_timeout=3");
    let settled = false;
    let update: Promise<unknown> | undefined;
    await db.transaction(async (tx) => {
      await readLockedActiveStandardRelease(tx);
      update = second.execute("UPDATE standard_dataset_pointers SET active_release_id='00000000-0000-4000-8000-000000000221' WHERE pointer_key='active-standard-release'").then((value) => { settled = true; return value; });
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal(settled, false);
    });
    await update;
    await second.end();
  });
});
