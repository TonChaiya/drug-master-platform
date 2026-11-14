import assert from "node:assert/strict";
import mysql, { type Connection, type Pool, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, test } from "vitest";
import {
  approveStandardRelease,
  DatasetReleaseError,
  prepareBaselineDataset,
  prepareStandardReleaseCandidate,
  publishStandardRelease,
  rollbackStandardRelease,
} from "@/modules/standards/dataset-release";
import { manifestRowsMatchDataset, standardDatasetLifecycleStoresForPool } from "@/modules/standards/dataset-release-mysql";
import { ACTIVE_STANDARD_RELEASE_POINTER_KEY } from "@/modules/standards/active-release";
import { APPROVED_TTMT_V1, buildValidatedUnverifiedEvidence } from "@/modules/tmt/validation";
import { TMT_UNVERIFIED_REQUIRED_ENDPOINTS } from "@/modules/tmt/sync";
import {
  cleanupPhase2dTestDatabase,
  createPhase2dTestDatabase,
  applyPhase2dMigration0018,
  migratePhase2dDatabaseThrough0017,
  phase2dTestConfig,
  type Phase2dHarnessConnection,
  type Phase2dHarnessSession,
  type Phase2dTestConfig,
} from "./helpers/phase-2d-mysql-harness";

const enabled = process.env.ALLOW_DB_INTEGRATION_TESTS === "1";
const ids = {
  runA: "20000000-0000-4000-8000-000000000001",
  runB: "20000000-0000-4000-8000-000000000002",
  runC: "20000000-0000-4000-8000-000000000003",
  runRegno: "20000000-0000-4000-8000-000000000004",
  import: "20000000-0000-4000-8000-000000000010",
  tmtA: "20000000-0000-4000-8000-000000000011",
  tmtB: "20000000-0000-4000-8000-000000000012",
  tmtC: "20000000-0000-4000-8000-000000000013",
  ttmt: "20000000-0000-4000-8000-000000000014",
  tmtRegno: "20000000-0000-4000-8000-000000000015",
  releaseA: "20000000-0000-4000-8000-000000000021",
  releaseB: "20000000-0000-4000-8000-000000000022",
  releaseRegno: "20000000-0000-4000-8000-000000000023",
} as const;

function marker(runId: string): string {
  return `unverified:${runId.replaceAll("-", "").slice(0, 20)}`;
}

function releaseErrorCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof DatasetReleaseError && error.code === code;
}

