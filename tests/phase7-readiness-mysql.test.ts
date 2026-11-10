import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import mysql, { type Connection, type Pool, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, test } from "vitest";
import { writeXls, type CellValue } from "@/lib/excel/biff-writer";
import { mysqlResetStore, preservedTablesForMode, runPhase7Reset } from "@/modules/phase7/reset";
import { runOperationalTmtSync } from "@/modules/phase7/tmt-runner";
import { maintenanceMutationResponse } from "@/modules/maintenance/route-guard";
import { setMaintenanceMode } from "@/modules/maintenance/service";
import { TmtSyncRepository } from "@/modules/tmt/persistence";
import { runInitialTmtSync, type TmtSyncSource } from "@/modules/tmt/sync";
import { TMT_UNVERIFIED_REQUIRED_ENDPOINTS } from "@/modules/tmt/sync";
import { readTmtV2Readiness } from "@/modules/tmt/readiness";
import { canonicalizeTmtValidationCheckpoints } from "@/modules/tmt/validation";
import { clearIntegrationTestPool, installIntegrationTestPool } from "./helpers/db-integration";

const enabled = process.env.ALLOW_DB_INTEGRATION_TESTS === "1";
const expectedDatabase = "drug_master_phase7_readiness_test";
let server: Connection;
let pool: Pool;
let testPort: number;

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
    testPort = Number(process.env.DB_PORT);
    assert.ok(testPort === 3306 || testPort === 3307, "Phase 7 local test port must be the configured Laragon MySQL port");
    assert.equal(process.env.DB_DATABASE, expectedDatabase);
    assert.equal(process.env.DB_USERNAME, "root");
    server = await mysql.createConnection({ host: "127.0.0.1", port: testPort, user: "root", password: process.env.DB_PASSWORD ?? "", multipleStatements: true });
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
    assert.equal(filenames.at(-1), "0017_tmt_run_validations.sql");
    pool = mysql.createPool({ host: "127.0.0.1", port: testPort, user: "root", password: process.env.DB_PASSWORD ?? "", database: expectedDatabase, timezone: "Z" });
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
      full: async () => { throw new Error("dry-run must not call engine"); }, fullUnverified: async () => { throw new Error("not called"); }, incremental: async () => { throw new Error("not called"); }, resume: async () => { throw new Error("not called"); },
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
      fullUnverified: async () => { throw new Error("not called"); }, incremental: async () => { throw new Error("not called"); }, resume: async () => { throw new Error("not called"); },
    });
    assert.equal(executed.result?.coreReady, true);
    assert.equal(versionCalls, 2);
    const [gpu] = await pool.query<RowDataPacket[]>("SELECT fsn FROM tmt_gpu WHERE gpuid=764169");
    assert.equal(gpu[0]?.fsn, "fixture GPU");
    await assert.rejects(
      () => repository.createRun({ id: randomUUID(), version: "unverified:0123456789abcdef0123", mode: "full_unverified", startedAt: new Date() }),
      /must be empty/i,
    );
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

  test("persisted validated-unverified evidence is read fail-closed from MySQL", async () => {
    const runId = "00000000-0000-4000-8000-000000000717";
    const marker = `unverified:${runId.replaceAll("-", "").slice(0, 20)}`;
    const [[ttmt]] = await pool.query<RowDataPacket[]>("SELECT id,version,content_hash,row_count,status FROM ttmt_imports WHERE status='succeeded' LIMIT 1");
    await pool.execute(
      "INSERT INTO tmt_sync_runs (id,tmt_version,mode,status,error_code,started_at,finished_at) VALUES (?,?,'full_unverified','unverified','TMT_VERSION_UNVERIFIED','2026-11-10 08:00:00.000','2026-11-10 09:00:00.000')",
      [runId, marker],
    );
    for (const endpoint of TMT_UNVERIFIED_REQUIRED_ENDPOINTS) {
      await pool.execute(
        "INSERT INTO tmt_sync_checkpoints (run_id,endpoint,window_begin,window_end,status) VALUES (?,?, '2026-11-10','2026-11-10','succeeded')",
        [runId, endpoint],
      );
    }
    await pool.execute(
      "INSERT INTO tmt_sync_checkpoints (run_id,endpoint,window_begin,window_end,status,error_code) VALUES (?,'imagelist','2026-11-10','2026-11-10','failed','REMOTE_HTTP_500')",
      [runId],
    );
    const checkpointEvidence = canonicalizeTmtValidationCheckpoints([
        ...TMT_UNVERIFIED_REQUIRED_ENDPOINTS.map((endpoint) => ({
          endpoint, windowBegin: "2026-11-10", windowEnd: "2026-11-10", status: "succeeded",
          errorCode: null, receivedRows: 0, writtenRows: 0,
        })),
        { endpoint: "imagelist", windowBegin: "2026-11-10", windowEnd: "2026-11-10", status: "failed", errorCode: "REMOTE_HTTP_500", receivedRows: 0, writtenRows: 0 },
      ]);
    const invariantEvidence = JSON.stringify({
      policyVersion: "validated-unverified-v1",
      run: { id: runId, mode: "full_unverified", status: "unverified", errorCode: "TMT_VERSION_UNVERIFIED", tmtVersion: marker },
      checkpoints: checkpointEvidence,
      blockingInvariants: { missingConceptCounterparts: 0, missingEndpointCounterparts: 0, levelMismatch: 0, masterTmtMissingTpu: 0, masterTmtMissingConcept: 0, tpuMissingMasterTmt: 0, unknownLevels: 0, duplicateRelationshipPairs: 0, unknownMasterStatuses: 0 },
      gpu: { code: "764169", level: "gpu", outboundTpu: 1, relatedTpuPresent: 1, relatedMasterTmtPresent: 1, relatedConceptPresent: 1, activeMasterCount: 1 },
      ttmt: { id: ttmt?.id, version: ttmt?.version, contentHash: ttmt?.content_hash, rowCount: Number(ttmt?.row_count), status: ttmt?.status, productCount: 2, activeCount: 1, inactiveCount: 1, foreignProductCount: 0 },
    });
    await pool.execute(
      "INSERT INTO tmt_run_validations (run_id,policy_version,status,validated_at,required_checkpoint_count,required_succeeded_count,optional_failure_count,blocking_invariant_count,invariant_evidence,gpu_764169_passed,ttmt_import_id,ttmt_content_hash,ttmt_row_count,evidence_sha256) VALUES (?,'validated-unverified-v1','passed',NOW(3),?,?,1,0,?,1,?,?,?,?)",
      [runId, TMT_UNVERIFIED_REQUIRED_ENDPOINTS.length, TMT_UNVERIFIED_REQUIRED_ENDPOINTS.length, invariantEvidence, ttmt?.id, ttmt?.content_hash, ttmt?.row_count, createHash("sha256").update(invariantEvidence).digest("hex")],
    );
    assert.equal((await readTmtV2Readiness(pool)).assurance, "validated_unverified");
    await pool.execute("UPDATE tmt_sync_checkpoints SET status='failed' WHERE run_id=? AND endpoint=?", [runId, TMT_UNVERIFIED_REQUIRED_ENDPOINTS[0]]);
    assert.equal((await readTmtV2Readiness(pool)).ready, false);
    await pool.execute("UPDATE tmt_sync_checkpoints SET status='succeeded' WHERE run_id=?", [runId]);
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
    const tmtOnlyStore = mysqlResetStore(pool, "tmt-v2-only");
    const [[validationCount]] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS total FROM tmt_run_validations");
    if (Number(validationCount?.total) === 0) {
      const [[validationRun]] = await pool.query<RowDataPacket[]>("SELECT id FROM tmt_sync_runs ORDER BY started_at DESC LIMIT 1");
      const [[validationImport]] = await pool.query<RowDataPacket[]>("SELECT id,content_hash,row_count FROM ttmt_imports WHERE status='succeeded' LIMIT 1");
      await pool.execute(
        "INSERT INTO tmt_run_validations (run_id,policy_version,status,validated_at,required_checkpoint_count,required_succeeded_count,optional_failure_count,blocking_invariant_count,invariant_evidence,gpu_764169_passed,ttmt_import_id,ttmt_content_hash,ttmt_row_count,evidence_sha256) VALUES (?,'validated-unverified-v1','passed',NOW(3),1,1,0,0,'{}',1,?,?,?,?)",
        [validationRun?.id, validationImport?.id, validationImport?.content_hash, validationImport?.row_count, "b".repeat(64)],
      );
    }
    const preservedBefore = await Promise.all(preservedTablesForMode("tmt-v2-only").map(async (table) => {
      const [rows] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM \`${table}\``);
      return [table, Number(rows[0]?.total)] as const;
    }));
    const tmtDry = await runPhase7Reset({ mode: "tmt-v2-only", execute: false, backupReference: "local-fixture-backup" }, tmtOnlyStore);
    assert.equal(tmtDry.executed, false);
    const [tmtBefore] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS total FROM tmt_sync_runs");
    assert.ok(Number(tmtBefore[0]?.total) > 0);
    const tmtDone = await runPhase7Reset({ mode: "tmt-v2-only", execute: true, backupReference: "local-fixture-backup" }, tmtOnlyStore);
    assert.equal(tmtDone.executed, true);
    assert.ok(Object.values(tmtDone.after ?? {}).every((count) => count === 0));
    const [[validationsAfterReset]] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS total FROM tmt_run_validations");
    assert.equal(Number(validationsAfterReset?.total), 0, "TMT run deletion must cascade validation evidence");
    for (const [table, count] of preservedBefore) {
      const [rows] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM \`${table}\``);
      assert.equal(Number(rows[0]?.total), count, `${table} must be preserved by TMT-v2-only reset`);
    }

    const store = mysqlResetStore(pool, "full");
    const keepBefore = await Promise.all(["users", "facilities", "app_settings", "audit_logs", "schema_migrations"].map(async (table) => {
      const [rows] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM \`${table}\``); return [table, Number(rows[0]?.total)] as const;
    }));
    const dry = await runPhase7Reset({ mode: "full", execute: false, backupReference: "local-fixture-backup" }, store);
    assert.equal(dry.executed, false);
    const [legacyBefore] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS total FROM standard_imports");
    assert.ok(Number(legacyBefore[0]?.total) > 0);
    const done = await runPhase7Reset({ mode: "full", execute: true, backupReference: "local-fixture-backup" }, store);
    assert.equal(done.executed, true);
    assert.ok(Object.values(done.after ?? {}).every((count) => count === 0));
    for (const [table, count] of keepBefore) {
      const [rows] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM \`${table}\``);
      assert.equal(Number(rows[0]?.total), count, `${table} must be preserved`);
    }
    const [tables] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('standard_products','ttmt_products','tmt_gpu')");
    assert.equal(Number(tables[0]?.total), 3);
    const unverifiedRunId = randomUUID();
    await new TmtSyncRepository(pool).createRun({
      id: unverifiedRunId,
      version: "unverified:0123456789abcdef0123",
      mode: "full_unverified",
      startedAt: new Date("2026-11-10T00:00:00.000Z"),
    });
    const [unverified] = await pool.query<RowDataPacket[]>("SELECT mode,tmt_version,status FROM tmt_sync_runs WHERE id=?", [unverifiedRunId]);
    assert.deepEqual(unverified[0], { mode: "full_unverified", tmt_version: "unverified:0123456789abcdef0123", status: "running" });
    await assert.rejects(
      () => new TmtSyncRepository(pool).createRun({ id: randomUUID(), version: "20261110", mode: "full", startedAt: new Date() }),
      /unverified run exists.*reset/i,
    );
  });
});
