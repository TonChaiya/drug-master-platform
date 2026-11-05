import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { and, count, eq } from "drizzle-orm";
import mysql, { type Connection } from "mysql2/promise";
import { afterAll, beforeAll, describe, test } from "vitest";

const expectedDatabase = "drug_master_mapping_v2_test";
const host = process.env.TMT_V2_TEST_HOST;
const port = Number(process.env.TMT_V2_TEST_PORT);
const database = process.env.TMT_V2_TEST_DATABASE;
const user = process.env.TMT_V2_TEST_USERNAME;

let connection: Connection;

const enabled = process.env.ALLOW_DB_INTEGRATION_TESTS === "1";

describe.runIf(enabled)("TMT v2 migrations on isolated Laragon MySQL", () => {
beforeAll(async () => {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(host, "127.0.0.1");
  assert.equal(port, 3307);
  assert.equal(database, expectedDatabase);
  assert.equal(user, "root");

  connection = await mysql.createConnection({ host, port, user, password: process.env.TMT_V2_TEST_PASSWORD ?? "", multipleStatements: true });
  const [[identity]] = await connection.query<mysql.RowDataPacket[]>("SELECT @@hostname AS hostname, @@port AS port");
  assert.equal(Number(identity?.port), 3307);

  await connection.query(`DROP DATABASE IF EXISTS \`${expectedDatabase}\``);
  await connection.query(`CREATE DATABASE \`${expectedDatabase}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await connection.query(`USE \`${expectedDatabase}\``);
  await connection.query(`CREATE TABLE schema_migrations (
    filename VARCHAR(255) NOT NULL PRIMARY KEY,
    content_hash CHAR(64) NOT NULL,
    applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  )`);
});

afterAll(async () => {
  if (!connection) return;
  await connection.query("USE mysql");
  await connection.query(`DROP DATABASE IF EXISTS \`${expectedDatabase}\``);
  await connection.end();
});

async function migrate(): Promise<string[]> {
  const directory = new URL("../src/db/migrations/", import.meta.url);
  const filenames = (await readdir(directory)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
  const applied: string[] = [];
  for (const filename of filenames) {
    const sql = await readFile(new URL(filename, directory), "utf8");
    const hash = createHash("sha256").update(sql).digest("hex");
    const [rows] = await connection.execute<mysql.RowDataPacket[]>("SELECT content_hash FROM schema_migrations WHERE filename = ?", [filename]);
    if (rows[0]) {
      assert.equal(rows[0].content_hash, hash);
      continue;
    }
    await connection.query(sql);
    await connection.execute("INSERT INTO schema_migrations (filename, content_hash) VALUES (?, ?)", [filename, hash]);
    applied.push(filename);
  }
  return applied;
}

test("clean local database migrates through 0016 and rerun is idempotent", async () => {
  const first = await migrate();
  assert.equal(first.at(-3), "0014_tmt_data_model_v2.sql");
  assert.equal(first.at(-2), "0015_ttmt_data_model_v2.sql");
  assert.equal(first.at(-1), "0016_mapping_v2_identity.sql");
  assert.deepEqual(await migrate(), []);

  const [journal] = await connection.query<mysql.RowDataPacket[]>("SELECT filename, content_hash FROM schema_migrations ORDER BY filename");
  assert.equal(journal.length, 16);
  assert.equal(journal.at(-3)?.filename, "0014_tmt_data_model_v2.sql");
  assert.equal(journal.at(-2)?.filename, "0015_ttmt_data_model_v2.sql");
  assert.equal(journal.at(-1)?.filename, "0016_mapping_v2_identity.sql");
  assert.match(String(journal.at(-1)?.content_hash), /^[a-f0-9]{64}$/);
});

test("mapping v2 identity is nullable for legacy rows and indexed for new identities", async () => {
  await connection.execute(
    "INSERT INTO facilities (id, facility_code, facility_name, status) VALUES ('migrate-facility', '99999', 'Migration test', 'active')",
  );
  await connection.execute(
    "INSERT INTO drug_mappings (id, facility_id, source_drug_id, standard_code, product_cat, update_flag, source, mapped_by, mapped_at) VALUES ('legacy-map', 'migrate-facility', 'legacy-source', 'legacy-code', '1', 'A', 'manual', 'migrate-user', NOW(3))",
  );
  await connection.execute(
    "INSERT INTO drug_mappings (id, facility_id, source_drug_id, standard_code, standard_source, standard_level, product_cat, update_flag, source, mapped_by, mapped_at) VALUES ('v2-map', 'migrate-facility', 'v2-source', '565818', 'TMT', 'tpu', '1', 'A', 'manual', 'migrate-user', NOW(3))",
  );
  const [rows] = await connection.query<mysql.RowDataPacket[]>("SELECT id, standard_source, standard_level FROM drug_mappings WHERE id IN ('legacy-map', 'v2-map') ORDER BY id");
  assert.deepEqual(rows.map((row) => [row.id, row.standard_source, row.standard_level]), [["legacy-map", null, null], ["v2-map", "TMT", "tpu"]]);
  const [indexes] = await connection.query<mysql.RowDataPacket[]>("SHOW INDEX FROM drug_mappings");
  assert.ok(indexes.some((row) => row.Key_name === "idx_mappings_facility_standard_source"));
  assert.ok(indexes.some((row) => row.Key_name === "idx_mappings_standard_identity"));
});

test("v2 save persists the explicit TMT identity and rejects a source drug outside the facility", async () => {
  const appPool = mysql.createPool({ host, port, user, password: process.env.TMT_V2_TEST_PASSWORD ?? "", database: expectedDatabase, timezone: "Z" });
  const globals = globalThis as typeof globalThis & { appDbPool?: typeof appPool; appDb?: unknown };
  globals.appDbPool = appPool;
  globals.appDb = undefined;
  try {
    const [{ db }, schema, { saveV2Mapping }, { resolveMappingV2Standard }, { classifyMappingLifecycle }] = await Promise.all([import("@/db/client"), import("@/db/schema"), import("@/modules/mappings/v2-service"), import("@/modules/mappings/v2"), import("@/modules/mappings/lifecycle")]);
    const facilityA = randomUUID();
    const facilityB = randomUUID();
    const sourceDrugId = randomUUID();
    const ttmtSourceDrugId = randomUUID();
    const syncId = randomUUID();
    await db.insert(schema.facilities).values([
      { id: facilityA, facilityCode: `A${facilityA.slice(0, 4)}`, facilityName: "Mapping v2 A", status: "active" },
      { id: facilityB, facilityCode: `B${facilityB.slice(0, 4)}`, facilityName: "Mapping v2 B", status: "active" },
    ]);
    await db.insert(schema.sourceDrugs).values([
      { id: sourceDrugId, facilityId: facilityA, drugcode: "V2-DRUG", drugtype: "01", active: 1, lastSeenSyncId: syncId },
      { id: ttmtSourceDrugId, facilityId: facilityA, drugcode: "V2-TTMT", drugtype: "10", active: 1, lastSeenSyncId: syncId },
    ]);
    await db.insert(schema.tmtConcept).values([
      { tmtid: 764169n, fsn: "synthetic GPU", changeDate: "2026-11-04", levelName: "gpu", sourceVersion: "fixture", lastSeenVersion: "fixture", syncedAt: new Date() },
      { tmtid: 565818n, fsn: "fixture TPU A", changeDate: "2026-11-04", levelName: "tpu", sourceVersion: "fixture", lastSeenVersion: "fixture", syncedAt: new Date() },
      { tmtid: 566021n, fsn: "fixture TPU B", changeDate: "2026-11-04", levelName: "tpu", sourceVersion: "fixture", lastSeenVersion: "fixture", syncedAt: new Date() },
    ]);
    await db.insert(schema.tmtMastertmt).values([
      { tpucode: 565818n, status: 0, sourceVersion: "fixture", lastSeenVersion: "fixture", syncedAt: new Date() },
      { tpucode: 566021n, status: 0, sourceVersion: "fixture", lastSeenVersion: "fixture", syncedAt: new Date() },
    ]);
    await assert.rejects(
      () => saveV2Mapping({ facilityId: facilityA, userId: randomUUID(), sourceDrugId, standardSource: "TMT", standardCode: "764169", standardLevel: "tpu" }),
      { code: "STANDARD_NOT_ELIGIBLE" },
    );
    const saved = await saveV2Mapping({ facilityId: facilityA, userId: randomUUID(), sourceDrugId, standardSource: "TMT", standardCode: "565818", standardLevel: "tpu" });
    const [mapping] = await db.select({ source: schema.drugMappings.standardSource, code: schema.drugMappings.standardCode, level: schema.drugMappings.standardLevel }).from(schema.drugMappings).where(eq(schema.drugMappings.id, saved.mappingId));
    assert.deepEqual(mapping, { source: "TMT", code: "565818", level: "tpu" });
    const firstConfirm = await saveV2Mapping({ facilityId: facilityA, userId: randomUUID(), sourceDrugId, standardSource: "TMT", standardCode: "565818", standardLevel: "tpu", confirmReview: true });
    assert.equal(firstConfirm.reviewConfirmed, true);
    const repeatedConfirm = await saveV2Mapping({ facilityId: facilityA, userId: randomUUID(), sourceDrugId, standardSource: "TMT", standardCode: "565818", standardLevel: "tpu", confirmReview: true });
    assert.equal(repeatedConfirm.reviewNoop, true);
    const [reviewAudits] = await db.select({ total: count() }).from(schema.auditLogs).where(and(eq(schema.auditLogs.entityId, saved.mappingId), eq(schema.auditLogs.action, "mapping.review_confirmed")));
    assert.equal(Number(reviewAudits?.total), 1);
    const [ackBeforeChange] = await db.select().from(schema.mappingReviewAcknowledgements).where(eq(schema.mappingReviewAcknowledgements.mappingId, saved.mappingId));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await saveV2Mapping({ facilityId: facilityA, userId: randomUUID(), sourceDrugId, standardSource: "TMT", standardCode: "566021", standardLevel: "tpu" });
    const [changedMapping] = await db.select({ standardCode: schema.drugMappings.standardCode, updatedAt: schema.drugMappings.updatedAt }).from(schema.drugMappings).where(eq(schema.drugMappings.id, saved.mappingId));
    assert.equal(changedMapping?.standardCode, "566021");
    assert.notEqual(changedMapping?.updatedAt.getTime(), ackBeforeChange?.mappingUpdatedAt.getTime());
    await db.update(schema.tmtMastertmt).set({ status: 1 }).where(eq(schema.tmtMastertmt.tpucode, 566021n));
    const invalidStandard = await resolveMappingV2Standard({ source: "TMT", code: "566021", level: "tpu", productCat: "1" });
    assert.equal(invalidStandard.eligible, false);
    assert.equal(classifyMappingLifecycle({ active: true, mapping: { source: "manual", standardCode: "566021", updatedAt: changedMapping?.updatedAt }, standardValid: invalidStandard.eligible, inLatestCatalog: false, latestCatalogTmtid: null, everInCatalog: false }).status, "needs_review");
    const ttmtImportId = randomUUID();
    await db.insert(schema.ttmtImports).values({ id: ttmtImportId, version: "fixture-v1", filename: "fixture.xlsx", contentHash: "b".repeat(64), rowCount: 2, status: "succeeded", startedAt: new Date(), completedAt: new Date() });
    await db.insert(schema.ttmtProducts).values([
      { ttmtcode: "565818", status: "active", sourceVersion: "fixture-v1", sourceImportId: ttmtImportId },
      { ttmtcode: "TTMT-INACTIVE", status: "inactive", sourceVersion: "fixture-v1", sourceImportId: ttmtImportId },
    ]);
    const ttmtSaved = await saveV2Mapping({ facilityId: facilityA, userId: randomUUID(), sourceDrugId: ttmtSourceDrugId, standardSource: "TTMT", standardCode: "565818", standardLevel: "product" });
    const [ttmtMapping] = await db.select({ source: schema.drugMappings.standardSource, code: schema.drugMappings.standardCode, level: schema.drugMappings.standardLevel }).from(schema.drugMappings).where(eq(schema.drugMappings.id, ttmtSaved.mappingId));
    assert.deepEqual(ttmtMapping, { source: "TTMT", code: "565818", level: "product" });
    await assert.rejects(() => saveV2Mapping({ facilityId: facilityA, userId: randomUUID(), sourceDrugId: ttmtSourceDrugId, standardSource: "TTMT", standardCode: "TTMT-INACTIVE", standardLevel: "product" }), { code: "STANDARD_NOT_ELIGIBLE" });
    await assert.rejects(
      () => saveV2Mapping({ facilityId: facilityB, userId: randomUUID(), sourceDrugId, standardSource: "TMT", standardCode: "565818", standardLevel: "tpu" }),
      { code: "SOURCE_DRUG_NOT_FOUND" },
    );
  } finally {
    globals.appDb = undefined;
    globals.appDbPool = undefined;
    await appPool.end();
  }
});

test("local MySQL exposes all v2 tables and required keys", async () => {
  const [tables] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND (TABLE_NAME LIKE 'tmt\\_%' OR TABLE_NAME LIKE 'ttmt\\_%') ORDER BY TABLE_NAME",
    [expectedDatabase],
  );
  assert.deepEqual(tables.map((row) => row.TABLE_NAME), [
    "tmt_atc", "tmt_concept", "tmt_gp", "tmt_gpp", "tmt_gpu", "tmt_mastertmt", "tmt_nlem", "tmt_regno", "tmt_relationship",
    "tmt_subs", "tmt_sync_checkpoints", "tmt_sync_runs", "tmt_tp", "tmt_tpp", "tmt_tpu", "tmt_version", "tmt_vtm",
    "ttmt_imports", "ttmt_products",
  ]);

  const [relationshipIndexes] = await connection.query<mysql.RowDataPacket[]>("SHOW INDEX FROM tmt_relationship");
  assert.ok(relationshipIndexes.some((row) => row.Key_name === "PRIMARY" && row.Column_name === "concept1"));
  assert.ok(relationshipIndexes.some((row) => row.Key_name === "idx_tmt_relationship_reverse" && row.Column_name === "concept2"));

  const [foreignKeys] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT TABLE_NAME, REFERENCED_TABLE_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME",
    [expectedDatabase],
  );
  assert.deepEqual(
    foreignKeys.filter((row) => ["tmt_nlem", "tmt_atc", "tmt_regno", "tmt_relationship"].includes(row.TABLE_NAME)),
    [],
  );
});

test("equal numeric TMT and TTMT codes coexist in separate tables", async () => {
  const timestamp = new Date("2026-11-04T00:00:00.000Z");
  await connection.execute(
    "INSERT INTO tmt_mastertmt (tpucode, status, source_version, last_seen_version, synced_at) VALUES (?, 0, '20261102', '20261102', ?)",
    ["9003806", timestamp],
  );
  await connection.execute(
    "INSERT INTO ttmt_imports (id, version, filename, content_hash, status, started_at) VALUES ('import-1', 'v1', 'fixture.xlsx', ?, 'succeeded', ?)",
    ["a".repeat(64), timestamp],
  );
  await connection.execute(
    "INSERT INTO ttmt_products (ttmtcode, status, source_version, source_import_id) VALUES ('9003806', 'active', 'v1', 'import-1')",
  );
  const [[counts]] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT (SELECT COUNT(*) FROM tmt_mastertmt WHERE tpucode='9003806') AS tmt_count, (SELECT COUNT(*) FROM ttmt_products WHERE ttmtcode='9003806') AS ttmt_count",
  );
  assert.deepEqual({ tmt: Number(counts?.tmt_count), ttmt: Number(counts?.ttmt_count) }, { tmt: 1, ttmt: 1 });
});
});
