import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { aggregateManifest, inspectTmtDatasetTable, seedTmtDatasetBatch } from "@/modules/standards/dataset-release-mysql";
import { TMT_TABLES } from "@/modules/standards/tmt-dataset-tables";
import { RemoteResponseError } from "@/modules/standards/tmt-client";
import { buildCandidatePlan, candidatePlanSchema, isPinnedTmtVersion, type CandidateRequest } from "./candidate-plan";
import { auditCandidate, checkCandidateInvariants, lockTmtWriter, readCandidateInvariantReport, requireCandidateAdmin, tmtTransaction } from "./candidate-lifecycle";
import { readTmtPointer } from "./candidate-pointer";
import { TmtSyncRepository, type TmtDataWarning } from "./persistence";
import type { TmtSyncSource } from "./sync";

const MAX_STEP_ATTEMPTS = 4;
const LEASE_SECONDS = 270;
const RECOVERY = "TMT_VALIDATION_RECOVERY";
type CandidateDispatch = (id: string, deliveryKey: string) => Promise<void>;
type CandidateJob = RowDataPacket & {
  dataset_id: string; base_dataset_id: string; base_generation: number; requested_by: string;
  version: string; status: string; mode: string; plan: unknown; checkpoint_results: unknown; next_step: number;
  seed_complete: number; attempts: number; fence: number; lease_live: number; recovery_due: number; error_code: string | null;
  updated_at: Date; lease_until: Date | null;
};

function decodeJson(value: unknown): unknown {
  return typeof value === "string" ? JSON.parse(value) : value;
}

async function lockedJob(tx: PoolConnection, id: string): Promise<CandidateJob> {
  const [rows] = await tx.execute<CandidateJob[]>(
    "SELECT *,COALESCE(lease_until>UTC_TIMESTAMP(3),0) AS lease_live,updated_at<UTC_TIMESTAMP(3)-INTERVAL 10 MINUTE AS recovery_due FROM tmt_candidate_jobs WHERE dataset_id=? FOR UPDATE", [id],
  );
  if (rows.length !== 1) throw new Error("TMT_JOB_NOT_COMMITTED");
  return rows[0];
}

async function failJob(tx: PoolConnection, job: CandidateJob, code: string, status: "failed" | "stale") {
  await tx.execute("UPDATE tmt_candidate_jobs SET status=?,error_code=? WHERE dataset_id=?", [status, code, job.dataset_id]);
  await auditCandidate(tx, job.requested_by, job.dataset_id, "tmt.candidate_" + status, { code, step: job.next_step });
}

export async function acceptTmtCandidate(pool: Pool, request: CandidateRequest & { id: string; actor: string },
  source: TmtSyncSource, dispatch: CandidateDispatch, now = new Date()) {
  const version = await source.version();
  if (!isPinnedTmtVersion(version)) throw new Error("TMT_VERSION_UNAVAILABLE");
  return tmtTransaction(pool, async (tx) => {
    await lockTmtWriter(tx);
    const pointer = await readTmtPointer(tx, true);
    if (!pointer.datasetId || !pointer.coverageThrough) throw new Error("TMT_BASELINE_BOOTSTRAP_REQUIRED");
    await requireCandidateAdmin(tx, request.actor);
    const [prior] = await tx.execute<RowDataPacket[]>("SELECT requested_by FROM tmt_candidate_jobs WHERE dataset_id=?", [request.id]);
    if (prior.length) {
      if (prior[0].requested_by !== request.actor) throw new Error("TMT_JOB_ID_CONFLICT");
      return request.id;
    }
    const [conflicting] = await tx.query<RowDataPacket[]>("SELECT dataset_id FROM tmt_candidate_jobs WHERE status IN ('queued','running') LIMIT 1 FOR UPDATE");
    if (conflicting.length) throw new Error("TMT_JOB_ALREADY_ACTIVE");
    const plan = buildCandidatePlan(request, now, pointer.coverageThrough);
    await tx.execute("INSERT INTO standard_datasets (id,source,state,source_version) VALUES (?,'TMT','writing',?)", [request.id, version]);
    await tx.execute(
      `INSERT INTO tmt_candidate_jobs (dataset_id,base_dataset_id,base_generation,requested_by,mode,status,version,plan,checkpoint_results,seed_complete)
       VALUES (?,?,?,?,?,'queued',?,?,JSON_ARRAY(),?)`,
      [request.id, pointer.datasetId, pointer.generation, request.actor, request.mode, version, JSON.stringify(plan), Number(request.mode === "full")],
    );
    await auditCandidate(tx, request.actor, request.id, "tmt.candidate_queued", { mode: request.mode, version, checkpointCount: plan.length, baseId: pointer.datasetId });
    // Acknowledged dispatch before commit. A delivery that races this transaction retries the missing job.
    await dispatch(request.id, request.id + ":start");
    return request.id;
  });
}

