import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import mysql, { type Connection, type Pool, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, test } from "vitest";
import { writeXls, type CellValue } from "@/lib/excel/biff-writer";
import { mysqlResetStore, runPhase7Reset } from "@/modules/phase7/reset";
import { runOperationalTmtSync } from "@/modules/phase7/tmt-runner";
import { maintenanceMutationResponse } from "@/modules/maintenance/route-guard";
import { setMaintenanceMode } from "@/modules/maintenance/service";
import { TmtSyncRepository } from "@/modules/tmt/persistence";
import { runInitialTmtSync, type TmtSyncSource } from "@/modules/tmt/sync";
import { clearIntegrationTestPool, installIntegrationTestPool } from "./helpers/db-integration";

const enabled = process.env.ALLOW_DB_INTEGRATION_TESTS === "1";
const expectedDatabase = "drug_master_phase7_readiness_test";
let server: Connection;
let pool: Pool;

function cells(values: string[]): CellValue[] { return values.map((value) => ({ kind: "text", value })); }
function fixture(): Buffer {
  return writeXls({ sheetName: "MasterTTMT", rows: [
    cells(["TTMTCODE", "ACTIVEINGREDIENT", "STATUS", "NLEM"]),
    cells(["565818", "ยา ก", "0", "ED"]), cells(["565819", "ยา ข", "inactive", "NED"]),
  ] });
}

