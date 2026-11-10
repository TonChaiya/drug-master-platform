import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, test } from "vitest";
import type { Pool } from "mysql2/promise";
import { TMT_WRITE_CHUNK, TmtSyncRepository } from "@/modules/tmt/persistence";
import { resumeTmtSyncRun, type TmtSyncSource } from "@/modules/tmt/sync";
import { createIntegrationTestPool, dbIntegrationTestsEnabled, integrationTestDbConfig } from "./helpers/db-integration";

const enabled = dbIntegrationTestsEnabled();
let pool: Pool;
let repository: TmtSyncRepository;
const runId = randomUUID();
const resumeRunId = randomUUID();
const now = new Date("2026-11-04T00:00:00.000Z");
const window = { begindate: "2026-01-01", enddate: "2026-12-31" };

describe.runIf(enabled).sequential("TMT v2 persistence on isolated local MySQL", () => {
  beforeAll(async () => {
    pool = createIntegrationTestPool(integrationTestDbConfig());
    repository = new TmtSyncRepository(pool);
    await repository.createRun({ id: runId, version: "20261104", mode: "full", startedAt: now });
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.execute("DELETE FROM tmt_sync_runs WHERE id IN (?,?)", [runId, resumeRunId]);
    for (const table of ["tmt_relationship", "tmt_mastertmt", "tmt_nlem", "tmt_tpp", "tmt_gpu", "tmt_subs"]) {
      await pool.query(`DELETE FROM ${table}`);
    }
    await pool.end();
  });

  test("level rows never regress and same-date conflicts remain observable", async () => {
    await repository.ensureCheckpoint({ runId, endpoint: "gpu", window });
    const first = await repository.persistWindow({
      runId,
      endpoint: "gpu",
      window,
      version: "20261104",
      syncedAt: now,
      rows: [{ gpuid: "764169", fsn: "original (GPU)", changeDate: "2026-01-02" }],
    });
    assert.equal(first.writtenRows, 1);

    const exact = await repository.persistWindow({
      runId,
      endpoint: "gpu",
      window,
      version: "20261105",
      syncedAt: new Date("2026-11-05T00:00:00.000Z"),
      rows: [{ gpuid: "764169", fsn: "original (GPU)", changeDate: "2026-01-02" }],
    });
    assert.equal(exact.writtenRows, 0);

    const conflict = await repository.persistWindow({
      runId,
      endpoint: "gpu",
      window,
      version: "20261105",
      syncedAt: now,
      rows: [
        { gpuid: "764169", fsn: "conflict (GPU)", changeDate: "2026-01-02" },
        { gpuid: "764169", fsn: "older (GPU)", changeDate: "2025-01-01" },
      ],
    });
    assert.equal(conflict.writtenRows, 0);
    assert.ok(conflict.warnings.some((warning) => warning.code === "SAME_DATE_CONFLICT"));

    const [rows] = await pool.query<import("mysql2").RowDataPacket[]>("SELECT fsn, change_date, last_seen_version FROM tmt_gpu WHERE gpuid = 764169");
    assert.equal(rows[0]?.fsn, "original (GPU)");
    assert.equal((rows[0]?.change_date as Date).toISOString().slice(0, 10), "2026-01-02");
    assert.equal(rows[0]?.last_seen_version, "20261105");

    await pool.execute("UPDATE tmt_gpu SET updated_at='2000-01-01 00:00:00.000' WHERE gpuid=764169");
    const newer = await repository.persistWindow({
      runId,
      endpoint: "gpu",
      window,
      version: "20261106",
      syncedAt: new Date("2026-11-06T00:00:00.000Z"),
      rows: [{ gpuid: "764169", fsn: "newer (GPU)", changeDate: "2026-01-03" }],
    });
    assert.equal(newer.writtenRows, 1);
    const [updated] = await pool.query<import("mysql2").RowDataPacket[]>("SELECT fsn,updated_at FROM tmt_gpu WHERE gpuid=764169");
    assert.equal(updated[0]?.fsn, "newer (GPU)");
    assert.notEqual((updated[0]?.updated_at as Date).getUTCFullYear(), 2000);
  });

  test("exact duplicate TPP and relationship rows collapse deterministically", async () => {
    await repository.ensureCheckpoint({ runId, endpoint: "tpp", window });
    const tppRow = { tppid: "9001", fsn: "pack", manufacturer: "maker", changeDate: "2026-01-01" };
    const tpp = await repository.persistWindow({ runId, endpoint: "tpp", window, version: "20261104", syncedAt: now, rows: [tppRow, tppRow] });
    assert.deepEqual({ unique: tpp.uniqueRows, duplicates: tpp.duplicateRows, written: tpp.writtenRows }, { unique: 1, duplicates: 1, written: 1 });

    await repository.ensureCheckpoint({ runId, endpoint: "relationship", window });
    const edge = { concept1: "764169", concept2: "9001", changeDate: "2026-01-01", levelName1: "gpu", levelName2: "tpu" };
    const relationship = await repository.persistWindow({ runId, endpoint: "relationship", window, version: "20261104", syncedAt: now, rows: [edge, edge] });
    assert.equal(relationship.uniqueRows, 1);
    assert.equal(relationship.duplicateRows, 1);
    const replay = await repository.persistWindow({ runId, endpoint: "relationship", window, version: "20261105", syncedAt: now, rows: [edge] });
    assert.equal(replay.writtenRows, 0);
  });

  test("relationship existing-row reads are bounded by write chunks", async () => {
    const batchWindow = { begindate: "2025-01-01", enddate: "2025-12-31" };
    await repository.ensureCheckpoint({ runId, endpoint: "relationship", window: batchWindow });
    let relationshipReads = 0;
    const countingPool = {
      async getConnection() {
        const connection = await pool.getConnection();
        return new Proxy(connection, {
          get(target, property) {
            if (property === "query") {
              return (sql: string, values?: unknown[]) => {
                if (/FROM tmt_relationship\s+WHERE/i.test(sql)) relationshipReads += 1;
                return target.query(sql, values);
              };
            }
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      },
    } as unknown as Pool;
    const rows = Array.from({ length: TMT_WRITE_CHUNK + 1 }, (_, index) => ({
      concept1: String(1_000_000 + index),
      concept2: String(2_000_000 + index),
      changeDate: "2025-01-01",
      levelName1: "gpu",
      levelName2: "tpu",
    }));
    const result = await new TmtSyncRepository(countingPool).persistWindow({
      runId,
      endpoint: "relationship",
      window: batchWindow,
      version: "20261104",
      syncedAt: now,
      rows,
    });
    assert.equal(result.writtenRows, rows.length);
    assert.equal(relationshipReads, Math.ceil(rows.length / TMT_WRITE_CHUNK));
  });

  test("temporal enrichment preserves distinct same-date values and replay is idempotent", async () => {
    await repository.ensureCheckpoint({ runId, endpoint: "nlem", window });
    const rows = [
      { tpuid: "9001", fsn: "one", nlem: "ED", changeDate: "2026-01-01" },
      { tpuid: "9001", fsn: "one", nlem: "NED", changeDate: "2026-01-01" },
      { tpuid: "9001", fsn: "one", nlem: "ED", changeDate: "2026-01-01" },
    ];
    const first = await repository.persistWindow({ runId, endpoint: "nlem", window, version: "20261104", syncedAt: now, rows });
    assert.deepEqual({ unique: first.uniqueRows, duplicates: first.duplicateRows, written: first.writtenRows }, { unique: 2, duplicates: 1, written: 2 });
    assert.ok(first.warnings.some((warning) => warning.code === "SAME_DATE_MULTI_VALUE"));
    const replay = await repository.persistWindow({ runId, endpoint: "nlem", window, version: "20261104", syncedAt: now, rows });
    assert.equal(replay.writtenRows, 0);
    const [count] = await pool.query<import("mysql2").RowDataPacket[]>("SELECT COUNT(*) AS total FROM tmt_nlem WHERE tpuid = 9001");
    assert.equal(Number(count[0]?.total), 2);
    assert.deepEqual(await repository.latestNlem("9001"), {
      changeDate: "2026-01-01",
      values: ["ED", "NED"],
      conflict: true,
    });
    assert.equal(await repository.latestAtc("9001"), null);
  });

  test("blank registration value remains observable without violating normalized_regno NOT NULL", async () => {
    await repository.ensureCheckpoint({ runId, endpoint: "regno", window });
    const result = await repository.persistWindow({
      runId,
      endpoint: "regno",
      window,
      version: "20261104",
      syncedAt: now,
      rows: [{ tpuid: "9001", fsn: "one", regno: "", changeDate: "2026-01-01" }],
    });
    assert.equal(result.writtenRows, 1);
    const [stored] = await pool.query<import("mysql2").RowDataPacket[]>("SELECT regno,normalized_regno FROM tmt_regno WHERE tpuid=9001");
    assert.deepEqual(stored.map((row) => ({ regno: row.regno, normalized: row.normalized_regno })), [{ regno: "", normalized: "" }]);
  });

  test("MasterTMT preserves raw status and does not count identical cross-version replay as a write", async () => {
    await repository.ensureCheckpoint({ runId, endpoint: "mastertmt", window });
    const row = {
      tpucode: "9001", activeingredient: "generic", strength: null, dosageform: null, contvalue: null,
      contunit: null, dispunit: null, tradename: null, manufacturer: null, fsn: "product", status: 1 as const,
    };
    const first = await repository.persistWindow({ runId, endpoint: "mastertmt", window, version: "20261104", syncedAt: now, rows: [row] });
    const replay = await repository.persistWindow({ runId, endpoint: "mastertmt", window, version: "20261105", syncedAt: now, rows: [row] });
    assert.equal(first.writtenRows, 1);
    assert.equal(replay.writtenRows, 0);
    const [stored] = await pool.query<import("mysql2").RowDataPacket[]>("SELECT status, source_version, last_seen_version FROM tmt_mastertmt WHERE tpucode = 9001");
    assert.equal(Number(stored[0]?.status), 1);
    assert.equal(stored[0]?.source_version, "20261104");
    assert.equal(stored[0]?.last_seen_version, "20261105");
  });

  test("data write rolls back when its checkpoint does not exist", async () => {
    await assert.rejects(
      repository.persistWindow({
        runId,
        endpoint: "subs",
        window: { begindate: "2025-01-01", enddate: "2025-12-31" },
        version: "20261104",
        syncedAt: now,
        rows: [{ subsid: "777", fsn: "rollback", changeDate: "2025-01-01" }],
      }),
      /checkpoint/i,
    );
    const [rows] = await pool.query<import("mysql2").RowDataPacket[]>("SELECT COUNT(*) AS total FROM tmt_subs WHERE subsid = 777");
    assert.equal(Number(rows[0]?.total), 0);
  });

  test("resume on local MySQL replays only an incomplete checkpoint", async () => {
    await repository.createRun({ id: resumeRunId, version: "20261104", mode: "full", startedAt: now });
    await repository.ensureCheckpoint({ runId: resumeRunId, endpoint: "gpu", window });
    await repository.ensureCheckpoint({ runId: resumeRunId, endpoint: "tpu", window });
    await repository.persistWindow({ runId: resumeRunId, endpoint: "gpu", window, version: "20261104", syncedAt: now, rows: [] });

    const fetched: string[] = [];
    const source: TmtSyncSource = {
      async version() { return "20261104"; },
      async fetch(endpoint) { fetched.push(endpoint); return []; },
      async resetAuthentication() {},
    };
    const result = await resumeTmtSyncRun({
      runId: resumeRunId,
      source,
      store: repository,
      coreEndpoints: ["gpu", "tpu"],
      optionalEndpoints: [],
      now: () => new Date("2026-11-04T01:00:00.000Z"),
      sleep: async () => undefined,
      random: () => 0,
    });
    assert.equal(result.coreReady, true);
    assert.deepEqual(fetched, ["tpu"]);
    const [checkpoints] = await pool.query<import("mysql2").RowDataPacket[]>(
      "SELECT endpoint,status,attempt_count FROM tmt_sync_checkpoints WHERE run_id=? ORDER BY endpoint",
      [resumeRunId],
    );
    assert.deepEqual(checkpoints.map((row) => ({ endpoint: row.endpoint, status: row.status, attempts: Number(row.attempt_count) })), [
      { endpoint: "gpu", status: "succeeded", attempts: 1 },
      { endpoint: "tpu", status: "succeeded", attempts: 1 },
    ]);
  });
});
