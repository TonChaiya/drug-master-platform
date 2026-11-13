import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import mysql, { type Connection } from "mysql2/promise";
import { afterAll, beforeAll, describe, test } from "vitest";
import { datasetStagingStoreForPool, stageDatasetCandidate } from "@/modules/standards/dataset-staging";

const database = "drug_master_mapping_v2_test";
const enabled = process.env.ALLOW_DB_INTEGRATION_TESTS === "1";
let server: Connection;
let pool: mysql.Pool;

describe.runIf(enabled)("dataset staging writer on isolated Laragon MySQL", () => {
  beforeAll(async () => {
    assert.equal(process.env.NODE_ENV, "test");
    assert.equal(process.env.TMT_V2_TEST_HOST, "127.0.0.1");
    assert.equal(Number(process.env.TMT_V2_TEST_PORT), 3306);
    assert.equal(process.env.TMT_V2_TEST_DATABASE, database);
    server = await mysql.createConnection({ host: "127.0.0.1", port: 3306, user: process.env.TMT_V2_TEST_USERNAME, password: process.env.TMT_V2_TEST_PASSWORD ?? "", multipleStatements: true });
    const [[identity]] = await server.query<mysql.RowDataPacket[]>("SELECT @@port AS port, @@version AS version, @@datadir AS datadir");
    assert.equal(Number(identity?.port), 3306);
    assert.match(String(identity?.version), /^8\.4\.3/);
    assert.match(String(identity?.datadir), /laragon/i);
    const [existing] = await server.query<mysql.RowDataPacket[]>("SHOW DATABASES LIKE ?", [database]);
    assert.equal(existing.length, 0, "refuse to reuse a pre-existing test database");
    await server.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await server.query(`USE \`${database}\``);
    await server.query("CREATE TABLE schema_migrations (filename VARCHAR(255) NOT NULL PRIMARY KEY, content_hash CHAR(64) NOT NULL, applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3))");
    const directory = new URL("../src/db/migrations/", import.meta.url);
    for (const filename of (await readdir(directory)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort()) await server.query(await readFile(new URL(filename, directory), "utf8"));
    pool = mysql.createPool({ host: "127.0.0.1", port: 3306, user: process.env.TMT_V2_TEST_USERNAME, password: process.env.TMT_V2_TEST_PASSWORD ?? "", database, timezone: "Z" });
  }, 20_000);

  afterAll(async () => { await pool?.end(); await server?.query("USE mysql"); await server?.query(`DROP DATABASE IF EXISTS \`${database}\``); await server?.end(); });

  test("writes immutable TMT and TTMT candidates with deterministic manifests and rollback", async () => {
    const store = datasetStagingStoreForPool(pool);
    const runId = randomUUID(); const importId = randomUUID();
    await pool.execute("INSERT INTO tmt_sync_runs (id,tmt_version,mode,status,started_at) VALUES (?,'v1','full','succeeded',NOW(3))", [runId]);
    await pool.execute("INSERT INTO ttmt_imports (id,version,filename,content_hash,row_count,status,started_at) VALUES (?,'v1','x.xlsx',?,1,'succeeded',NOW(3))", [importId, "a".repeat(64)]);
    const tmt = { id: randomUUID(), source: "TMT" as const, sourceVersion: "v1", tmtSyncRunId: runId, tables: [{ tableName: "tmt_dataset_concepts", rows: [{ tmtid: 1, fsn: "one", change_date: "2026-01-01", level_name: "tpu", source_version: "v1", last_seen_version: "v1", synced_at: "2026-01-01 00:00:00" }] }] };
    const manifest = await stageDatasetCandidate(tmt, store);
    await stageDatasetCandidate(tmt, store);
    const [manifestRows] = await pool.query<mysql.RowDataPacket[]>("SELECT row_count,content_hash FROM standard_dataset_manifests WHERE dataset_id=?", [tmt.id]);
    assert.deepEqual(manifestRows.map((row) => ({ rowCount: Number(row.row_count), contentHash: row.content_hash })), [{ rowCount: 1, contentHash: manifest[0]?.contentHash }]);
    await assert.rejects(() => store.writeSnapshot({ datasetId: tmt.id, tables: tmt.tables }), /writing candidate/);

    const failedRunId = randomUUID();
    await pool.execute("INSERT INTO tmt_sync_runs (id,tmt_version,mode,status,started_at) VALUES (?,'v2','full','succeeded',NOW(3))", [failedRunId]);
    const failed = { id: randomUUID(), source: "TMT" as const, sourceVersion: "v2", tmtSyncRunId: failedRunId, tables: [{ tableName: "tmt_dataset_concepts", rows: [{ tmtid: 2, fsn: "two", change_date: "2026-01-01", level_name: "tpu", source_version: "v2", last_seen_version: "v2", synced_at: "2026-01-01 00:00:00" }] }, { tableName: "tmt_dataset_subs", rows: [{ invalid_column: "rollback" }] }] };
    await assert.rejects(() => stageDatasetCandidate(failed, store));
    const [[failedRow]] = await pool.query<mysql.RowDataPacket[]>("SELECT state FROM standard_datasets WHERE id=?", [failed.id]);
    const [[written]] = await pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS total FROM tmt_dataset_concepts WHERE dataset_id=?", [failed.id]);
    assert.equal(failedRow?.state, "failed");
    assert.equal(Number(written?.total), 0);
  });
});