describe.runIf(enabled).sequential("Phase 7A readiness on isolated local MySQL", () => {
  beforeAll(async () => {
    assert.equal(process.env.NODE_ENV, "test");
    assert.equal(process.env.DB_HOST, "127.0.0.1");
    assert.equal(Number(process.env.DB_PORT), 3307);
    assert.equal(process.env.DB_DATABASE, expectedDatabase);
    assert.equal(process.env.DB_USERNAME, "root");
    server = await mysql.createConnection({ host: "127.0.0.1", port: 3307, user: "root", password: process.env.DB_PASSWORD ?? "", multipleStatements: true });
    await server.query(`DROP DATABASE IF EXISTS \`${expectedDatabase}\``);
    await server.query(`CREATE DATABASE \`${expectedDatabase}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await server.query(`USE \`${expectedDatabase}\``);
    await server.query("CREATE TABLE schema_migrations (filename VARCHAR(255) NOT NULL PRIMARY KEY, content_hash CHAR(64) NOT NULL, applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3))");
    const directory = new URL("../src/db/migrations/", import.meta.url);
    const filenames = (await readdir(directory)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
    for (const filename of filenames) {
      const migration = await readFile(new URL(filename, directory), "utf8");
      await server.query(migration);
      await server.execute("INSERT INTO schema_migrations (filename,content_hash) VALUES (?,?)", [filename, createHash("sha256").update(migration).digest("hex")]);
    }
    assert.equal(filenames.at(-1), "0016_mapping_v2_identity.sql");
    pool = mysql.createPool({ host: "127.0.0.1", port: 3307, user: "root", password: process.env.DB_PASSWORD ?? "", database: expectedDatabase, timezone: "Z" });
    installIntegrationTestPool(pool);
    process.env.APP_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  }, 60_000);

  afterAll(async () => {
    clearIntegrationTestPool();
    if (pool) await pool.end();
    if (server) { await server.query("USE mysql"); await server.query(`DROP DATABASE IF EXISTS \`${expectedDatabase}\``); await server.end(); }
  });

  test("TMT runner dry-run writes nothing and local execution reuses Phase 3 engine", async () => {
    const repository = new TmtSyncRepository(pool);
    const [before] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS total FROM tmt_sync_runs");
    const dry = await runOperationalTmtSync({ mode: "full", dryRun: true, credentialPresent: true }, {
      full: async () => { throw new Error("dry-run must not call engine"); }, incremental: async () => { throw new Error("not called"); }, resume: async () => { throw new Error("not called"); },
    });
    assert.equal(dry.dryRun, true);
    const [afterDry] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS total FROM tmt_sync_runs");
    assert.equal(Number(afterDry[0]?.total), Number(before[0]?.total));
    let versionCalls = 0;
    const source: TmtSyncSource = {
      async version() { versionCalls += 1; return "20261109"; },
      async fetch(endpoint) { return endpoint === "gpu" ? [{ gpuid: "764169", fsn: "fixture GPU", changeDate: "2026-11-09" }] as never : [] as never; },
      async resetAuthentication() {},
    };
    let clockTick = 0;
    const executed = await runOperationalTmtSync({ mode: "full", dryRun: false, credentialPresent: true }, {
      full: () => runInitialTmtSync({ source, store: repository, now: () => new Date(Date.parse("2026-11-09T00:00:00Z") + clockTick++), sleep: async () => undefined, coreEndpoints: ["gpu"], optionalEndpoints: [], historyStart: "2026-11-09" }),
      incremental: async () => { throw new Error("not called"); }, resume: async () => { throw new Error("not called"); },
    });
    assert.equal(executed.result?.coreReady, true);
    assert.equal(versionCalls, 2);
    const [gpu] = await pool.query<RowDataPacket[]>("SELECT fsn FROM tmt_gpu WHERE gpuid=764169");
    assert.equal(gpu[0]?.fsn, "fixture GPU");
  });

  test("TTMT v2 import is atomic, idempotent, and isolated from legacy/TMT namespaces", async () => {
    const { importMasterTtmtV2, TtmtImportError } = await import("@/modules/standards/ttmt-v2-import");
    const data = fixture();
    const dry = await importMasterTtmtV2({ filename: "fixture.xls", version: "fixture-v1", data, importedBy: randomUUID(), dryRun: true });
    assert.equal(dry.rowCount, 2);
    const [before] = await pool.query<RowDataPacket[]>("SELECT (SELECT COUNT(*) FROM standard_products) legacy_count,(SELECT COUNT(*) FROM tmt_mastertmt) tmt_count");
    await importMasterTtmtV2({ filename: "fixture.xls", version: "fixture-v1", data, importedBy: randomUUID(), dryRun: false });
    const [products] = await pool.query<RowDataPacket[]>("SELECT ttmtcode,status FROM ttmt_products ORDER BY ttmtcode");
    assert.deepEqual(products.map((row) => [row.ttmtcode, row.status]), [["565818", "active"], ["565819", "inactive"]]);
    await assert.rejects(
      () => importMasterTtmtV2({ filename: "fixture.xls", version: "fixture-v1", data, importedBy: randomUUID(), dryRun: false }),
      (error: unknown) => error instanceof TtmtImportError && error.code === "TTMT_VERSION_EXISTS",
    );
    const [after] = await pool.query<RowDataPacket[]>("SELECT (SELECT COUNT(*) FROM standard_products) legacy_count,(SELECT COUNT(*) FROM tmt_mastertmt) tmt_count");
    assert.deepEqual(after[0], before[0]);
  });

  test("persistent maintenance boundary blocks mutations and resumes after disable", async () => {
    const actorUserId = randomUUID();
    assert.equal(await maintenanceMutationResponse(), null);
    await setMaintenanceMode({ enabled: true, reason: "local cutover rehearsal", actorUserId });
    const blocked = await maintenanceMutationResponse();
    assert.equal(blocked?.status, 503);
    const [audits] = await pool.query<RowDataPacket[]>("SELECT action FROM audit_logs WHERE entity_id='maintenance_mode' ORDER BY created_at");
    assert.ok(audits.some((row) => row.action === "maintenance.enabled"));
    await setMaintenanceMode({ enabled: false, reason: "local rehearsal complete", actorUserId });
    assert.equal(await maintenanceMutationResponse(), null);
  });

  test("controlled reset dry-run writes zero and execute preserves every KEEP table", async () => {
    const facilityId = randomUUID();
    const userId = randomUUID();
    await pool.execute("INSERT INTO facilities (id,facility_code,facility_name,status) VALUES (?,?,?,'active')", [facilityId, "P7001", "Phase 7 fixture"]);
    await pool.execute("INSERT INTO users (id,facility_id,username,username_normalized,full_name,position_name,password_hash,role,status) VALUES (?,?,?,?,?,?,?,'admin','active')", [userId, facilityId, "phase7", "phase7", "Phase 7", "Tester", "fixture"]);
    await pool.execute("INSERT INTO standard_imports (id,kind,version,row_count,status,started_at) VALUES (?,'TTMT','legacy-fixture',0,'succeeded',NOW(3))", [randomUUID()]);
    const store = mysqlResetStore(pool);
    const keepBefore = await Promise.all(["users", "facilities", "app_settings", "audit_logs", "schema_migrations"].map(async (table) => {
      const [rows] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM \`${table}\``); return [table, Number(rows[0]?.total)] as const;
    }));
    const dry = await runPhase7Reset({ execute: false, backupReference: "local-fixture-backup" }, store);
    assert.equal(dry.executed, false);
    const [legacyBefore] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS total FROM standard_imports");
    assert.ok(Number(legacyBefore[0]?.total) > 0);
    const done = await runPhase7Reset({ execute: true, backupReference: "local-fixture-backup" }, store);
    assert.equal(done.executed, true);
    assert.ok(Object.values(done.after ?? {}).every((count) => count === 0));
    for (const [table, count] of keepBefore) {
      const [rows] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM \`${table}\``);
      assert.equal(Number(rows[0]?.total), count, `${table} must be preserved`);
    }
    const [tables] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('standard_products','ttmt_products','tmt_gpu')");
    assert.equal(Number(tables[0]?.total), 3);
  });
});
