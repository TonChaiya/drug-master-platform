import assert from "node:assert/strict";
import { readdir, readFile, realpath } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { resolve, sep } from "node:path";
import mysql, { type RowDataPacket } from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { test, vi } from "vitest";
import { splitMigrationStatements } from "@/db/migration-0018-guard";
import { inspectTmtDataset, standardDatasetLifecycleStoresForPool } from "@/modules/standards/dataset-release-mysql";
import { prepareBaselineDataset } from "@/modules/standards/dataset-release";
import { acceptTmtCandidate, processTmtCandidateDelivery } from "@/modules/tmt/candidate-jobs";
import { activateTmtDataset } from "@/modules/tmt/candidate-lifecycle";
import { readTmtPointer } from "@/modules/tmt/candidate-pointer";
import { TMT_UNVERIFIED_REQUIRED_ENDPOINTS, type TmtSyncSource } from "@/modules/tmt/sync";
import { buildValidatedUnverifiedEvidence } from "@/modules/tmt/validation";
import { partitionHistoricalWindows, TMT_HISTORY_START } from "@/modules/tmt/windows";
import { searchTmt } from "@/modules/tmt/search";
import { loadMappedStandardsV2 } from "@/modules/mappings/v2-consumer";
import { readStandardDatasetSelection } from "@/modules/standards/dataset-selection";
import * as schema from "@/db/schema";

const database = "drug_master_tmt_candidate_test";
const datadir = process.env.TMT_CANDIDATE_DISPOSABLE_MYSQL_DATADIR;

