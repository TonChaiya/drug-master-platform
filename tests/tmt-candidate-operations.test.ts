import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { test, vi } from "vitest";
import { TMT_TABLES } from "@/modules/standards/tmt-dataset-tables";
import { aggregateManifest, versionedRegNoConflictDelta } from "@/modules/standards/dataset-release-mysql";
import { canonicalDatasetRow } from "@/modules/standards/dataset-staging";
import { acceptTmtCandidate, processTmtCandidateDelivery, readCandidateOperations, resumeTmtCandidate, revalidateTmtCandidate } from "@/modules/tmt/candidate-jobs";
import { activateTmtDataset, checkCandidateInvariants } from "@/modules/tmt/candidate-lifecycle";
import { buildCandidatePlan, candidateRequestSchema } from "@/modules/tmt/candidate-plan";
import { TmtSyncRepository } from "@/modules/tmt/persistence";
import type { TmtSyncSource } from "@/modules/tmt/sync";

const NOW = new Date("2026-11-28T10:00:00Z");
const PLAN = [{ endpoint: "tpu", window: { begindate: "2026-11-01", enddate: "2026-11-28" } }];
const MANIFESTS = TMT_TABLES.map((t) => ({ tableName: t.targetTable, rowCount: 1, contentHash: "a".repeat(64) }));
const HASH = aggregateManifest(MANIFESTS);
const RESULT = { affectedRows: 1 };