export async function resumeTmtCandidate(pool: Pool, id: string, actor: string, source: TmtSyncSource, dispatch: CandidateDispatch) {
  const version = await source.version();
  await tmtTransaction(pool, async (tx) => {
    await lockTmtWriter(tx);
    const pointer = await readTmtPointer(tx, true);
    const job = await lockedJob(tx, id);
    await requireCandidateAdmin(tx, actor);
    if (!canResumeCandidate(job) || job.mode !== "full" && job.mode !== "incremental"
      || job.version !== version || !isPinnedTmtVersion(version) || pointer.datasetId !== job.base_dataset_id || pointer.generation !== Number(job.base_generation)
    ) throw new Error("TMT_JOB_NOT_RESUMABLE");
    const [conflicting] = await tx.execute<RowDataPacket[]>("SELECT dataset_id FROM tmt_candidate_jobs WHERE status IN ('queued','running') AND dataset_id<>? LIMIT 1 FOR UPDATE", [id]);
    if (conflicting.length) throw new Error("TMT_JOB_ALREADY_ACTIVE");
    await tx.execute("UPDATE tmt_candidate_jobs SET status='queued',attempts=0,lease_until=NULL,error_code=NULL,fence=fence+1 WHERE dataset_id=?", [id]);
    await auditCandidate(tx, actor, id, "tmt.candidate_resumed", { step: job.next_step });
    await dispatch(id, id + ":resume:" + (Number(job.fence) + 1));
  });
}

function canResumeCandidate(job: Pick<CandidateJob, "status" | "lease_live" | "recovery_due" | "error_code">) {
  if (job.error_code === RECOVERY) return false;
  return (job.status === "failed" && /^TMT_(?:RETRY_LIMIT|HTTP_429|HTTP_5\d\d|TIMEOUT)$/.test(job.error_code ?? ""))
    || (["queued", "running"].includes(job.status) && Number(job.lease_live) === 0 && Number(job.recovery_due) === 1);
}

function checkpointsComplete(job: CandidateJob, total: number) {
  const results = decodeJson(job.checkpoint_results);
  return Number(job.seed_complete) === 1 && Array.isArray(results) && results.length === total
    && results.every((result) => result?.status === "succeeded");
}

function canRevalidate(job: CandidateJob, total: number) {
  return job.status === "failed" && job.error_code === "TMT_CANDIDATE_INVARIANTS_FAILED"
    && ["full", "incremental"].includes(job.mode) && !Number(job.lease_live)
    && Number(job.next_step) === total + TMT_TABLES.length && checkpointsComplete(job, total);
}

async function storedCandidateManifests(tx: PoolConnection, id: string) {
  const [rows] = await tx.execute<RowDataPacket[]>("SELECT table_name,row_count,content_hash FROM standard_dataset_manifests WHERE dataset_id=?", [id]);
  if (rows.length !== TMT_TABLES.length || TMT_TABLES.some((t) => !rows.some((m) => m.table_name === t.targetTable))
    || rows.some((m) => !/^[0-9a-f]{64}$/.test(String(m.content_hash)) || Number(m.row_count) < 0)
    || rows.filter((m) => ["tmt_dataset_concepts", "tmt_dataset_tpu", "tmt_dataset_mastertmt"].includes(m.table_name)).some((m) => Number(m.row_count) <= 0)) {
    throw new Error("TMT_CANDIDATE_INCOMPLETE");
  }
  return rows.map((m) => ({ tableName: String(m.table_name), rowCount: Number(m.row_count), contentHash: String(m.content_hash) }));
}

