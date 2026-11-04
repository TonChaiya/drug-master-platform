import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import mysql, { type Connection } from "mysql2/promise";
import { afterAll, beforeAll, describe, test } from "vitest";

const expectedDatabase = "drug_master_tmt_v2_test";
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

test("clean local database migrates through 0015 and rerun is idempotent", async () => {
  const first = await migrate();
  assert.equal(first.at(-2), "0014_tmt_data_model_v2.sql");
  assert.equal(first.at(-1), "0015_ttmt_data_model_v2.sql");
  assert.deepEqual(await migrate(), []);

  const [journal] = await connection.query<mysql.RowDataPacket[]>("SELECT filename, content_hash FROM schema_migrations ORDER BY filename");
  assert.equal(journal.length, 15);
  assert.equal(journal.at(-2)?.filename, "0014_tmt_data_model_v2.sql");
  assert.equal(journal.at(-1)?.filename, "0015_ttmt_data_model_v2.sql");
  assert.match(String(journal.at(-1)?.content_hash), /^[a-f0-9]{64}$/);
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
    "SELECT (SELECT COUNT(*) FROM tmt_mastertmt) AS tmt_count, (SELECT COUNT(*) FROM ttmt_products) AS ttmt_count",
  );
  assert.deepEqual({ tmt: Number(counts?.tmt_count), ttmt: Number(counts?.ttmt_count) }, { tmt: 1, ttmt: 1 });
});
});
