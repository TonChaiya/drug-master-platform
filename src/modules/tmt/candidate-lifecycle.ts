import { randomUUID } from "node:crypto";
import type { Pool, PoolConnection, RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { aggregateManifest, inspectLiveTmtDataset, inspectTmtDataset, latestRegNoConflictCount, versionedGpu764169Passed, versionedTmtInvariantCount } from "@/modules/standards/dataset-release-mysql";
import type { DatasetManifest } from "@/modules/standards/dataset-release";
import { TMT_TABLES } from "@/modules/standards/tmt-dataset-tables";
import { readTmtPointer, type TmtAssurance } from "./candidate-pointer";
import { readTmtV2Readiness } from "./readiness";
import { TMT_UNVERIFIED_REQUIRED_ENDPOINTS } from "./sync";
import { candidatePlanSchema } from "./candidate-plan";
import { partitionHistoricalWindows, TMT_HISTORY_START } from "./windows";

export async function tmtTransaction<T>(pool: Pool, work: (tx: PoolConnection) => Promise<T>): Promise<T> {
  const tx = await pool.getConnection();
  try {
    await tx.beginTransaction();
    const result = await work(tx);
    await tx.commit();
    return result;
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally { tx.release(); }
}

export async function requireCandidateAdmin(tx: PoolConnection, actor: string) {
  const [rows] = await tx.execute<RowDataPacket[]>("SELECT id FROM users WHERE id=? AND role='admin' AND status='active' FOR UPDATE", [actor]);
  if (rows.length !== 1) throw new Error("TMT_ADMIN_REQUIRED");
}

export async function auditCandidate(tx: PoolConnection, actor: string, datasetId: string, action: string, evidence: object) {
  await tx.execute("INSERT INTO audit_logs (id,actor_user_id,action,entity_type,entity_id,after_json) VALUES (?,?,?,'standard_dataset',?,?)",
    [randomUUID(), actor, action, datasetId, JSON.stringify(evidence)]);
}

export async function checkCandidateInvariants(tx: PoolConnection, id: string) {
  if (await versionedTmtInvariantCount(tx, id) !== 0 || !await versionedGpu764169Passed(tx, id) || await latestRegNoConflictCount(tx, id) !== 0) {
    throw new Error("TMT_CANDIDATE_INVARIANTS_FAILED");
  }
}

async function verifyTmtManifest(tx: PoolConnection, id: string, expected: string, inspect: boolean) {
  const [rows] = await tx.execute<RowDataPacket[]>("SELECT table_name,row_count,content_hash FROM standard_dataset_manifests WHERE dataset_id=?", [id]);
  const stored: DatasetManifest[] = rows.map((row) => ({ tableName: String(row.table_name), rowCount: Number(row.row_count), contentHash: String(row.content_hash) }));
  if (stored.length !== TMT_TABLES.length || TMT_TABLES.some((table) => !stored.some((entry) => entry.tableName === table.targetTable))
    || aggregateManifest(stored) !== expected) throw new Error("TMT_CANDIDATE_MANIFEST_MISMATCH");
  if (inspect && (await inspectTmtDataset(tx, id)).contentHash !== expected) throw new Error("TMT_CANDIDATE_MANIFEST_MISMATCH");
}

/** The 0014 journal row is the same lock acquired by the live CLI writer. */
export async function lockTmtWriter(tx: PoolConnection) {
  const [rows] = await tx.query<RowDataPacket[]>("SELECT filename FROM schema_migrations WHERE filename='0014_tmt_data_model_v2.sql' FOR UPDATE");
  if (rows.length !== 1) throw new Error("TMT_WRITER_LOCK_MISSING");
}

export async function activateTmtDataset(pool: Pool, request: {
  actor: string; datasetId: string; generation: number; action: "bootstrap" | "promote" | "rollback";
  /** For promotion only, a fresh observation obtained from the verified upstream API. */
  observedVersion?: string;
}) {
  return tmtTransaction(pool, async (tx) => {
    await lockTmtWriter(tx);
    const pointer = await readTmtPointer(tx, true);
    if (pointer.generation !== request.generation || pointer.datasetId === request.datasetId) throw new Error("TMT_ACTIVE_DATASET_CHANGED");
    await requireCandidateAdmin(tx, request.actor);
    const [targetRows] = await tx.execute<RowDataPacket[]>(
      "SELECT source,state,source_version,content_hash,tmt_sync_run_id FROM standard_datasets WHERE id=? FOR UPDATE", [request.datasetId],
    );
    const target = targetRows[0];
    if (!target || target.source !== "TMT" || target.state !== "validated" || !/^[0-9a-f]{64}$/.test(target.content_hash)) throw new Error("TMT_CANDIDATE_NOT_VALIDATED");
    const [acceptedRows] = await tx.execute<RowDataPacket[]>(
      "SELECT manifest_hash,assurance FROM tmt_candidate_acceptances WHERE dataset_id=? FOR UPDATE", [request.datasetId],
    );
    let assurance: TmtAssurance;
    let coverageThrough: string | undefined;
    if (request.action === "rollback") {
      if (!pointer.datasetId || acceptedRows[0]?.manifest_hash !== target.content_hash) throw new Error("TMT_ROLLBACK_TARGET_NOT_ACCEPTED");
      assurance = acceptedRows[0].assurance;
      if (assurance !== "verified" && assurance !== "validated_unverified") throw new Error("TMT_POINTER_EVIDENCE_INVALID");
    } else if (request.action === "bootstrap") {
      if (pointer.datasetId || acceptedRows.length !== 0) throw new Error("TMT_BOOTSTRAP_ALREADY_COMPLETE");
      const old = await readTmtV2Readiness(tx);
      if (!old.ready || old.run.id !== target.tmt_sync_run_id || old.run.tmtVersion !== target.source_version) throw new Error("TMT_BOOTSTRAP_EVIDENCE_MISMATCH");
      const [windows] = await tx.execute<RowDataPacket[]>(
        `SELECT endpoint,DATE_FORMAT(window_begin,'%Y-%m-%d') AS begindate,DATE_FORMAT(window_end,'%Y-%m-%d') AS enddate
         FROM tmt_sync_checkpoints WHERE run_id=? AND status='succeeded' ORDER BY endpoint,window_begin,window_end`, [old.run.id],
      );
      coverageThrough = TMT_UNVERIFIED_REQUIRED_ENDPOINTS.map((endpoint) => {
        const actual = windows.filter((window) => window.endpoint === endpoint);
        const through = actual.at(-1)?.enddate;
        if (!through) throw new Error("TMT_BASE_COVERAGE_REQUIRED");
        const expected = partitionHistoricalWindows(TMT_HISTORY_START, through);
        if (actual.length !== expected.length || expected.some((window, index) =>
          actual[index].begindate !== window.begindate || actual[index].enddate !== window.enddate
        )) throw new Error("TMT_BASE_COVERAGE_REQUIRED");
        return String(through);
      }).sort()[0];
      if ((await inspectLiveTmtDataset(tx)).contentHash !== target.content_hash) throw new Error("TMT_BOOTSTRAP_LIVE_DATA_CHANGED");
      assurance = old.assurance;
    } else {
      if (!pointer.datasetId || acceptedRows.length !== 0) throw new Error("TMT_PROMOTION_REQUIRED");
      const [jobs] = await tx.execute<RowDataPacket[]>("SELECT * FROM tmt_candidate_jobs WHERE dataset_id=? FOR UPDATE", [request.datasetId]);
      const job = jobs[0];
      if (!job || job.status !== "validated" || Number(job.base_generation) !== pointer.generation || job.base_dataset_id !== pointer.datasetId
        || job.version !== target.source_version || request.observedVersion !== job.version) throw new Error("TMT_CANDIDATE_VERSION_OR_BASE_CHANGED");
      const plan = candidatePlanSchema.parse(typeof job.plan === "string" ? JSON.parse(job.plan) : job.plan);
      coverageThrough = plan[0].window.enddate;
      for (const checkpoint of plan) if (checkpoint.window.enddate > coverageThrough) coverageThrough = checkpoint.window.enddate;
      assurance = job.mode === "incremental" && pointer.assurance === "validated_unverified" ? "validated_unverified" : "verified";
    }
    await verifyTmtManifest(tx, request.datasetId, target.content_hash, request.action === "bootstrap");
    if (coverageThrough) await tx.execute(
      "INSERT INTO tmt_candidate_acceptances (dataset_id,manifest_hash,assurance,coverage_through,accepted_by) VALUES (?,?,?,?,?)",
      [request.datasetId, target.content_hash, assurance, coverageThrough, request.actor],
    );
    const [updated] = await tx.execute<ResultSetHeader>(
      "UPDATE tmt_active_dataset SET dataset_id=?,generation=generation+1 WHERE singleton_id=1 AND generation=?",
      [request.datasetId, pointer.generation],
    );
    if (updated.affectedRows !== 1) throw new Error("TMT_ACTIVE_DATASET_CHANGED");
    await auditCandidate(tx, request.actor, request.datasetId, "tmt.dataset_" + request.action, {
      previousDatasetId: pointer.datasetId, generation: pointer.generation + 1, manifestHash: target.content_hash, assurance,
    });
    return { datasetId: request.datasetId, generation: pointer.generation + 1, assurance };
  });
}
