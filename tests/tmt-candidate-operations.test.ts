import assert from "node:assert/strict";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { test, vi } from "vitest";
import { TMT_TABLES } from "@/modules/standards/tmt-dataset-tables";
import { aggregateManifest } from "@/modules/standards/dataset-release-mysql";
import { acceptTmtCandidate, processTmtCandidateDelivery, resumeTmtCandidate } from "@/modules/tmt/candidate-jobs";
import { activateTmtDataset } from "@/modules/tmt/candidate-lifecycle";
import { buildCandidatePlan, candidateRequestSchema } from "@/modules/tmt/candidate-plan";
import { TmtSyncRepository } from "@/modules/tmt/persistence";
import type { TmtSyncSource } from "@/modules/tmt/sync";

const NOW = new Date("2026-11-28T10:00:00Z");
const PLAN = [{ endpoint: "tpu", window: { begindate: "2026-11-01", enddate: "2026-11-28" } }];
const MANIFESTS = TMT_TABLES.map((t) => ({ tableName: t.targetTable, rowCount: 1, contentHash: "a".repeat(64) }));
const HASH = aggregateManifest(MANIFESTS);
const RESULT = { affectedRows: 1 };

function fakeTarget(options: { noJob?: boolean; expireAfterFetch?: boolean; loseFence?: boolean; changedBase?: boolean; acceptedRollback?: boolean } = {}) {
  let job: Record<string, unknown> | null = options.noJob ? null : {
    dataset_id: "candidate", base_dataset_id: "base", base_generation: 1, requested_by: "admin", version: "20261128",
    status: "queued", mode: "full", plan: PLAN, seed_complete: 1, next_step: 0, checkpoint_results: [], attempts: 0, fence: 0, lease_live: 0,
  };
  let checkpointUpdates = 0;
  let active = options.changedBase ? "other" : "base";
  let generation = 1;
  const stagedInserts: unknown[][] = [];
  const audit: string[] = [];
  let snapshot: { job: typeof job; updates: number; active: string; generation: number; inserts: number; audits: number };
  let claims = 0;
  const run = vi.fn(async (statement: string, params: unknown[] = []): Promise<[RowDataPacket[] | typeof RESULT]> => {
    const sql = statement.replace(/\s+/g, " ");
    if (sql.startsWith("SELECT p.dataset_id")) return [[{
      dataset_id: active, generation, source: "TMT", state: "validated", content_hash: HASH, manifest_hash: HASH, assurance: "validated_unverified",
      coverage_through: "2026-11-25",
    } as RowDataPacket]];
    if (sql.startsWith("SELECT singleton_id") || sql.startsWith("SELECT filename FROM schema_migrations") || sql.startsWith("SELECT id FROM users")) return [[{ id: "ok" } as RowDataPacket]];
    if (sql.startsWith("SELECT requested_by")) return [job && checkpointUpdates > 0 ? [job as RowDataPacket] : []];
    if (sql.startsWith("SELECT dataset_id FROM tmt_candidate_jobs WHERE status")) return [job && ["queued", "running"].includes(String(job.status)) ? [{ dataset_id: "candidate" } as RowDataPacket] : []];
    if (sql.startsWith("SELECT *,COALESCE") || sql.startsWith("SELECT * FROM tmt_candidate_jobs")) {
      if (!job) return [[]];
      const override = claims && options.expireAfterFetch ? { lease_live: 0 } : claims && options.loseFence ? { fence: 999 } : {};
      return [[{ ...job, ...override } as RowDataPacket]];
    }
    if (sql.startsWith("SELECT id FROM standard_datasets")) return [[{ id: "candidate" } as RowDataPacket]];
    if (sql.startsWith("SELECT source,state,source_version")) return [[{ source: "TMT", state: "validated", source_version: "20261128", content_hash: HASH } as RowDataPacket]];
    if (sql.startsWith("SELECT manifest_hash,assurance")) return [options.acceptedRollback ? [{ manifest_hash: HASH, assurance: "validated_unverified" } as RowDataPacket] : []];
    if (sql.startsWith("SELECT table_name,row_count,content_hash")) return [MANIFESTS.map((m) => ({ table_name: m.tableName, row_count: m.rowCount, content_hash: m.contentHash }) as RowDataPacket)];
    if (sql.startsWith("INSERT INTO standard_datasets") || sql.startsWith("INSERT INTO tmt_candidate_acceptances")) return [RESULT];
    if (sql.startsWith("INSERT INTO tmt_candidate_jobs")) {
      job = { dataset_id: params[0], base_dataset_id: params[1], base_generation: params[2], requested_by: params[3], mode: params[4],
        version: params[5], plan: JSON.parse(String(params[6])), seed_complete: params[7], status: "queued", attempts: 0, next_step: 0, fence: 0, lease_live: 0 };
      return [RESULT];
    }
    if (sql.startsWith("UPDATE tmt_active_dataset")) { active = String(params[0]); generation += 1; return [RESULT]; }
    if (sql.startsWith("INSERT INTO audit_logs")) { audit.push(String(params[2])); return [RESULT]; }
    if (sql.startsWith("UPDATE tmt_candidate_jobs SET status='running'")) {
      claims += 1;
      Object.assign(job!, { status: "running", attempts: Number(job?.attempts) + 1, fence: Number(job?.fence) + 1, lease_live: 1 });
      return [RESULT];
    }
    if (sql.startsWith("UPDATE tmt_candidate_jobs SET lease_until=NULL")) { job!.lease_live = 0; return [RESULT]; }
    if (sql.startsWith("UPDATE tmt_candidate_jobs SET status='queued',next_step=next_step+1")) {
      checkpointUpdates += 1;
      Object.assign(job!, { status: "queued", next_step: Number(job?.next_step) + 1, attempts: 0 });
      return [RESULT];
    }
    if (sql.startsWith("UPDATE tmt_candidate_jobs SET status=?,error_code=?")) {
      Object.assign(job!, { status: params[0], error_code: params[1] }); return [RESULT];
    }
    if (sql.startsWith("SELECT tpuid")) { assert.match(sql, /tmt_dataset_tpu WHERE dataset_id=\?/); return [[]]; }
    if (sql.startsWith("INSERT INTO tmt_dataset_tpu")) {
      assert.match(sql, /\(dataset_id,tpuid,/);
      assert.match(sql, /VALUES\(change_date\)>change_date/);
      stagedInserts.push(params);
      return [RESULT];
    }
    throw new Error("Unexpected SQL in test: " + sql);
  });
  const connection = {
    query: run, execute: run,
    beginTransaction: async () => { snapshot = { job: structuredClone(job), updates: checkpointUpdates, active, generation, inserts: stagedInserts.length, audits: audit.length }; },
    commit: async () => {}, release: () => {},
    rollback: async () => { job = snapshot.job; checkpointUpdates = snapshot.updates; active = snapshot.active; generation = snapshot.generation; stagedInserts.length = snapshot.inserts; audit.length = snapshot.audits; },
  };
  const pool = { getConnection: async () => connection } as unknown as Pool;
  return { pool, run, setJob: (update: Record<string, unknown>) => Object.assign(job!, update), updates: () => checkpointUpdates,
    pointer: () => active, inserts: stagedInserts, audit, job: () => job };
}

function fakeSource() {
  return { version: vi.fn(async () => "20261128"), fetch: vi.fn(async () => [
    { tpuid: "565818", fsn: "sample", manufacturer: "supplier", changeDate: "2026-11-28" },
  ]), resetAuthentication: vi.fn(async () => {}) };
}

test("candidate date ranges cannot create verified gaps and invalid dates are rejected", () => {
  assert.equal(buildCandidatePlan({ mode: "full" }, NOW)[0].window.begindate, "2013-01-01");
  assert.equal(buildCandidatePlan({ mode: "incremental" }, NOW, "2026-11-25")[0].window.begindate, "2026-10-27");
  assert.throws(() => buildCandidatePlan({ mode: "full", begin: "2026-01-01" }, NOW), /COVERAGE_GAP/);
  assert.throws(() => buildCandidatePlan({ mode: "incremental", end: "2026-11-27" }, NOW, "2026-11-25"), /MUST_END_TODAY/);
  assert.throws(() => buildCandidatePlan({ mode: "incremental", begin: "2026-09-31" }, NOW, "2026-11-25"), /Invalid ISO date/);
  assert.equal(candidateRequestSchema.safeParse({ mode: "full_unverified" }).success, false);
});

test("job acceptance dispatches before commit and rolls back insertion/audit when queue rejects", async () => {
  const target = fakeTarget({ noJob: true });
  const source = fakeSource() as unknown as TmtSyncSource;
  const dispatch = vi.fn(async (): Promise<void> => { assert.ok(target.job()); throw new Error("queue unavailable"); });
  await assert.rejects(acceptTmtCandidate(target.pool, { id: "candidate", actor: "admin", mode: "full" }, source, dispatch, NOW), /queue unavailable/);
  assert.equal(target.job(), null);
  assert.deepEqual(target.audit, []);
  assert.equal(target.pointer(), "base");
  dispatch.mockResolvedValue(undefined);
  await acceptTmtCandidate(target.pool, { id: "candidate", actor: "admin", mode: "full" }, source, dispatch, NOW);
  await assert.rejects(acceptTmtCandidate(target.pool, { id: "another", actor: "admin", mode: "full" }, source, dispatch, NOW), /JOB_ALREADY_ACTIVE/);
  assert.equal(dispatch.mock.calls.length, 2);
});

test("worker commits to candidate only and persists progress before awaiting next queue send", async () => {
  const target = fakeTarget();
  const source = fakeSource() as unknown as TmtSyncSource;
  const dispatch = vi.fn(async () => { assert.equal(target.updates(), 1); });
  assert.equal(await processTmtCandidateDelivery(target.pool, "candidate", source, dispatch), "continued");
  assert.equal(target.pointer(), "base");
  assert.equal(target.inserts[0][0], "candidate");
  assert.equal(target.inserts[0][1], "565818");
  assert.deepEqual(dispatch.mock.calls[0], ["candidate", "candidate:after:1"]);
});

test.each([{ expireAfterFetch: true }, { loseFence: true }])("worker cannot commit under an expired or replaced fence %j", async (options) => {
  const target = fakeTarget(options);
  const dispatch = vi.fn();
  await assert.rejects(processTmtCandidateDelivery(target.pool, "candidate", fakeSource() as unknown as TmtSyncSource, dispatch), /FENCE_EXPIRED/);
  assert.deepEqual(target.inserts, []);
  assert.equal(target.updates(), 0);
  assert.equal(target.pointer(), "base");
  assert.equal(dispatch.mock.calls.length, 0);
});

test("active lease blocks duplicate deliveries; expired claim is recoverable without the browser", async () => {
  const target = fakeTarget();
  const source = fakeSource();
  target.setJob({ status: "running", lease_live: 1, fence: 8, attempts: 1 });
  await assert.rejects(processTmtCandidateDelivery(target.pool, "candidate", source as unknown as TmtSyncSource, async () => {}), /ALREADY_LEASED/);
  assert.equal(source.fetch.mock.calls.length, 0);
  target.setJob({ lease_live: 0 });
  const dispatch = vi.fn(async () => {});
  await processTmtCandidateDelivery(target.pool, "candidate", source as unknown as TmtSyncSource, dispatch);
  assert.equal(target.updates(), 1);
  assert.deepEqual(dispatch.mock.calls[0], ["candidate", "candidate:after:9"]);
});

test("version drift marks a candidate stale and keeps accepted data and pointer", async () => {
  const target = fakeTarget();
  target.setJob({ next_step: 1 + TMT_TABLES.length });
  const source = fakeSource();
  source.version.mockResolvedValue("20261129");
  assert.equal(await processTmtCandidateDelivery(target.pool, "candidate", source as unknown as TmtSyncSource, async () => {}), "complete");
  assert.equal(target.job()?.status, "stale");
  assert.equal(target.pointer(), "base");
  assert.equal(source.fetch.mock.calls.length, 0);
  await assert.rejects(resumeTmtCandidate(target.pool, "candidate", "admin", source as unknown as TmtSyncSource, async () => {}), /NOT_RESUMABLE/);
});

test("promotion rejects incomplete evidence and rollback requires immutable acceptance", async () => {
  const notAccepted = fakeTarget();
  const result = { datasetId: "candidate", actor: "admin", generation: 1 } as const;
  await assert.rejects(activateTmtDataset(notAccepted.pool, { ...result, action: "promote", observedVersion: "20261128" }), /VERSION_OR_BASE_CHANGED/);
  await assert.rejects(activateTmtDataset(notAccepted.pool, { ...result, action: "rollback" }), /NOT_ACCEPTED/);
  const accepted = fakeTarget({ acceptedRollback: true });
  const rollback = await activateTmtDataset(accepted.pool, { ...result, action: "rollback" });
  assert.equal(rollback.assurance, "validated_unverified");
  assert.equal(rollback.generation, 2);
  assert.deepEqual(accepted.audit, ["tmt.dataset_rollback"]);
});

test("the live CLI refuses to write when the independent migration is journaled", async () => {
  const pool = { query: vi.fn(async () => [[{ filename: "0021_tmt_candidate_operations.sql" }]]) } as unknown as Pool;
  await assert.rejects(new TmtSyncRepository(pool).assertLiveWriterAllowed(), /LIVE_WRITER_DISABLED/);
});
