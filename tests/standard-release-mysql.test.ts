import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "vitest";
import { ACTIVE_STANDARD_RELEASE_POINTER_KEY } from "@/modules/standards/active-release";
import { latestRegNoConflictCount, manifestRowsMatchDataset, standardDatasetLifecycleStoresForPool } from "@/modules/standards/dataset-release-mysql";

test("manifest verification ignores query-only dataset identity fields", () => {
  const contentHash = "a".repeat(64);
  const manifests = [{ datasetId: "dataset-1", tableName: "tmt_dataset_concepts", rowCount: 1, contentHash }];
  const aggregate = createHash("sha256").update(`tmt_dataset_concepts:1:${contentHash}`).digest("hex");
  assert.equal(manifestRowsMatchDataset(manifests, "dataset-1", {
    contentHash: aggregate,
    manifests: [{ tableName: "tmt_dataset_concepts", rowCount: 1, contentHash }],
  }, aggregate), true);
});

test("RegNo approval gate checks conflicts only at each TPU's latest date", async () => {
  let statement = "";
  const executor = { async execute(sql: string) { statement = sql; return [[{ total: 2 }]]; } } as never;
  assert.equal(await latestRegNoConflictCount(executor, "dataset-1"), 2);
  assert.match(statement, /MAX\(change_date\) AS latest_date/);
  assert.match(statement, /latest\.latest_date=r\.change_date/);
});

test("pointer lock creates only the fixed pointer row and locks it before publication", async () => {
  const calls: Array<{ sql: string; values: unknown[] | undefined }> = [];
  const executor = {
    async execute(sql: string, values?: unknown[]) {
      calls.push({ sql, values });
      if (sql.includes("SELECT active_release_id")) return [[{ active_release_id: "release-1" }]];
      return [{ affectedRows: 1 }];
    },
    async query(sql: string, values?: unknown[]) { return this.execute(sql, values); },
  };
  const pool = { ...executor, async getConnection() { return { ...executor, async beginTransaction() {}, async commit() {}, async rollback() {}, release() {} }; } } as never;
  const { releases } = standardDatasetLifecycleStoresForPool(pool);
  assert.equal(await releases.lockActivePointer(ACTIVE_STANDARD_RELEASE_POINTER_KEY), "release-1");
  assert.match(calls[0]?.sql ?? "", /^INSERT IGNORE INTO standard_dataset_pointers/);
  assert.deepEqual(calls[0]?.values, [ACTIVE_STANDARD_RELEASE_POINTER_KEY]);
  assert.match(calls[1]?.sql ?? "", /SELECT active_release_id[\s\S]+FOR UPDATE/);
  assert.deepEqual(calls[1]?.values, [ACTIVE_STANDARD_RELEASE_POINTER_KEY]);
});

test("baseline batch copy is copy-only, dataset-scoped, and bounded", async () => {
  const calls: Array<{ sql: string; values: unknown[] | undefined }> = [];
  const execute = async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      if (sql.includes("SELECT state FROM standard_datasets")) return [[{ state: "writing" }]];
      if (sql.includes("COUNT(*) AS total") && sql.includes("tmt_dataset_concepts")) return [[{ total: 0 }]];
      if (sql.includes("COUNT(*) AS total") && sql.includes("tmt_concept")) return [[{ total: 2 }]];
      if (sql.includes("information_schema.COLUMNS")) return [[
        { column_name: "tmtid" }, { column_name: "fsn" }, { column_name: "change_date" }, { column_name: "level_name" },
        { column_name: "normalized_fsn" }, { column_name: "source_version" }, { column_name: "last_seen_version" },
        { column_name: "synced_at" }, { column_name: "created_at" }, { column_name: "updated_at" },
      ]];
      return [{ affectedRows: 1 }];
    };
  const pool = {
    execute,
    async query(sql: string, values?: unknown[]) { return execute(sql, values); },
  } as never;
  const { baseline } = standardDatasetLifecycleStoresForPool(pool);
  const result = await baseline.copyNextBatch({ datasetId: "10000000-0000-4000-8000-000000000001", source: "TMT", batchSize: 1 });
  assert.deepEqual(result, { copiedRows: 1, complete: false });
  const copy = calls.find((call) => call.sql.includes("INSERT IGNORE INTO `tmt_dataset_concepts`"));
  assert.ok(copy);
  assert.match(copy.sql, /SELECT \?,[\s\S]+FROM `tmt_concept`[\s\S]+ORDER BY `tmtid` LIMIT \? OFFSET \?/);
  assert.deepEqual(copy.values, ["10000000-0000-4000-8000-000000000001", 1, 0]);
  assert.doesNotMatch(copy.sql, /ON DUPLICATE KEY UPDATE|DELETE|TRUNCATE/i);
});