export async function revalidateTmtCandidate(pool: Pool, id: string, actor: string, source: TmtSyncSource, dispatch: CandidateDispatch) {
  const version = await source.version();
  await tmtTransaction(pool, async (tx) => {
    await lockTmtWriter(tx);
    const pointer = await readTmtPointer(tx, true);
    const job = await lockedJob(tx, id);
    await requireCandidateAdmin(tx, actor);
    const plan = candidatePlanSchema.parse(decodeJson(job.plan));
    if (!canRevalidate(job, plan.length) || !isPinnedTmtVersion(version) || version !== job.version
      || pointer.datasetId !== job.base_dataset_id || pointer.generation !== Number(job.base_generation)) {
      throw new Error("TMT_JOB_NOT_REVALIDATABLE");
    }
    const end = plan.at(-1)!.window.enddate;
    const expected = buildCandidatePlan({ mode: job.mode === "full" ? "full" : "incremental", begin: plan[0].window.begindate, end },
      new Date(end + "T00:00:00+07:00"), pointer.coverageThrough ?? undefined);
    if (JSON.stringify(plan) !== JSON.stringify(expected)) throw new Error("TMT_CANDIDATE_INCOMPLETE");
    const [conflicting] = await tx.query<RowDataPacket[]>("SELECT dataset_id FROM tmt_candidate_jobs WHERE status IN ('queued','running') LIMIT 1 FOR UPDATE");
    if (conflicting.length) throw new Error("TMT_JOB_ALREADY_ACTIVE");
    const [dataset] = await tx.execute<RowDataPacket[]>(
      "SELECT id FROM standard_datasets WHERE id=? AND source='TMT' AND state='writing' AND content_hash IS NULL AND completed_at IS NULL AND source_version=? FOR UPDATE",
      [id, version],
    );
    if (dataset.length !== 1) throw new Error("TMT_CANDIDATE_INCOMPLETE");
    await storedCandidateManifests(tx, id);
    // Replay only the manifest steps as verification. Seed and API results stay intact.
    await tx.execute("UPDATE tmt_candidate_jobs SET status='queued',next_step=?,attempts=0,lease_until=NULL,error_code=?,fence=fence+1 WHERE dataset_id=?",
      [plan.length, RECOVERY, id]);
    await auditCandidate(tx, actor, id, "tmt.candidate_revalidation_queued", { version, baseId: pointer.datasetId, generation: pointer.generation });
    await dispatch(id, id + ":revalidate:" + (Number(job.fence) + 1));
  });
}

export async function readFailedCandidateDiagnostics(pool: Pool, id: string) {
  const [rows] = await pool.execute<CandidateJob[]>(
    "SELECT mode,base_dataset_id FROM tmt_candidate_jobs WHERE dataset_id=? AND status='failed' AND error_code='TMT_CANDIDATE_INVARIANTS_FAILED'", [id],
  );
  const job = rows[0];
  return job ? readCandidateInvariantReport(pool, id, job.mode === "incremental" ? job.base_dataset_id : undefined) : null;
}