test.skipIf(!datadir)("isolated MySQL: incremental candidate survives interrupted delivery, promotes and rolls back atomically", async () => {
  const expected = await realpath(datadir!);
  const temporaryRoot = await realpath(resolve(process.env.TEMP ?? ""));
  assert.ok(expected.toLowerCase().startsWith((temporaryRoot + sep + "dm-tmt-candidate-").toLowerCase()));
  const settings = { host: "127.0.0.1", port: 3308, user: "root", timezone: "Z", connectTimeout: 5000 };
  const connection = await mysql.createConnection(settings);
  let pool: ReturnType<typeof mysql.createPool> | undefined;
  try {
    const [[identity]] = await connection.query<RowDataPacket[]>("SELECT @@datadir AS datadir,@@port AS port,VERSION() AS version");
    assert.equal((await realpath(String(identity.datadir))).toLowerCase(), expected.toLowerCase());
    assert.equal(Number(identity.port), 3308);
    assert.match(String(identity.version), /^8\.4\.3\b/);
    const [existing] = await connection.query<RowDataPacket[]>("SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?", [database]);
    assert.equal(existing.length, 0);
    await connection.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    pool = mysql.createPool({ ...settings, database, connectionLimit: 4, supportBigNumbers: true, bigNumberStrings: true });
    const sql = pool;
    const folder = new URL("../src/db/migrations/", import.meta.url);
    const files = (await readdir(folder)).filter((name) => /^00[0-2][0-9]_.+\.sql$/.test(name)).sort().slice(0, 21);
    assert.equal(files.at(-1), "0021_tmt_candidate_operations.sql");
    await sql.query("CREATE TABLE schema_migrations (filename VARCHAR(255) PRIMARY KEY,content_hash CHAR(64) NOT NULL)");
    for (const file of files) {
      const source = await readFile(new URL(file, folder), "utf8");
      for (const statement of splitMigrationStatements(source)) await sql.query(statement);
      await sql.execute("INSERT INTO schema_migrations VALUES (?,?)", [file, createHash("sha256").update(source).digest("hex")]);
    }

    const base = randomUUID(), candidate = randomUUID(), actor = randomUUID();
    const version = "20261128";
    await sql.execute("INSERT INTO users (id,username,username_normalized,full_name,position_name,password_hash,role,status) VALUES (?,'phase3-test','phase3-test','fixture','fixture','no-login','admin','active')", [actor]);
    const historicalRun = randomUUID();
    const marker = "unverified:" + historicalRun.replaceAll("-", "").slice(0, 20);
    await sql.execute("INSERT INTO tmt_sync_runs (id,tmt_version,mode,status,error_code,started_at,finished_at) VALUES (?,?,'full_unverified','unverified','TMT_VERSION_UNVERIFIED',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [historicalRun, marker]);
    const checkpoints = [...TMT_UNVERIFIED_REQUIRED_ENDPOINTS, "imagelist"].flatMap((endpoint) =>
      partitionHistoricalWindows(TMT_HISTORY_START, "2026-11-25").map((window) => ({
        endpoint, status: "succeeded", windowBegin: window.begindate, windowEnd: window.enddate, receivedRows: 1, writtenRows: 1,
      })));
    for (const checkpoint of checkpoints) await sql.execute(
      "INSERT INTO tmt_sync_checkpoints (run_id,endpoint,window_begin,window_end,status,received_rows,written_rows) VALUES (?,?,?,?,'succeeded',1,1)",
      [historicalRun, checkpoint.endpoint, checkpoint.windowBegin, checkpoint.windowEnd],
    );
    const evidence = buildValidatedUnverifiedEvidence({
      run: { id: historicalRun, mode: "full_unverified", status: "unverified", errorCode: "TMT_VERSION_UNVERIFIED", tmtVersion: marker },
      checkpoints,
      blockingInvariants: { missingConceptCounterparts: 0, missingEndpointCounterparts: 0, levelMismatch: 0, masterTmtMissingTpu: 0, masterTmtMissingConcept: 0, tpuMissingMasterTmt: 0, unknownLevels: 0, duplicateRelationshipPairs: 0, unknownMasterStatuses: 0 },
      gpu: { code: "764169", level: "gpu", outboundTpu: 1, relatedTpuPresent: 1, relatedMasterTmtPresent: 1, relatedConceptPresent: 1, activeMasterCount: 1 },
    }, new Date("2026-11-25T04:00:00Z"));
    await sql.execute(
      "INSERT INTO tmt_run_validations (run_id,policy_version,status,validated_at,required_checkpoint_count,required_succeeded_count,optional_failure_count,blocking_invariant_count,invariant_evidence,gpu_764169_passed,evidence_sha256) VALUES (?,?,?,?,?,?,?,?,?,1,?)",
      [historicalRun, evidence.policyVersion, evidence.status, evidence.validatedAt, evidence.requiredCheckpointCount, evidence.requiredSucceededCount, evidence.optionalFailureCount, evidence.blockingInvariantCount, evidence.invariantEvidence, evidence.evidenceSha256],
    );
    await sql.execute("INSERT INTO tmt_gpu (gpuid,fsn,change_date,source_version,last_seen_version,synced_at) VALUES (764169,'gpu','2026-11-01',?,?,UTC_TIMESTAMP(3))", [marker, marker]);
    await sql.execute("INSERT INTO tmt_tpu (tpuid,fsn,manufacturer,change_date,source_version,last_seen_version,synced_at) VALUES (9000001,'old tpu','sample','2026-11-01',?,?,UTC_TIMESTAMP(3))", [marker, marker]);
    await sql.execute("INSERT INTO tmt_concept (tmtid,fsn,change_date,level_name,source_version,last_seen_version,synced_at) VALUES (764169,'gpu','2026-11-01','gpu',?,?,UTC_TIMESTAMP(3)),(9000001,'old tpu','2026-11-01','tpu',?,?,UTC_TIMESTAMP(3))", [marker, marker, marker, marker]);
    await sql.execute("INSERT INTO tmt_relationship (concept1,concept2,change_date,level_name1,level_name2,source_version,last_seen_version,synced_at) VALUES (764169,9000001,'2026-11-01','gpu','tpu',?,?,UTC_TIMESTAMP(3))", [marker, marker]);
    await sql.execute("INSERT INTO tmt_mastertmt (tpucode,fsn,status,source_version,last_seen_version,synced_at) VALUES (9000001,'old commercial product',0,?,?,UTC_TIMESTAMP(3))", [marker, marker]);
    const manifest = await prepareBaselineDataset({ datasetId: base, source: "TMT", sourceVersion: marker, tmtSyncRunId: historicalRun, batchSize: 1000 }, standardDatasetLifecycleStoresForPool(sql).baseline);
    const bootstrapped = await activateTmtDataset(sql, { actor, datasetId: base, generation: 0, action: "bootstrap" });
    assert.equal(bootstrapped.assurance, "validated_unverified");
    assert.equal((await readTmtPointer(sql)).coverageThrough, "2026-11-25");

    const source = {
      version: async () => version,
      fetch: async (endpoint: string) => endpoint === "tpu" ? [{ tpuid: "9000001", fsn: "new tpu", manufacturer: "sample", changeDate: "2026-11-28" }] : [],
      resetAuthentication: async () => {},
    } as unknown as TmtSyncSource;
    const received: string[] = [];
    const queue = async (id: string) => { received.push(id); };
    await acceptTmtCandidate(sql, { id: candidate, actor, mode: "incremental" }, source, queue, new Date("2026-11-28T04:00:00Z"));
    assert.deepEqual(received, [candidate]);
    const id = received.shift()!;
    await assert.rejects(processTmtCandidateDelivery(sql, id, source, async () => { throw new Error("queue handoff interruption"); }), /handoff interruption/);
    assert.equal((await readTmtPointer(sql)).datasetId, base);
    received.push(id);
    for (let i = 0; received.length > 0 && i < 80; i += 1) {
      await processTmtCandidateDelivery(sql, received.shift()!, source, queue);
      assert.equal((await readTmtPointer(sql)).datasetId, base);
    }
    assert.deepEqual(received, []);
    const [[job]] = await sql.execute<RowDataPacket[]>("SELECT status,received_rows,written_rows FROM tmt_candidate_jobs WHERE dataset_id=?", [candidate]);
    assert.equal(job.status, "validated");
    assert.equal(Number(job.received_rows), 1);
    assert.equal(Number(job.written_rows), 1);
    const [saved] = await sql.execute<RowDataPacket[]>("SELECT dataset_id,fsn FROM tmt_dataset_tpu WHERE dataset_id IN (?,?)", [base, candidate]);
    assert.deepEqual(new Map(saved.map((row) => [row.dataset_id, row.fsn])), new Map([[base, "old tpu"], [candidate, "new tpu"]]));
    assert.equal((await inspectTmtDataset(sql, base)).contentHash, manifest.contentHash);
    const [[unchanged]] = await sql.execute<RowDataPacket[]>("SELECT fsn FROM tmt_dataset_mastertmt WHERE dataset_id=? AND tpucode=9000001", [candidate]);
    assert.equal(unchanged.fsn, "old commercial product");
    await assert.rejects(activateTmtDataset(sql, { actor, datasetId: candidate, generation: 0, action: "promote", observedVersion: version }), /ACTIVE_DATASET_CHANGED/);
    const promoted = await activateTmtDataset(sql, { actor, datasetId: candidate, generation: 1, action: "promote", observedVersion: version });
    assert.equal(promoted.assurance, "validated_unverified");
    assert.equal((await readTmtPointer(sql)).datasetId, candidate);
    vi.stubEnv("TMT_INDEPENDENT_DATASET_ENABLED", "1");
    vi.stubEnv("ACTIVE_STANDARD_RELEASE_ENABLED", "0");
    const selection = await readStandardDatasetSelection(sql);
    const [tpu] = await searchTmt(sql, { tmtId: "9000001" }, selection);
    assert.equal(tpu?.tmtId, "9000001");
    const importId = randomUUID();
    await sql.execute("INSERT INTO ttmt_imports (id,version,filename,content_hash,status,started_at) VALUES (?,'fixture','fixture.xls',?,'succeeded',UTC_TIMESTAMP(3))", [importId, "a".repeat(64)]);
    await sql.execute("INSERT INTO ttmt_products (ttmtcode,fsn,status,source_version,source_import_id) VALUES ('9000001','independent TTMT','active','fixture',?)", [importId]);
    const mapped = await loadMappedStandardsV2([
      { source: "TMT", code: "9000001", level: "tpu", productCat: "1" },
      { source: "TTMT", code: "9000001", level: "product", productCat: "3" },
    ], drizzle(sql, { schema, mode: "default" }), selection);
    assert.equal(mapped.size, 2);
    assert.ok([...mapped.values()].every((item) => item.eligible));
    const rolledBack = await activateTmtDataset(sql, { actor, datasetId: base, generation: 2, action: "rollback" });
    assert.equal(rolledBack.generation, 3);
    assert.equal((await readTmtPointer(sql)).datasetId, base);
    const [audit] = await sql.query<RowDataPacket[]>("SELECT action FROM audit_logs");
    assert.deepEqual(new Set(audit.map((row) => row.action)), new Set(["tmt.dataset_bootstrap", "tmt.candidate_queued", "tmt.candidate_validated", "tmt.dataset_promote", "tmt.dataset_rollback"]));

    const full = randomUUID();
    const fullSource = {
      ...source,
      async fetch(endpoint: string, window: { enddate: string }) {
        if (window.enddate !== "2026-11-28") return [];
        const changeDate = window.enddate;
        if (endpoint === "concept") return [
          { tmtid: "764169", fsn: "gpu", levelName: "gpu", changeDate },
          { tmtid: "9000001", fsn: "full tpu", levelName: "tpu", changeDate },
        ];
        if (endpoint === "gpu") return [{ gpuid: "764169", fsn: "gpu", changeDate }];
        if (endpoint === "tpu") return [{ tpuid: "9000001", fsn: "full tpu", manufacturer: "sample", changeDate }];
        if (endpoint === "relationship") return [{ concept1: "764169", concept2: "9000001", levelName1: "gpu", levelName2: "tpu", changeDate }];
        if (endpoint === "mastertmt") return [{ tpucode: "9000001", fsn: "full commercial product", manufacturer: "sample", status: 0,
          activeingredient: null, strength: null, dosageform: null, contvalue: null, contunit: null, dispunit: null, tradename: null }];
        return [];
      },
    } as unknown as TmtSyncSource;
    await acceptTmtCandidate(sql, { id: full, actor, mode: "full" }, fullSource, queue, new Date("2026-11-28T04:00:00Z"));
    for (let i = 0; received.length > 0 && i < 500; i += 1) await processTmtCandidateDelivery(sql, received.shift()!, fullSource, queue);
    assert.deepEqual(received, []);
    const [[fullJob]] = await sql.execute<RowDataPacket[]>("SELECT status,next_step FROM tmt_candidate_jobs WHERE dataset_id=?", [full]);
    assert.equal(fullJob.status, "validated");
    assert.ok(Number(fullJob.next_step) > 100);
    assert.equal((await readTmtPointer(sql)).datasetId, base);
    const fullPromotion = await activateTmtDataset(sql, { actor, datasetId: full, generation: 3, action: "promote", observedVersion: version });
    assert.equal(fullPromotion.assurance, "verified");
    const [[live]] = await sql.query<RowDataPacket[]>("SELECT fsn FROM tmt_tpu WHERE tpuid=9000001");
    assert.equal(live.fsn, "old tpu");
    const [[historicalEvidence]] = await sql.execute<RowDataPacket[]>("SELECT evidence_sha256 FROM tmt_run_validations WHERE run_id=?", [historicalRun]);
    assert.equal(historicalEvidence.evidence_sha256, evidence.evidenceSha256);
  } finally {
    vi.unstubAllEnvs();
    await pool?.end();
    await connection.end();
  }
}, 90_000);
