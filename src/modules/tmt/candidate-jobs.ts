import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { aggregateManifest, inspectTmtDatasetTable, seedTmtDatasetBatch } from "@/modules/standards/dataset-release-mysql";
import { TMT_TABLES } from "@/modules/standards/tmt-dataset-tables";
import { RemoteResponseError } from "@/modules/standards/tmt-client";
import { buildCandidatePlan, candidatePlanSchema, isPinnedTmtVersion, type CandidateRequest } from "./candidate-plan";
import { auditCandidate, checkCandidateInvariants, lockTmtWriter, requireCandidateAdmin, tmtTransaction } from "./candidate-lifecycle";
import { readTmtPointer } from "./candidate-pointer";
import { TmtSyncRepository } from "./persistence";
import type { TmtSyncSource } from "./sync";

const MAX_STEP_ATTEMPTS = 4;
const LEASE_SECONDS = 270;
type CandidateDispatch = (id: string, deliveryKey: string) => Promise<void>;
type CandidateJob = RowDataPacket & {
  dataset_id: string; base_dataset_id: string; base_generation: number; requested_by: string;
  version: string; status: string; mode: string; plan: unknown; checkpoint_results: unknown; next_step: number;
  seed_complete: number; attempts: number; fence: number; lease_live: number; recovery_due: number; error_code: string | null;
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
  return (job.status === "failed" && /^TMT_(?:RETRY_LIMIT|HTTP_429|HTTP_5\d\d|TIMEOUT)$/.test(job.error_code ?? ""))
    || (["queued", "running"].includes(job.status) && Number(job.lease_live) === 0 && Number(job.recovery_due) === 1);
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
  return { pointer, jobs: rows.map((job) => {
    const plan = candidatePlanSchema.parse(decodeJson(job.plan));
    const finished = Math.min(Number(job.next_step), plan.length);
    const leaseLive = Number(job.lease_live) === 1;
    return {
      id: job.dataset_id, status: job.status, mode: job.mode, version: job.version, completed: finished, total: plan.length,
      received: Number(job.received_rows), written: Number(job.written_rows), warnings: Number(job.warnings_count), errorCode: job.error_code,
      processing: leaseLive && Number(job.seed_complete) === 1 ? plan[job.next_step] ?? null : null,
      resumable: canResumeCandidate(job) && Number(job.base_generation) === pointer.generation && job.base_dataset_id === pointer.datasetId,
      promotable: job.status === "validated" && Number(job.base_generation) === pointer.generation && job.base_dataset_id === pointer.datasetId,
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
      await failJob(tx, job, "TMT_RETRY_LIMIT", "failed");
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
          }), id],
        );
      });
      continued = true;
    } else if (step < plan.length + TMT_TABLES.length) {
      await withFence(async (tx) => {
        const manifest = await inspectTmtDatasetTable(tx, id, step - plan.length);
        await tx.execute("INSERT INTO standard_dataset_manifests (dataset_id,table_name,row_count,content_hash) VALUES (?,?,?,?)",
          [id, manifest.tableName, manifest.rowCount, manifest.contentHash]);
        await tx.execute("UPDATE tmt_candidate_jobs SET status='queued',next_step=next_step+1,attempts=0 WHERE dataset_id=?", [id]);
      });
      continued = true;
    } else {
      if (await source.version() !== claim.version) throw new Error("TMT_VERSION_DRIFT");
      await withFence(async (tx) => {
        const [dataset] = await tx.execute<RowDataPacket[]>("SELECT id FROM standard_datasets WHERE id=? AND source='TMT' AND state='writing' FOR UPDATE", [id]);
        const results = decodeJson(claim.checkpoint_results);
        if (dataset.length !== 1 || !Array.isArray(results) || results.length !== plan.length || results.some((r) => r?.status !== "succeeded")) throw new Error("TMT_CANDIDATE_INCOMPLETE");
        await checkCandidateInvariants(tx, id);
        const [manifests] = await tx.execute<RowDataPacket[]>("SELECT table_name,row_count,content_hash FROM standard_dataset_manifests WHERE dataset_id=?", [id]);
        if (manifests.length !== TMT_TABLES.length || TMT_TABLES.some((t) => !manifests.some((m) => m.table_name === t.targetTable))
          || manifests.filter((m) => ["tmt_dataset_concepts", "tmt_dataset_tpu", "tmt_dataset_mastertmt"].includes(m.table_name)).some((m) => Number(m.row_count) <= 0)) {
          throw new Error("TMT_CANDIDATE_INCOMPLETE");
        }
        const hash = aggregateManifest(manifests.map((m) => ({ tableName: String(m.table_name), rowCount: Number(m.row_count), contentHash: String(m.content_hash) })));
        await tx.execute("UPDATE standard_datasets SET state='validated',content_hash=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [hash, id]);
        await tx.execute("UPDATE tmt_candidate_jobs SET status='validated',error_code=NULL WHERE dataset_id=?", [id]);
        await auditCandidate(tx, claim.requested_by, id, "tmt.candidate_validated", { version: claim.version, manifestHash: hash, checkpoints: plan.length });
      });
      continued = false;
    }
  } catch (error) {
    const code = errorCode(error);
    if (code === "TMT_WORKER_FENCE_EXPIRED" || code === "TMT_ACTIVE_DATASET_CHANGED") throw error;
    const retryable = /^TMT_(?:HTTP_429|HTTP_5\d\d|TIMEOUT|STEP_FAILED)$/.test(code);
    const retry = retryable && claim.attempts < MAX_STEP_ATTEMPTS;
    await withFence(async (tx) => {
      if (retry) await tx.execute("UPDATE tmt_candidate_jobs SET status='queued',error_code=? WHERE dataset_id=?", [code, id]);
      else await failJob(tx, claim, code, code === "TMT_VERSION_DRIFT" ? "stale" : "failed");
    });
    if (retry) throw new Error("TMT_WORKER_RETRY");
    return "complete";
  }
  // Await next send before acknowledging this message. Redelivery can claim the next persisted step if send or ack was interrupted.
  if (continued) await dispatch(id, id + ":after:" + claim.fence);
  return continued ? "continued" : "complete";
}