test("baseline batch state check and copy share the candidate row lock transaction", async () => {
  const events: string[] = [];
  const connection = {
    async execute(sql: string) {
      events.push(sql);
      if (sql.includes("SELECT state FROM standard_datasets")) return [[{ state: "writing" }]];
      if (sql.includes("COUNT(*) AS total") && sql.includes("tmt_dataset_concepts")) return [[{ total: 0 }]];
      if (sql.includes("COUNT(*) AS total") && sql.includes("tmt_concept")) return [[{ total: 1 }]];
      if (sql.includes("information_schema.COLUMNS")) return [[{ column_name: "tmtid" }]];
      return [{ affectedRows: 1 }];
    },
    async query(sql: string) { return this.execute(sql); },
    async beginTransaction() { events.push("BEGIN"); },
    async commit() { events.push("COMMIT"); },
    async rollback() { events.push("ROLLBACK"); },
    release() { events.push("RELEASE"); },
  };
  const pool = {
    async execute(sql: string) { return connection.execute(sql); },
    async query(sql: string) { return connection.query(sql); },
    async getConnection() { return connection; },
  } as never;
  const { baseline } = standardDatasetLifecycleStoresForPool(pool);
  await baseline.copyNextBatch({ datasetId: "10000000-0000-4000-8000-000000000001", source: "TMT", batchSize: 1 });
  assert.equal(events[0], "BEGIN");
  assert.match(events[1] ?? "", /SELECT state[\s\S]+FOR UPDATE/);
  assert.ok(events.findIndex((event) => event.includes("INSERT IGNORE")) > 1);
  assert.deepEqual(events.slice(-2), ["COMMIT", "RELEASE"]);
});

test("baseline batch copy fails closed when INSERT IGNORE cannot copy every selected row", async () => {
  const execute = async (sql: string) => {
    if (sql.includes("SELECT state FROM standard_datasets")) return [[{ state: "writing" }]];
    if (sql.includes("COUNT(*) AS total") && sql.includes("tmt_dataset_concepts")) return [[{ total: 0 }]];
    if (sql.includes("COUNT(*) AS total") && sql.includes("tmt_concept")) return [[{ total: 1 }]];
    if (sql.includes("information_schema.COLUMNS")) return [[{ column_name: "tmtid" }]];
    if (sql.includes("INSERT IGNORE INTO `tmt_dataset_concepts`")) return [{ affectedRows: 0 }];
    return [{ affectedRows: 1 }];
  };
  const pool = { execute, query: execute } as never;
  const { baseline } = standardDatasetLifecycleStoresForPool(pool);
  await assert.rejects(() => baseline.copyNextBatch({
    datasetId: "10000000-0000-4000-8000-000000000001", source: "TMT", batchSize: 1,
  }), /copy every selected row/i);
});

test("baseline candidate rejects a source version that does not match its TMT run", async () => {
  const statements: string[] = [];
  const execute = async (sql: string) => {
    statements.push(sql);
    if (sql.includes("FROM tmt_sync_runs")) return [[{ id: "run-1", source_version: "v2" }]];
    return [{ affectedRows: 1 }];
  };
  const pool = { execute, async query(sql: string) { return execute(sql); } } as never;
  const { baseline } = standardDatasetLifecycleStoresForPool(pool);
  await assert.rejects(() => baseline.createCandidate({
    datasetId: "10000000-0000-4000-8000-000000000001",
    source: "TMT",
    sourceVersion: "v1",
    contentHash: "a".repeat(64),
    tmtSyncRunId: "10000000-0000-4000-8000-000000000005",
    ttmtImportId: null,
  }), /source version/i);
  assert.equal(statements.some((statement) => statement.startsWith("INSERT INTO standard_datasets")), false);
});