describe.runIf(enabled).sequential("Phase 2D release lifecycle on an isolated Laragon MySQL", () => {
  let server: Connection;
  let pool: Pool;
  let session: Phase2dHarnessSession | undefined;
  let migrations: string[] = [];
  let journalBefore0018: string[] = [];
  let config: Phase2dTestConfig;

  beforeAll(async () => {
    config = phase2dTestConfig();
    server = await mysql.createConnection({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      multipleStatements: true,
    });
    session = await createPhase2dTestDatabase(server as unknown as Phase2dHarnessConnection, config);
    migrations = await migratePhase2dDatabaseThrough0017(server as unknown as Phase2dHarnessConnection);
    const [beforeRows] = await server.execute<RowDataPacket[]>("SELECT filename FROM schema_migrations ORDER BY filename");
    journalBefore0018 = beforeRows.map((row) => String(row.filename));
    migrations.push(await applyPhase2dMigration0018(server as unknown as Phase2dHarnessConnection));
    pool = mysql.createPool({ ...config, timezone: "Z", connectionLimit: 6 });
    await seedLiveSources(server, ids.runA, ids.import);
  }, 30_000);

  afterAll(async () => {
    try {
      await pool?.end();
      if (server && session) {
        const verificationConnection = await mysql.createConnection({
          host: config.host,
          port: config.port,
          user: config.user,
          password: config.password,
        });
        try {
          await cleanupPhase2dTestDatabase(
            server as unknown as Phase2dHarnessConnection,
            verificationConnection as unknown as Phase2dHarnessConnection,
            config,
            session,
          );
        } finally {
          await verificationConnection.end();
        }
      }
    } finally {
      await server?.end();
    }
  });

  test("applies exactly migration chain 0001-0018", () => {
    assert.equal(journalBefore0018.length, 17);
    assert.equal(journalBefore0018.at(-1)?.startsWith("0017_"), true);
    assert.equal(journalBefore0018.some((filename) => filename.startsWith("0018_")), false);
    assert.equal(migrations.length, 18);
    assert.equal(migrations[0]?.startsWith("0001_"), true);
    assert.equal(migrations.at(-1), "0018_versioned_standard_dataset_foundation.sql");
  });

  test("migration 0018 exposes dataset metadata constraints and scoped composite keys", async () => {
    const [journal] = await server.execute<RowDataPacket[]>("SELECT filename,content_hash FROM schema_migrations ORDER BY filename");
    assert.equal(journal.length, 18);
    assert.equal(journal.at(-1)?.filename, "0018_versioned_standard_dataset_foundation.sql");
    assert.match(String(journal.at(-1)?.content_hash), /^[a-f0-9]{64}$/);
    const [constraints] = await server.execute<RowDataPacket[]>(
      `SELECT TABLE_NAME,CONSTRAINT_NAME,CONSTRAINT_TYPE FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
       WHERE TABLE_SCHEMA=? AND TABLE_NAME IN ('standard_datasets','standard_releases','standard_dataset_pointers','standard_dataset_manifests','tmt_dataset_concepts','ttmt_dataset_products')`,
      [config.database],
    );
    const keys = new Set(constraints.map((row) => `${row.TABLE_NAME}:${row.CONSTRAINT_NAME}:${row.CONSTRAINT_TYPE}`));
    assert.equal(keys.has("standard_datasets:PRIMARY:PRIMARY KEY"), true);
    assert.equal(keys.has("standard_releases:uq_standard_releases_datasets:UNIQUE"), true);
    assert.equal(keys.has("standard_dataset_pointers:fk_standard_dataset_pointers_release:FOREIGN KEY"), true);
    assert.equal(keys.has("standard_dataset_manifests:PRIMARY:PRIMARY KEY"), true);
    assert.equal(keys.has("tmt_dataset_concepts:PRIMARY:PRIMARY KEY"), true);
    assert.equal(keys.has("ttmt_dataset_products:PRIMARY:PRIMARY KEY"), true);
  });

  test("migration 0018 creates all explicit dataset keys, indexes and enforced dataset foreign keys", async () => {
    const shadowTables = [
      "tmt_dataset_subs", "tmt_dataset_vtm", "tmt_dataset_gp", "tmt_dataset_gpu", "tmt_dataset_gpp",
      "tmt_dataset_tp", "tmt_dataset_tpu", "tmt_dataset_tpp", "tmt_dataset_nlem", "tmt_dataset_atc",
      "tmt_dataset_regno", "tmt_dataset_mastertmt", "tmt_dataset_concepts", "tmt_dataset_relationships", "ttmt_dataset_products",
    ];
    const [primaryColumns] = await server.query<RowDataPacket[]>(
      `SELECT TABLE_NAME,COLUMN_NAME,SEQ_IN_INDEX FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA=? AND TABLE_NAME IN (?) AND INDEX_NAME='PRIMARY' ORDER BY TABLE_NAME,SEQ_IN_INDEX`,
      [config.database, shadowTables],
    );
    const primaryByTable = new Map<string, string[]>();
    for (const row of primaryColumns) {
      const table = String(row.TABLE_NAME);
      primaryByTable.set(table, [...(primaryByTable.get(table) ?? []), String(row.COLUMN_NAME)]);
    }
    assert.equal(primaryByTable.size, 15);
    for (const table of shadowTables) assert.equal(primaryByTable.get(table)?.[0], "dataset_id", table);

    const [datasetForeignKeys] = await server.query<RowDataPacket[]>(
      `SELECT TABLE_NAME,CONSTRAINT_NAME,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME
       FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA=? AND TABLE_NAME IN (?) AND COLUMN_NAME='dataset_id' AND REFERENCED_TABLE_NAME IS NOT NULL`,
      [config.database, shadowTables],
    );
    assert.equal(datasetForeignKeys.length, 15);
    assert.equal(datasetForeignKeys.every((row) => row.REFERENCED_TABLE_NAME === "standard_datasets" && row.REFERENCED_COLUMN_NAME === "id"), true);

    const datasetA = "20000000-0000-4000-8000-000000000031";
    const datasetB = "20000000-0000-4000-8000-000000000032";
    await server.execute(
      "INSERT INTO standard_datasets (id,source,state,source_version) VALUES (?,'TMT','writing','schema-test'),(?,'TMT','writing','schema-test')",
      [datasetA, datasetB],
    );
    const row = [123456, "schema contract", "2026-01-01", null, "schema-test", "schema-test", "2026-01-01 00:00:00"];
    await server.execute(
      "INSERT INTO tmt_dataset_subs (dataset_id,subsid,fsn,change_date,normalized_fsn,source_version,last_seen_version,synced_at) VALUES (?,?,?,?,?,?,?,?),(?,?,?,?,?,?,?,?)",
      [datasetA, ...row, datasetB, ...row],
    );
    await assert.rejects(
      () => server.execute(
        "INSERT INTO tmt_dataset_subs (dataset_id,subsid,fsn,change_date,normalized_fsn,source_version,last_seen_version,synced_at) VALUES (?,?,?,?,?,?,?,?)",
        [datasetA, ...row],
      ),
      (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "ER_DUP_ENTRY",
    );
    await assert.rejects(
      () => server.execute(
        "INSERT INTO tmt_dataset_subs (dataset_id,subsid,fsn,change_date,normalized_fsn,source_version,last_seen_version,synced_at) VALUES (?,?,?,?,?,?,?,?)",
        ["20000000-0000-4000-8000-000000000039", 999999, ...row.slice(1)],
      ),
      (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "ER_NO_REFERENCED_ROW_2",
    );
  });

  test("supports bounded concurrent resume and makes a validated dataset immutable", async () => {
    const { baseline } = standardDatasetLifecycleStoresForPool(pool);
    const source = await baseline.inspectLiveSource("TMT", 100);
    await baseline.createCandidate({
      datasetId: ids.tmtA,
      source: "TMT",
      sourceVersion: marker(ids.runA),
      contentHash: source.contentHash,
      tmtSyncRunId: ids.runA,
      ttmtImportId: null,
    });

    const batches = await Promise.all([
      baseline.copyNextBatch({ datasetId: ids.tmtA, source: "TMT", batchSize: 1 }),
      baseline.copyNextBatch({ datasetId: ids.tmtA, source: "TMT", batchSize: 1 }),
    ]);
    assert.deepEqual(batches.map((batch) => batch.copiedRows), [1, 1]);
    await prepareBaselineDataset({
      datasetId: ids.tmtA,
      source: "TMT",
      sourceVersion: marker(ids.runA),
      tmtSyncRunId: ids.runA,
      batchSize: 1,
    }, baseline);
    await prepareBaselineDataset({
      datasetId: ids.ttmt,
      source: "TTMT",
      sourceVersion: APPROVED_TTMT_V1.version,
      ttmtImportId: ids.import,
      batchSize: 500,
    }, baseline);

    const tmtInspection = await baseline.inspectVersionedDataset(ids.tmtA, "TMT", 500);
    const repeatInspection = await baseline.inspectVersionedDataset(ids.tmtA, "TMT", 500);
    assert.deepEqual(repeatInspection, tmtInspection, "versioned manifests must be deterministic");
    const [manifests] = await server.execute<RowDataPacket[]>(
      "SELECT dataset_id,table_name,row_count,content_hash FROM standard_dataset_manifests WHERE dataset_id IN (?,?) ORDER BY dataset_id,table_name",
      [ids.tmtA, ids.ttmt],
    );
    assert.equal(manifests.filter((row) => row.dataset_id === ids.tmtA).length, 14);
    assert.equal(manifests.filter((row) => row.dataset_id === ids.ttmt).length, 1);
    assert.equal(manifests.every((row) => /^[a-f0-9]{64}$/.test(String(row.content_hash))), true);

    await assert.rejects(
      () => baseline.copyNextBatch({ datasetId: ids.tmtA, source: "TMT", batchSize: 1 }),
      releaseErrorCode("BASELINE_IMMUTABLE"),
    );
  }, 60_000);

  test("rejects a RegNo conflict only after validating its deterministic manifest", async () => {
    await ensureValidatedPrimaryDatasets(pool);
    await cloneValidatedTmtDataset(server, pool, ids.runA, ids.runRegno, ids.tmtA, ids.tmtRegno, ids.import, true);
    const { baseline, releases } = standardDatasetLifecycleStoresForPool(pool);
    const inspection = await baseline.inspectVersionedDataset(ids.tmtRegno, "TMT", 500);
    const [[dataset]] = await server.execute<RowDataPacket[]>(
      "SELECT content_hash FROM standard_datasets WHERE id=?",
      [ids.tmtRegno],
    );
    const [storedRows] = await server.execute<RowDataPacket[]>(
      "SELECT dataset_id,table_name,row_count,content_hash FROM standard_dataset_manifests WHERE dataset_id=? ORDER BY table_name",
      [ids.tmtRegno],
    );
    const stored = storedRows.map((row) => ({
      datasetId: String(row.dataset_id),
      tableName: String(row.table_name),
      rowCount: Number(row.row_count),
      contentHash: String(row.content_hash),
    }));
    assert.equal(manifestRowsMatchDataset(stored, ids.tmtRegno, inspection, String(dataset?.content_hash)), true);
    await assert.rejects(
      () => prepareStandardReleaseCandidate({ releaseId: ids.releaseRegno, tmtDatasetId: ids.tmtRegno, ttmtDatasetId: ids.ttmt }, releases),
      releaseErrorCode("REGNO_CONFLICT"),
    );
  }, 30_000);

  test("rejects inconsistent persisted evidence before release approval", async () => {
    await ensureValidatedPrimaryDatasets(pool);
    const { releases } = standardDatasetLifecycleStoresForPool(pool);
    await server.execute("UPDATE tmt_run_validations SET required_succeeded_count=0 WHERE run_id=?", [ids.runA]);
    try {
      await assert.rejects(
        () => prepareStandardReleaseCandidate({ releaseId: ids.releaseA, tmtDatasetId: ids.tmtA, ttmtDatasetId: ids.ttmt }, releases),
        releaseErrorCode("VALIDATION_EVIDENCE_INVALID"),
      );
    } finally {
      await server.execute("UPDATE tmt_run_validations SET required_succeeded_count=required_checkpoint_count WHERE run_id=?", [ids.runA]);
    }
  }, 30_000);

  test("requires explicit candidate validation before approving release A", async () => {
    await ensureValidatedPrimaryDatasets(pool);
    const { releases } = standardDatasetLifecycleStoresForPool(pool);
    await prepareStandardReleaseCandidate({ releaseId: ids.releaseA, tmtDatasetId: ids.tmtA, ttmtDatasetId: ids.ttmt }, releases);
    const [[candidate]] = await server.execute<RowDataPacket[]>("SELECT state FROM standard_releases WHERE id=?", [ids.releaseA]);
    assert.equal(candidate?.state, "candidate");
    await approveStandardRelease({ releaseId: ids.releaseA }, releases);
    const [[approved]] = await server.execute<RowDataPacket[]>("SELECT state FROM standard_releases WHERE id=?", [ids.releaseA]);
    assert.equal(approved?.state, "approved");
  }, 30_000);

  test("serializes concurrent publish and performs pointer-only rollback under the shared lock", async () => {
    await ensureApprovedReleaseA(server, pool);
    await cloneValidatedTmtDataset(server, pool, ids.runA, ids.runB, ids.tmtA, ids.tmtB, ids.import);
    const { releases } = standardDatasetLifecycleStoresForPool(pool);
    await prepareStandardReleaseCandidate({ releaseId: ids.releaseB, tmtDatasetId: ids.tmtB, ttmtDatasetId: ids.ttmt }, releases);
    await approveStandardRelease({ releaseId: ids.releaseB }, releases);
    await publishStandardRelease({ releaseId: ids.releaseA, expectedActiveReleaseId: null }, releases);
    await assertPointerRowLockBlocks(pool, ids.releaseA);

    const concurrent = await Promise.allSettled([
      publishStandardRelease({ releaseId: ids.releaseB, expectedActiveReleaseId: ids.releaseA }, releases),
      publishStandardRelease({ releaseId: ids.releaseB, expectedActiveReleaseId: ids.releaseA }, releases),
    ]);
    assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(concurrent.filter((result) => result.status === "rejected").length, 1);

    const [[before]] = await server.execute<RowDataPacket[]>(
      "SELECT (SELECT COUNT(*) FROM tmt_dataset_concepts) AS tmt_rows,(SELECT COUNT(*) FROM ttmt_dataset_products) AS ttmt_rows",
    );
    await rollbackStandardRelease({ releaseId: ids.releaseA, expectedActiveReleaseId: ids.releaseB }, releases);
    const [[after]] = await server.execute<RowDataPacket[]>(
      "SELECT (SELECT COUNT(*) FROM tmt_dataset_concepts) AS tmt_rows,(SELECT COUNT(*) FROM ttmt_dataset_products) AS ttmt_rows",
    );
    const [[pointer]] = await server.execute<RowDataPacket[]>(
      "SELECT active_release_id FROM standard_dataset_pointers WHERE pointer_key='active-standard-release'",
    );
    assert.equal(pointer?.active_release_id, ids.releaseA);
    assert.deepEqual(after, before);
    const [audits] = await server.execute<RowDataPacket[]>(
      "SELECT action,entity_id FROM audit_logs WHERE entity_id IN (?,?) ORDER BY created_at,action",
      [ids.releaseA, ids.releaseB],
    );
    const actions = new Set(audits.map((row) => `${row.entity_id}:${row.action}`));
    assert.equal(actions.has(`${ids.releaseA}:standard_release.candidate_validated`), true);
    assert.equal(actions.has(`${ids.releaseA}:standard_release.approved`), true);
    assert.equal(actions.has(`${ids.releaseA}:standard_release.published`), true);
    assert.equal(actions.has(`${ids.releaseA}:standard_release.rolled_back`), true);
    assert.equal(actions.has(`${ids.releaseB}:standard_release.published`), true);
  }, 30_000);

  test("detects a live-source mutation and fails the candidate without publishing it", async () => {
    await seedRunAndEvidence(server, ids.runC, ids.import);
    const version = marker(ids.runC);
    for (const table of ["tmt_concept", "tmt_gpu", "tmt_tpu", "tmt_mastertmt", "tmt_relationship"]) {
      const lastSeen = table === "tmt_mastertmt" || table === "tmt_relationship" || table === "tmt_concept" || table === "tmt_gpu" || table === "tmt_tpu"
        ? ",last_seen_version=?"
        : "";
      await server.execute(`UPDATE ${table} SET source_version=?${lastSeen}`, lastSeen ? [version, version] : [version]);
    }
    const base = standardDatasetLifecycleStoresForPool(pool).baseline;
    let copied = false;
    const mutating = {
      ...base,
      async copyNextBatch(input: Parameters<typeof base.copyNextBatch>[0]) {
        const result = await base.copyNextBatch(input);
        if (!copied) {
          copied = true;
          await server.execute(
            "INSERT INTO tmt_concept (tmtid,fsn,change_date,level_name,source_version,last_seen_version,synced_at) VALUES (9999999,'mutated source','2026-11-13','subs',?,?,NOW(3))",
            [version, version],
          );
        }
        return result;
      },
    };
    await assert.rejects(
      () => prepareBaselineDataset({ datasetId: ids.tmtC, source: "TMT", sourceVersion: version, tmtSyncRunId: ids.runC, batchSize: 1 }, mutating),
      /source changed/i,
    );
    const [[candidate]] = await server.execute<RowDataPacket[]>("SELECT state FROM standard_datasets WHERE id=?", [ids.tmtC]);
    assert.equal(candidate?.state, "failed");
  }, 30_000);
});

async function assertPointerRowLockBlocks(pool: Pool, activeReleaseId: string): Promise<void> {
  const owner = await pool.getConnection();
  const contender = await pool.getConnection();
  let signalStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => { signalStarted = resolve; });
  try {
    await owner.beginTransaction();
    await owner.execute(
      "SELECT active_release_id FROM standard_dataset_pointers WHERE pointer_key=? FOR UPDATE",
      [ACTIVE_STANDARD_RELEASE_POINTER_KEY],
    );
    await contender.execute("SET SESSION innodb_lock_wait_timeout=1");
    const blockedUpdate = (() => {
      const pending = contender.execute(
        "UPDATE standard_dataset_pointers SET active_release_id=? WHERE pointer_key=?",
        [activeReleaseId, ACTIVE_STANDARD_RELEASE_POINTER_KEY],
      );
      signalStarted?.();
      return pending;
    })();
    await started;
    await assert.rejects(blockedUpdate, (error: unknown) => (
      typeof error === "object" && error !== null && "code" in error && error.code === "ER_LOCK_WAIT_TIMEOUT"
    ));
  } finally {
    try {
      await owner.rollback();
    } finally {
      owner.release();
      contender.release();
    }
  }
}

async function seedLiveSources(connection: Connection, runId: string, importId: string): Promise<void> {
  await seedRunAndEvidence(connection, runId, importId, false);
  const version = marker(runId);
  await connection.execute(
    "INSERT INTO tmt_concept (tmtid,fsn,change_date,level_name,source_version,last_seen_version,synced_at) VALUES (764169,'synthetic GPU','2026-11-13','gpu',?,?,NOW(3)),(9000001,'synthetic TPU','2026-11-13','tpu',?,?,NOW(3))",
    [version, version, version, version],
  );
  await connection.execute("INSERT INTO tmt_gpu (gpuid,fsn,change_date,source_version,last_seen_version,synced_at) VALUES (764169,'synthetic GPU','2026-11-13',?,?,NOW(3))", [version, version]);
  await connection.execute("INSERT INTO tmt_tpu (tpuid,fsn,manufacturer,change_date,source_version,last_seen_version,synced_at) VALUES (9000001,'synthetic TPU','synthetic','2026-11-13',?,?,NOW(3))", [version, version]);
  await connection.execute("INSERT INTO tmt_mastertmt (tpucode,fsn,status,source_version,last_seen_version,synced_at) VALUES (9000001,'synthetic TPU',0,?,?,NOW(3))", [version, version]);
  await connection.execute("INSERT INTO tmt_relationship (concept1,concept2,change_date,level_name1,level_name2,source_version,last_seen_version,synced_at) VALUES (764169,9000001,'2026-11-13','gpu','tpu',?,?,NOW(3))", [version, version]);

  await connection.execute(
    "INSERT INTO ttmt_imports (id,version,filename,content_hash,row_count,status,started_at,completed_at) VALUES (?,?,?,?,?,'succeeded',NOW(3),NOW(3))",
    [importId, APPROVED_TTMT_V1.version, "synthetic.xlsx", APPROVED_TTMT_V1.contentHash, APPROVED_TTMT_V1.rowCount],
  );
  await connection.query(
    `INSERT INTO ttmt_products (ttmtcode,fsn,status,source_version,source_import_id)
     SELECT CONCAT('SYN-',LPAD(n,4,'0')),'synthetic TTMT','active',?,? FROM (
       SELECT ones.n + tens.n*10 + hundreds.n*100 + thousands.n*1000 AS n
       FROM (SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) ones
       CROSS JOIN (SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) tens
       CROSS JOIN (SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) hundreds
       CROSS JOIN (SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) thousands
     ) numbers WHERE n < ?`,
    [APPROVED_TTMT_V1.version, importId, APPROVED_TTMT_V1.rowCount],
  );
  await seedRunAndEvidence(connection, runId, importId, true);
}

async function ensureValidatedPrimaryDatasets(pool: Pool): Promise<void> {
  const { baseline } = standardDatasetLifecycleStoresForPool(pool);
  await prepareBaselineDataset({
    datasetId: ids.tmtA,
    source: "TMT",
    sourceVersion: marker(ids.runA),
    tmtSyncRunId: ids.runA,
    batchSize: 1,
  }, baseline);
  await prepareBaselineDataset({
    datasetId: ids.ttmt,
    source: "TTMT",
    sourceVersion: APPROVED_TTMT_V1.version,
    ttmtImportId: ids.import,
    batchSize: 500,
  }, baseline);
}

async function ensureApprovedReleaseA(connection: Connection, pool: Pool): Promise<void> {
  await ensureValidatedPrimaryDatasets(pool);
  const { releases } = standardDatasetLifecycleStoresForPool(pool);
  const [[existing]] = await connection.execute<RowDataPacket[]>("SELECT state FROM standard_releases WHERE id=?", [ids.releaseA]);
  if (!existing) {
    await prepareStandardReleaseCandidate({ releaseId: ids.releaseA, tmtDatasetId: ids.tmtA, ttmtDatasetId: ids.ttmt }, releases);
    await approveStandardRelease({ releaseId: ids.releaseA }, releases);
    return;
  }
  if (existing.state === "candidate") await approveStandardRelease({ releaseId: ids.releaseA }, releases);
}

async function seedRunAndEvidence(connection: Connection, runId: string, importId: string, saveEvidence = true): Promise<void> {
  const version = marker(runId);
  await connection.execute(
    "INSERT IGNORE INTO tmt_sync_runs (id,tmt_version,mode,status,error_code,started_at,finished_at) VALUES (?,?,'full_unverified','unverified','TMT_VERSION_UNVERIFIED',NOW(3),NOW(3))",
    [runId, version],
  );
  const checkpoints = [...TMT_UNVERIFIED_REQUIRED_ENDPOINTS, "imagelist"].map((endpoint) => ({
    endpoint,
    status: "succeeded",
    windowBegin: "2026-11-01",
    windowEnd: "2026-11-13",
    receivedRows: 1,
    writtenRows: 1,
  }));
  for (const checkpoint of checkpoints) {
    await connection.execute(
      "INSERT IGNORE INTO tmt_sync_checkpoints (run_id,endpoint,window_begin,window_end,status,received_rows,written_rows) VALUES (?,?,?,?,'succeeded',1,1)",
      [runId, checkpoint.endpoint, checkpoint.windowBegin, checkpoint.windowEnd],
    );
  }
  if (!saveEvidence) return;
  const evidence = buildValidatedUnverifiedEvidence({
    run: { id: runId, mode: "full_unverified", status: "unverified", errorCode: "TMT_VERSION_UNVERIFIED", tmtVersion: version },
    checkpoints,
    blockingInvariants: { missingConceptCounterparts: 0, missingEndpointCounterparts: 0, levelMismatch: 0, masterTmtMissingTpu: 0, masterTmtMissingConcept: 0, tpuMissingMasterTmt: 0, unknownLevels: 0, duplicateRelationshipPairs: 0, unknownMasterStatuses: 0 },
    gpu: { code: "764169", level: "gpu", outboundTpu: 1, relatedTpuPresent: 1, relatedMasterTmtPresent: 1, relatedConceptPresent: 1, activeMasterCount: 1 },
    ttmt: { id: importId, version: APPROVED_TTMT_V1.version, contentHash: APPROVED_TTMT_V1.contentHash, rowCount: APPROVED_TTMT_V1.rowCount, status: "succeeded", productCount: APPROVED_TTMT_V1.rowCount, activeCount: APPROVED_TTMT_V1.rowCount, inactiveCount: 0, foreignProductCount: 0 },
  }, new Date("2026-11-13T00:00:00.000Z"));
  await connection.execute(
    `INSERT INTO tmt_run_validations
      (run_id,policy_version,status,validated_at,required_checkpoint_count,required_succeeded_count,optional_failure_count,blocking_invariant_count,invariant_evidence,gpu_764169_passed,ttmt_import_id,ttmt_content_hash,ttmt_row_count,evidence_sha256)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [evidence.runId, evidence.policyVersion, evidence.status, evidence.validatedAt, evidence.requiredCheckpointCount, evidence.requiredSucceededCount, evidence.optionalFailureCount, evidence.blockingInvariantCount, evidence.invariantEvidence, 1, evidence.ttmtImportId, evidence.ttmtContentHash, evidence.ttmtRowCount, evidence.evidenceSha256],
  );
}

async function cloneValidatedTmtDataset(
  connection: Connection,
  pool: Pool,
  sourceRunId: string,
  targetRunId: string,
  sourceDatasetId: string,
  targetDatasetId: string,
  importId: string,
  withRegNoConflict = false,
): Promise<void> {
  await seedRunAndEvidence(connection, targetRunId, importId);
  const version = marker(targetRunId);
  await connection.execute(
    "INSERT INTO standard_datasets (id,source,state,source_version,tmt_sync_run_id) VALUES (?,'TMT','writing',?,?)",
    [targetDatasetId, version, targetRunId],
  );
  const tables = [
    ["tmt_dataset_concepts", "tmtid,fsn,change_date,level_name,normalized_fsn", "created_at,updated_at"],
    ["tmt_dataset_gpu", "gpuid,fsn,change_date,normalized_fsn", "created_at,updated_at"],
    ["tmt_dataset_tpu", "tpuid,fsn,manufacturer,change_date,normalized_fsn,normalized_manufacturer", "created_at,updated_at"],
    ["tmt_dataset_mastertmt", "tpucode,activeingredient,strength,dosageform,contvalue,contunit,dispunit,tradename,manufacturer,fsn,status,normalized_generic,normalized_trade,normalized_manufacturer,normalized_fsn", "created_at,updated_at"],
    ["tmt_dataset_relationships", "concept1,concept2,change_date,level_name1,level_name2", "created_at,updated_at"],
  ] as const;
  for (const [table, columns, timestamps] of tables) {
    await connection.execute(
      `INSERT INTO ${table} (dataset_id,${columns},source_version,last_seen_version,synced_at,${timestamps}) SELECT ?,${columns},?,?,synced_at,${timestamps} FROM ${table} WHERE dataset_id=?`,
      [targetDatasetId, version, version, sourceDatasetId],
    );
  }
  if (withRegNoConflict) {
    await connection.execute(
      `INSERT INTO tmt_dataset_regno (dataset_id,tpuid,fsn,regno,normalized_regno,change_date,source_version,synced_at)
       VALUES (?,9000001,'synthetic TPU','REG-A','reg-a','2026-11-13',?,NOW(3)),(?,9000001,'synthetic TPU','REG-B','reg-b','2026-11-13',?,NOW(3))`,
      [targetDatasetId, version, targetDatasetId, version],
    );
  }
  const inspection = await standardDatasetLifecycleStoresForPool(pool).baseline.inspectVersionedDataset(targetDatasetId, "TMT", 500);
  await standardDatasetLifecycleStoresForPool(pool).baseline.completeCandidate({ datasetId: targetDatasetId, inspection });
  const [[source]] = await connection.execute<RowDataPacket[]>("SELECT COUNT(*) AS total FROM standard_datasets WHERE tmt_sync_run_id=?", [sourceRunId]);
  assert.equal(Number(source?.total), 1);
}