function fakeTarget(options: { noJob?: boolean; expireAfterFetch?: boolean; loseFence?: boolean; changedBase?: boolean; acceptedRollback?: boolean; recoveryManifestsMatch?: boolean } = {}) {
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
    if (sql.startsWith("SELECT table_name,row_count,content_hash")) return [MANIFESTS.map((m) => ({
      table_name: m.tableName, row_count: m.rowCount,
      content_hash: options.recoveryManifestsMatch ? createHash("sha256").update(canonicalDatasetRow({ tmtid: 1 })).digest("hex") : m.contentHash,
    }) as RowDataPacket)];
    if (sql.startsWith("SELECT COLUMN_NAME AS column_name")) return [[{ column_name: "tmtid" } as RowDataPacket]];
    if (options.recoveryManifestsMatch && sql.startsWith("SELECT `tmtid` FROM `tmt_dataset_")) return [[{ tmtid: 1 } as RowDataPacket]];
    if (sql.startsWith("SELECT `tmtid` FROM `tmt_dataset_concepts`")) return [[]];
    if (options.recoveryManifestsMatch) {
      if (sql.startsWith("WITH latest AS")) return [[]];
      if (sql.includes("invariant_rows")) return [[{ total: 0 } as RowDataPacket]];
      if (sql.startsWith("SELECT gpuid FROM tmt_dataset_gpu")) return [[{ gpuid: 764169 } as RowDataPacket]];
      if (sql.startsWith("SELECT level_name")) return [[{ level_name: "gpu" } as RowDataPacket]];
      if (sql.startsWith("SELECT CAST(concept2")) return [[{ tmtid: "1" } as RowDataPacket]];
      if (sql.startsWith("SELECT COUNT(*) AS total")) return [[{ total: 1, active_total: 1 } as RowDataPacket]];
      if (sql.startsWith("UPDATE standard_datasets SET state='validated'")) return [RESULT];
      if (sql.startsWith("UPDATE tmt_candidate_jobs SET status='validated'")) {
        Object.assign(job!, { status: "validated", error_code: null });
        return [RESULT];
      }
    }
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
    if (sql.startsWith("UPDATE tmt_candidate_jobs SET status='queued',next_step=?")) {
      Object.assign(job!, { status: "queued", next_step: params[0], error_code: params[1], attempts: 0, fence: Number(job?.fence) + 1 });
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

test("monitoring projects seed rows and offset separately from upstream checkpoints", async () => {
  const updated = new Date("2026-11-28T10:15:00Z");
  const expires = new Date("2026-11-28T10:19:30Z");
  const job = {
    dataset_id: "candidate", base_dataset_id: "base", base_generation: 1,
    mode: "incremental", status: "running", version: "20261116", plan: PLAN,
    next_step: 0, seed_complete: 0, lease_live: 1, attempts: 1, fence: 7,
    received_rows: 0, written_rows: 0, warnings_count: 0, updated_at: updated, lease_until: expires,
  };
  const reads = vi.fn(async (sql: string, params?: string[]) => {
    if (sql.startsWith("SELECT p.dataset_id")) return [[{
      dataset_id: "base", generation: 1, source: "TMT", state: "validated", content_hash: HASH,
      manifest_hash: HASH, assurance: "validated_unverified", coverage_through: "2026-11-25",
    }]];
    if (sql.startsWith("SELECT j.*")) return [[job]];
    if (sql.startsWith("SELECT a.dataset_id")) return [[]];
    assert.match(sql, /JOIN standard_dataset_manifests m ON m.dataset_id=j.base_dataset_id/);
    assert.match(sql, /WHERE j.dataset_id=\? AND j.seed_complete=0/);
    assert.deepEqual(params, ["candidate"]);
    return [TMT_TABLES.map(({ targetTable }, index) => ({
      table_name: targetTable, row_count: 1000, copied: index === 0 ? 1000 : index === 1 ? 23 : 0,
    }))];
  });
  const pool = { query: reads, execute: reads } as unknown as Pool;
  const [active] = (await readCandidateOperations(pool)).jobs;
  assert.equal(active.stage, "seed");
  assert.deepEqual(active.seed, { copied: 1023, total: 14000, cursor: { table: "tmt_dataset_relationships", offset: 23 } });
  assert.deepEqual([active.nextStep, active.received, active.written, active.attempts, active.fence], [0, 0, 0, 1, 7]);
  assert.equal(active.updatedAt, updated.toISOString());
  assert.equal(active.leaseUntil, expires.toISOString());
  assert.equal(active.processing, null);

  job.seed_complete = 1;
  reads.mockClear();
  const [checkpoint] = (await readCandidateOperations(pool)).jobs;
  assert.equal(checkpoint.stage, "checkpoints");
  assert.equal(checkpoint.seed, null);
  assert.deepEqual(checkpoint.processing, PLAN[0]);
  assert.equal(reads.mock.calls.length, 3);
});

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

test("baseline-relative RegNo policy compares the TPU, latest date and normalized value set", async () => {
  const row = (dataset_id: string, tpuid: string, normalized_regno: string, change_date = "2026-11-28") =>
    ({ dataset_id, tpuid, normalized_regno, change_date });
  const base = [row("base", "10", "a"), row("base", "10", "b"), row("base", "11", "x"), row("base", "11", "y")];
  let candidate = base.map((value) => ({ ...value, dataset_id: "candidate" })).reverse();
  const execute = vi.fn(async () => [[...base, ...candidate]]);
  assert.deepEqual(await versionedRegNoConflictDelta({ execute } as never, "base", "candidate"),
    { unchanged: 2, added: [], removed: [], modified: [] });
  candidate = [row("candidate", "10", "a"), row("candidate", "10", "b"), row("candidate", "10", "c"), row("candidate", "12", "x"), row("candidate", "12", "y")];
  assert.deepEqual(await versionedRegNoConflictDelta({ execute } as never, "base", "candidate"),
    { unchanged: 0, added: ["12"], removed: ["11"], modified: ["10"] });
  candidate = [row("candidate", "10", "a", "2026-11-29"), row("candidate", "10", "b", "2026-11-29")];
  assert.deepEqual(await versionedRegNoConflictDelta({ execute } as never, "base", "candidate"),
    { unchanged: 0, added: [], removed: ["11"], modified: ["10"] });
});

test("structural and GPU gates remain blocking and Full does not inherit RegNo exceptions", async () => {
  let structural = false, gpu = true;
  const execute = vi.fn(async (sql: string) => {
    if (sql.startsWith("WITH latest AS")) return [[]];
    if (sql.includes("gpuid FROM")) return [gpu ? [{ gpuid: 764169 }] : []];
    if (sql.includes("SELECT level_name")) return [[{ level_name: "gpu" }]];
    if (sql.includes("AS tmtid FROM tmt_dataset_relationships")) return [[{ tmtid: "123" }]];
    if (sql.includes(") conflicts")) return [[{ total: 1 }]];
    if (sql.includes("invariant_rows")) return [[{ total: structural && sql.includes("status NOT IN") ? 1 : 0 }]];
    return [[{ total: 1, active_total: 1 }]];
  });
  const tx = { execute } as never;
  await checkCandidateInvariants(tx, "candidate", "base");
  await assert.rejects(checkCandidateInvariants(tx, "candidate"), /INVARIANTS_FAILED/);
  structural = true;
  await assert.rejects(checkCandidateInvariants(tx, "candidate", "base"), /INVARIANTS_FAILED/);
  structural = false;
  gpu = false;
  await assert.rejects(checkCandidateInvariants(tx, "candidate", "base"), /INVARIANTS_FAILED/);
});

test("revalidation requires the original complete plan, pinned base and upstream version", async () => {
  const target = fakeTarget();
  const plan = buildCandidatePlan({ mode: "incremental" }, NOW, "2026-11-25");
  const results = plan.map(() => ({ status: "succeeded", warnings: 0 }));
  target.setJob({ mode: "incremental", status: "failed", error_code: "TMT_CANDIDATE_INVARIANTS_FAILED",
    plan, checkpoint_results: results, next_step: plan.length + TMT_TABLES.length, fence: 123 });
  const source = fakeSource();
  const dispatch = vi.fn(async () => {});
  const run = () => revalidateTmtCandidate(target.pool, "candidate", "admin", source as unknown as TmtSyncSource, dispatch);
  source.version.mockResolvedValueOnce("20261129");
  await assert.rejects(run(), /NOT_REVALIDATABLE/);
  target.setJob({ base_generation: 2 });
  await assert.rejects(run(), /NOT_REVALIDATABLE/);
  target.setJob({ base_generation: 1, checkpoint_results: results.slice(1) });
  await assert.rejects(run(), /NOT_REVALIDATABLE/);
  target.setJob({ checkpoint_results: results });
  await run();
  assert.equal(target.job()?.next_step, plan.length);
  assert.equal(target.job()?.error_code, "TMT_VALIDATION_RECOVERY");
  assert.deepEqual(target.job()?.checkpoint_results, results);
  assert.equal(target.pointer(), "base");
  assert.equal(source.fetch.mock.calls.length, 0);
  assert.deepEqual(dispatch.mock.calls, [["candidate", "candidate:revalidate:124"]]);
  await assert.rejects(run(), /NOT_REVALIDATABLE/);
  assert.equal(await processTmtCandidateDelivery(target.pool, "candidate", source as unknown as TmtSyncSource, dispatch), "complete");
  assert.equal(target.job()?.status, "failed");
  assert.equal(target.job()?.error_code, "TMT_CANDIDATE_MANIFEST_MISMATCH");
  assert.equal(target.pointer(), "base");
  assert.equal(source.fetch.mock.calls.length, 0);
  assert.equal(dispatch.mock.calls.length, 1);
});

test("validation-only recovery verifies every manifest and seals the candidate without replacing data or promoting", async () => {
  const target = fakeTarget({ recoveryManifestsMatch: true });
  const plan = buildCandidatePlan({ mode: "incremental" }, NOW, "2026-11-25");
  const results = plan.map(() => ({ status: "succeeded" }));
  target.setJob({ mode: "incremental", status: "failed", error_code: "TMT_CANDIDATE_INVARIANTS_FAILED",
    plan, checkpoint_results: results, next_step: plan.length + TMT_TABLES.length });
  const source = fakeSource() as unknown as TmtSyncSource;
  const dispatch = vi.fn(async () => {});
  await revalidateTmtCandidate(target.pool, "candidate", "admin", source, dispatch);
  for (let step = 0; step < TMT_TABLES.length; step += 1) {
    assert.equal(await processTmtCandidateDelivery(target.pool, "candidate", source, dispatch), "continued");
  }
  assert.equal(await processTmtCandidateDelivery(target.pool, "candidate", source, dispatch), "complete");
  assert.equal(target.job()?.status, "validated");
  assert.deepEqual(target.job()?.checkpoint_results, results);
  assert.equal(target.pointer(), "base");
  assert.equal(target.inserts.length, 0);
  assert.equal(vi.mocked(source.fetch).mock.calls.length, 0);
  assert.deepEqual(target.audit, ["tmt.candidate_revalidation_queued", "tmt.candidate_validated"]);
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