test("baseline candidate enters writing state in the same insert", async () => {
  const statements: string[] = [];
  const execute = async (sql: string) => {
    statements.push(sql);
    if (sql.includes("FROM tmt_sync_runs")) return [[{ id: "run-1", source_version: "v1" }]];
    if (sql.startsWith("UPDATE standard_datasets SET state='writing'")) return [{ affectedRows: 0 }];
    return [{ affectedRows: 1 }];
  };
  const pool = { execute, async query(sql: string) { return execute(sql); } } as never;
  const { baseline } = standardDatasetLifecycleStoresForPool(pool);
  await baseline.createCandidate({
    datasetId: "10000000-0000-4000-8000-000000000001",
    source: "TMT",
    sourceVersion: "v1",
    contentHash: "a".repeat(64),
    tmtSyncRunId: "10000000-0000-4000-8000-000000000005",
    ttmtImportId: null,
  });
  assert.equal(statements.some((statement) => statement.startsWith("UPDATE standard_datasets SET state='writing'")), false);
});

test("baseline completion saves manifests and validates state in one transaction", async () => {
  const events: string[] = [];
  const connection = {
    async execute(sql: string) {
      events.push(sql);
      if (sql.includes("SELECT state")) return [[{ state: "writing" }]];
      return [{ affectedRows: 1 }];
    },
    async query(sql: string) { return this.execute(sql); },
    async beginTransaction() { events.push("BEGIN"); },
    async commit() { events.push("COMMIT"); },
    async rollback() { events.push("ROLLBACK"); },
    release() { events.push("RELEASE"); },
  };
  const pool = {
    async execute(sql: string) { return connection.execute(sql); },
    async query(sql: string) { return connection.query(sql); },
    async getConnection() { return connection; },
  } as never;
  const { baseline } = standardDatasetLifecycleStoresForPool(pool);
  await baseline.completeCandidate({
    datasetId: "10000000-0000-4000-8000-000000000001",
    inspection: { contentHash: "a".repeat(64), manifests: [{ tableName: "tmt_dataset_concepts", rowCount: 1, contentHash: "b".repeat(64) }] },
  });
  assert.equal(events[0], "BEGIN");
  assert.ok(events.some((event) => event.startsWith("INSERT INTO standard_dataset_manifests")));
  assert.ok(events.some((event) => event.startsWith("UPDATE standard_datasets SET state='validated'")));
  assert.deepEqual(events.slice(-2), ["COMMIT", "RELEASE"]);
});

test("live baseline fingerprint is read from one repeatable-read snapshot", async () => {
  const events: string[] = [];
  const connection = {
    async execute(sql: string) {
      events.push(sql);
      if (sql.includes("information_schema.COLUMNS")) return [[{ column_name: "id" }]];
      return [[]];
    },
    async query(sql: string) { events.push(sql); return [[]]; },
    async beginTransaction() { events.push("BEGIN"); },
    async commit() { events.push("COMMIT"); },
    async rollback() { events.push("ROLLBACK"); },
    release() { events.push("RELEASE"); },
  };
  const pool = {
    async execute(sql: string) { return connection.execute(sql); },
    async query(sql: string) { return connection.query(sql); },
    async getConnection() { return connection; },
  } as never;
  const { baseline } = standardDatasetLifecycleStoresForPool(pool);
  await baseline.inspectLiveSource("TMT", 10);
  assert.deepEqual(events.slice(0, 2), ["SET TRANSACTION ISOLATION LEVEL REPEATABLE READ", "BEGIN"]);
  assert.deepEqual(events.slice(-2), ["COMMIT", "RELEASE"]);
});