async function readCandidateSeedProgress(pool: Pool, id: string) {
  // Seeding advances by destination row count in TMT_TABLES order. Read only the
  // selected candidate and reuse its immutable baseline manifest for totals.
  const counts = TMT_TABLES.map(({ targetTable }) =>
    `WHEN '${targetTable}' THEN (SELECT COUNT(*) FROM ${targetTable} WHERE dataset_id=j.dataset_id)`);
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT m.table_name,m.row_count,CASE m.table_name ${counts.join(" ")} END AS copied
     FROM tmt_candidate_jobs j JOIN standard_dataset_manifests m ON m.dataset_id=j.base_dataset_id
     WHERE j.dataset_id=? AND j.seed_complete=0 AND j.status IN ('queued','running')`, [id],
  );
  let copied = 0;
  let total = 0;
  let cursor: { table: string; offset: number } | null = null;
  for (const { targetTable } of TMT_TABLES) {
    const row = rows.find((entry) => entry.table_name === targetTable);
    if (!row) return null;
    const offset = Number(row.copied);
    const size = Number(row.row_count);
    if (offset > size) return null;
    copied += offset;
    total += size;
    if (!cursor && offset < size) cursor = { table: targetTable, offset };
  }
  return { copied, total, cursor };
}

export async function readCandidateOperations(pool: Pool) {
  const pointer = await readTmtPointer(pool);
  const [rows] = await pool.query<CandidateJob[]>(
    `SELECT j.*,COALESCE(j.lease_until>UTC_TIMESTAMP(3),0) AS lease_live,j.updated_at<UTC_TIMESTAMP(3)-INTERVAL 10 MINUTE AS recovery_due
     FROM tmt_candidate_jobs j ORDER BY created_at DESC,dataset_id DESC LIMIT 10`,
  );
  const [accepted] = await pool.query<RowDataPacket[]>(
    `SELECT a.dataset_id,a.assurance,d.source_version FROM tmt_candidate_acceptances a INNER JOIN standard_datasets d ON d.id=a.dataset_id
     WHERE d.source='TMT' AND d.state='validated' ORDER BY a.accepted_at DESC,a.dataset_id DESC LIMIT 10`,
  );
  const seeding = rows.find((job) => job.mode === "incremental" && !Number(job.seed_complete) && ["queued", "running"].includes(job.status));
  const seed = seeding ? await readCandidateSeedProgress(pool, seeding.dataset_id).catch(() => null) : null;
  return { pointer, jobs: rows.map((job) => {
    const plan = candidatePlanSchema.parse(decodeJson(job.plan));
    const nextStep = Number(job.next_step);
    const finished = Math.min(nextStep, plan.length);
    const leaseLive = Number(job.lease_live) === 1;
    const stage: "seed" | "checkpoints" | "manifest" | "validation" = !Number(job.seed_complete) ? "seed" : nextStep < plan.length ? "checkpoints"
      : nextStep < plan.length + TMT_TABLES.length ? "manifest" : "validation";
    const baseMatches = Number(job.base_generation) === pointer.generation && job.base_dataset_id === pointer.datasetId;
    const results = decodeJson(job.checkpoint_results);
    const checkpointWarnings = plan.flatMap((checkpoint, index) => {
      const result = Array.isArray(results) ? results[index] : null;
      return Number(result?.warnings) > 0 ? [{ ...checkpoint, count: Number(result.warnings), details: (result.warningDetails ?? []) as TmtDataWarning[] }] : [];
    });
    return {
      id: job.dataset_id, status: job.status, mode: job.mode, version: job.version, completed: finished, total: plan.length,
      received: Number(job.received_rows), written: Number(job.written_rows), warnings: Number(job.warnings_count),
      errorCode: job.error_code === RECOVERY ? null : job.error_code,
      revalidating: job.error_code === RECOVERY, revalidatable: baseMatches && canRevalidate(job, plan.length),
      manifestCompleted: Math.min(TMT_TABLES.length, Math.max(0, nextStep - plan.length)), manifestTotal: TMT_TABLES.length, checkpointWarnings,
      stage, seed: seeding?.dataset_id === job.dataset_id ? seed : null, nextStep,
      updatedAt: job.updated_at.toISOString(), attempts: Number(job.attempts), fence: Number(job.fence),
      leaseUntil: job.lease_until?.toISOString() ?? null, leaseLive,
      processing: leaseLive && stage === "checkpoints" ? plan[nextStep] ?? null : null,
      resumable: canResumeCandidate(job) && baseMatches,
      promotable: job.status === "validated" && baseMatches,
    };
  }), accepted: accepted.map((row) => ({ id: String(row.dataset_id), assurance: String(row.assurance), version: String(row.source_version) })) };
}

function errorCode(error: unknown): string {
  if (error instanceof RemoteResponseError) return `TMT_HTTP_${error.status}`;
  if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) return "TMT_TIMEOUT";
  if (error instanceof Error && /^TMT_[A-Z_]+$/.test(error.message)) return error.message;
  return "TMT_STEP_FAILED";
}

export async function processTmtCandidateDelivery(pool: Pool, id: string, source: TmtSyncSource, dispatch: CandidateDispatch) {
  const claim = await tmtTransaction(pool, async (tx) => {
    const pointer = await readTmtPointer(tx, true);
    const job = await lockedJob(tx, id);
    if (job.status !== "queued" && job.status !== "running") return null;
    if (Number(job.lease_live) === 1) throw new Error("TMT_WORKER_ALREADY_LEASED");
    if (pointer.datasetId !== job.base_dataset_id || pointer.generation !== Number(job.base_generation)) {
      await failJob(tx, job, "TMT_ACTIVE_DATASET_CHANGED", "stale");
      return null;
    }
    if (Number(job.attempts) >= MAX_STEP_ATTEMPTS) {
      await failJob(tx, job, job.error_code === RECOVERY ? "TMT_VALIDATION_RECOVERY_RETRY_LIMIT" : "TMT_RETRY_LIMIT", "failed");
      return null;
    }
    await tx.execute(
      "UPDATE tmt_candidate_jobs SET status='running',attempts=attempts+1,fence=fence+1,lease_until=TIMESTAMPADD(SECOND,?,UTC_TIMESTAMP(3)) WHERE dataset_id=?",
      [LEASE_SECONDS, id],
    );
    return { ...job, fence: Number(job.fence) + 1, attempts: Number(job.attempts) + 1 };
  });
  if (!claim) return "complete";

  const withFence = <T>(work: (tx: PoolConnection) => Promise<T>) => tmtTransaction(pool, async (tx) => {
    const pointer = await readTmtPointer(tx, true);
    const job = await lockedJob(tx, id);
    if (job.status !== "running" || Number(job.fence) !== claim.fence || Number(job.lease_live) !== 1) throw new Error("TMT_WORKER_FENCE_EXPIRED");
    if (pointer.datasetId !== job.base_dataset_id || pointer.generation !== Number(job.base_generation)) throw new Error("TMT_ACTIVE_DATASET_CHANGED");
    const outcome = await work(tx);
    const [committed] = await tx.execute<ResultSetHeader>(
      "UPDATE tmt_candidate_jobs SET lease_until=NULL WHERE dataset_id=? AND fence=? AND lease_until>UTC_TIMESTAMP(3)", [id, claim.fence],
    );
    if (committed.affectedRows !== 1) throw new Error("TMT_WORKER_FENCE_EXPIRED");
    return outcome;
  });

  let continued: boolean;
  try {
    const plan = candidatePlanSchema.parse(decodeJson(claim.plan));
    const step = Number(claim.next_step);
    const checkpoint = plan[step];
    const recovering = claim.error_code === RECOVERY;
    if (recovering && (step < plan.length || !checkpointsComplete(claim, plan.length))) throw new Error("TMT_CANDIDATE_INCOMPLETE");
    if (!Number(claim.seed_complete)) {
      await withFence(async (tx) => {
        const done = await seedTmtDatasetBatch(tx, claim.base_dataset_id, id);
        await tx.execute("UPDATE tmt_candidate_jobs SET status='queued',seed_complete=?,attempts=0 WHERE dataset_id=?", [Number(done), id]);
      });
      continued = true;
    } else if (checkpoint) {
      const rows = await source.fetch(checkpoint.endpoint, checkpoint.window);
      await withFence(async (tx) => {
        const result = await new TmtSyncRepository(pool).persistCandidateRows(tx, id, {
          runId: id, endpoint: checkpoint.endpoint, window: checkpoint.window, rows, version: claim.version, syncedAt: new Date(),
        });
        await tx.execute(
          `UPDATE tmt_candidate_jobs SET status='queued',next_step=next_step+1,attempts=0,received_rows=received_rows+?,written_rows=written_rows+?,
           warnings_count=warnings_count+?,checkpoint_results=JSON_ARRAY_APPEND(checkpoint_results,'$',CAST(? AS JSON)) WHERE dataset_id=?`,
          [result.receivedRows, result.writtenRows, result.warnings.length, JSON.stringify({
            status: "succeeded", received: result.receivedRows, written: result.writtenRows, warnings: result.warnings.length, attempts: claim.attempts,
            warningDetails: result.warnings.slice(0, 10),
          }), id],
        );
      });
      continued = true;
    } else if (step < plan.length + TMT_TABLES.length) {
      await withFence(async (tx) => {
        const manifest = await inspectTmtDatasetTable(tx, id, step - plan.length);
        if (recovering) {
          const stored = (await storedCandidateManifests(tx, id)).find((row) => row.tableName === manifest.tableName);
          if (stored?.rowCount !== manifest.rowCount || stored.contentHash !== manifest.contentHash) throw new Error("TMT_CANDIDATE_MANIFEST_MISMATCH");
        } else {
          await tx.execute("INSERT INTO standard_dataset_manifests (dataset_id,table_name,row_count,content_hash) VALUES (?,?,?,?)",
            [id, manifest.tableName, manifest.rowCount, manifest.contentHash]);
        }
        await tx.execute("UPDATE tmt_candidate_jobs SET status='queued',next_step=next_step+1,attempts=0 WHERE dataset_id=?", [id]);
      });
      continued = true;
    } else {
      if (await source.version() !== claim.version) throw new Error("TMT_VERSION_DRIFT");
      await withFence(async (tx) => {
        const [dataset] = await tx.execute<RowDataPacket[]>("SELECT id FROM standard_datasets WHERE id=? AND source='TMT' AND state='writing' FOR UPDATE", [id]);
        if (dataset.length !== 1 || !checkpointsComplete(claim, plan.length)
          || step !== plan.length + TMT_TABLES.length) throw new Error("TMT_CANDIDATE_INCOMPLETE");
        const report = await checkCandidateInvariants(tx, id, claim.mode === "incremental" ? claim.base_dataset_id : undefined);
        const hash = aggregateManifest(await storedCandidateManifests(tx, id));
        await tx.execute("UPDATE standard_datasets SET state='validated',content_hash=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [hash, id]);
        await tx.execute("UPDATE tmt_candidate_jobs SET status='validated',error_code=NULL WHERE dataset_id=?", [id]);
        await auditCandidate(tx, claim.requested_by, id, "tmt.candidate_validated", {
          version: claim.version, manifestHash: hash, checkpoints: plan.length, revalidated: recovering,
          inheritedRegNoGroups: typeof report.regno === "number" ? 0 : report.regno.unchanged,
        });
      });
      continued = false;
    }
  } catch (error) {
    const code = errorCode(error);
    if (code === "TMT_WORKER_FENCE_EXPIRED" || code === "TMT_ACTIVE_DATASET_CHANGED") throw error;
    const retryable = /^TMT_(?:HTTP_429|HTTP_5\d\d|TIMEOUT|STEP_FAILED)$/.test(code);
    const retry = retryable && claim.attempts < MAX_STEP_ATTEMPTS;
    await withFence(async (tx) => {
      if (retry) await tx.execute("UPDATE tmt_candidate_jobs SET status='queued',error_code=? WHERE dataset_id=?", [claim.error_code === RECOVERY ? RECOVERY : code, id]);
      else await failJob(tx, claim, claim.error_code === RECOVERY && retryable ? "TMT_VALIDATION_RECOVERY_RETRY_LIMIT" : code, code === "TMT_VERSION_DRIFT" ? "stale" : "failed");
    });
    if (retry) throw new Error("TMT_WORKER_RETRY");
    return "complete";
  }
  // Await next send before acknowledging this message. Redelivery can claim the next persisted step if send or ack was interrupted.
  if (continued) await dispatch(id, id + ":after:" + claim.fence);
  return continued ? "continued" : "complete";
}
