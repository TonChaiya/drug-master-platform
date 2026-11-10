import { createHash } from "node:crypto";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { z } from "zod";
import { buildTmtInvariantReport, verifyTmtGpuAcceptance } from "./invariants";
import { TMT_UNVERIFIED_REQUIRED_ENDPOINTS } from "./sync";

export const VALIDATED_UNVERIFIED_POLICY_VERSION = "validated-unverified-v1";
export const APPROVED_TTMT_V1 = {
  version: "20261001",
  contentHash: "7be50149229747f2799039fbc27b0ae1cf19b6a16c40381355d40f36c6d19bf9",
  rowCount: 9_654,
} as const;

const persistedEvidenceSchema = z.object({
  policyVersion: z.literal(VALIDATED_UNVERIFIED_POLICY_VERSION),
  run: z.object({
    id: z.string().uuid(), mode: z.literal("full_unverified"), status: z.literal("unverified"),
    errorCode: z.literal("TMT_VERSION_UNVERIFIED"), tmtVersion: z.string().startsWith("unverified:"),
  }).strict(),
  checkpoints: z.array(z.object({
    endpoint: z.string().min(1), windowBegin: z.string().nullable(), windowEnd: z.string().nullable(),
    status: z.string().min(1), errorCode: z.string().nullable(),
    receivedRows: z.number().int().nonnegative().nullable(), writtenRows: z.number().int().nonnegative().nullable(),
  }).strict()),
  blockingInvariants: z.object({
    missingConceptCounterparts: z.number().int().nonnegative(),
    missingEndpointCounterparts: z.number().int().nonnegative(),
    levelMismatch: z.number().int().nonnegative(),
    masterTmtMissingTpu: z.number().int().nonnegative(),
    masterTmtMissingConcept: z.number().int().nonnegative(),
    tpuMissingMasterTmt: z.number().int().nonnegative(),
    unknownLevels: z.number().int().nonnegative(),
    duplicateRelationshipPairs: z.number().int().nonnegative(),
    unknownMasterStatuses: z.number().int().nonnegative(),
  }).strict(),
  gpu: z.object({
    code: z.literal("764169"), level: z.literal("gpu"), outboundTpu: z.number().int().positive(),
    relatedTpuPresent: z.number().int().nonnegative(), relatedMasterTmtPresent: z.number().int().nonnegative(),
    relatedConceptPresent: z.number().int().nonnegative(), activeMasterCount: z.number().int().positive(),
  }).strict(),
  ttmt: z.object({
    id: z.string().uuid(), version: z.string().min(1), contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    rowCount: z.number().int().positive(), status: z.literal("succeeded"), productCount: z.number().int().positive(),
    activeCount: z.number().int().nonnegative(), inactiveCount: z.number().int().nonnegative(),
    foreignProductCount: z.number().int().nonnegative(),
  }).strict(),
}).strict();

export function parseTmtValidationEvidence(raw: string) {
  try {
    const parsed = persistedEvidenceSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export interface ValidatedUnverifiedInput {
  run: { id: string; mode: string; status: string; errorCode: string | null; tmtVersion: string };
  checkpoints: Array<{
    endpoint: string;
    status: string;
    errorCode?: string | null;
    windowBegin?: string;
    windowEnd?: string;
    receivedRows?: number;
    writtenRows?: number;
  }>;
  blockingInvariants: {
    missingConceptCounterparts: number;
    missingEndpointCounterparts: number;
    levelMismatch: number;
    masterTmtMissingTpu: number;
    masterTmtMissingConcept: number;
    tpuMissingMasterTmt: number;
    unknownLevels: number;
    duplicateRelationshipPairs: number;
    unknownMasterStatuses: number;
  };
  gpu: {
    code: string;
    level: string | null;
    outboundTpu: number;
    relatedTpuPresent: number;
    relatedMasterTmtPresent: number;
    relatedConceptPresent: number;
    activeMasterCount: number;
  };
  ttmt: {
    id: string;
    version: string;
    contentHash: string;
    rowCount: number;
    status: string;
    productCount: number;
    activeCount: number;
    inactiveCount: number;
    foreignProductCount: number;
  };
}

export interface TmtRunValidationEvidence {
  runId: string;
  policyVersion: typeof VALIDATED_UNVERIFIED_POLICY_VERSION;
  status: "passed";
  validatedAt: Date;
  requiredCheckpointCount: number;
  requiredSucceededCount: number;
  optionalFailureCount: number;
  blockingInvariantCount: number;
  invariantEvidence: string;
  gpu764169Passed: true;
  ttmtImportId: string;
  ttmtContentHash: string;
  ttmtRowCount: number;
  evidenceSha256: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function assertRun(input: ValidatedUnverifiedInput["run"]): void {
  const marker = `unverified:${input.id.replaceAll("-", "").slice(0, 20)}`;
  if (input.mode !== "full_unverified" || input.status !== "unverified"
    || input.errorCode !== "TMT_VERSION_UNVERIFIED" || input.tmtVersion !== marker) {
    fail("Validated-unverified run identity is invalid");
  }
}

export function canonicalizeTmtValidationCheckpoints(checkpoints: ValidatedUnverifiedInput["checkpoints"]) {
  return [...checkpoints]
    .map((row) => ({
      endpoint: row.endpoint, windowBegin: row.windowBegin ?? null, windowEnd: row.windowEnd ?? null,
      status: row.status, errorCode: row.errorCode ?? null,
      receivedRows: row.receivedRows ?? null, writtenRows: row.writtenRows ?? null,
    }))
    .sort((left, right) => {
      const leftKey = `${left.endpoint}:${left.windowBegin ?? ""}:${left.windowEnd ?? ""}`;
      const rightKey = `${right.endpoint}:${right.windowBegin ?? ""}:${right.windowEnd ?? ""}`;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
}

function checkpointEvidence(checkpoints: ValidatedUnverifiedInput["checkpoints"]) {
  const required = new Set<string>(TMT_UNVERIFIED_REQUIRED_ENDPOINTS);
  const requiredRows = checkpoints.filter((row) => required.has(row.endpoint));
  for (const endpoint of required) {
    if (!requiredRows.some((row) => row.endpoint === endpoint)) fail(`Required checkpoint endpoint is missing: ${endpoint}`);
  }
  if (requiredRows.some((row) => row.status !== "succeeded")) fail("Every required checkpoint must be succeeded");

  const optionalRows = checkpoints.filter((row) => !required.has(row.endpoint));
  if (optionalRows.some((row) => row.endpoint !== "imagelist")) fail("Only the imagelist endpoint may be optional");
  if (!optionalRows.some((row) => row.endpoint === "imagelist")) fail("Imagelist checkpoint evidence is missing");
  if (optionalRows.some((row) => row.status !== "succeeded" && row.status !== "failed")) {
    fail("Optional imagelist checkpoints must be terminal");
  }
  return {
    requiredCheckpointCount: requiredRows.length,
    requiredSucceededCount: requiredRows.length,
    optionalFailureCount: optionalRows.filter((row) => row.status === "failed").length,
    checkpoints: canonicalizeTmtValidationCheckpoints(checkpoints),
  };
}

function assertTtmt(input: ValidatedUnverifiedInput["ttmt"]): void {
  if (input.status !== "succeeded" || input.version !== APPROVED_TTMT_V1.version
    || input.contentHash !== APPROVED_TTMT_V1.contentHash || input.rowCount !== APPROVED_TTMT_V1.rowCount
    || input.productCount !== APPROVED_TTMT_V1.rowCount || input.activeCount !== APPROVED_TTMT_V1.rowCount
    || input.inactiveCount !== 0 || input.foreignProductCount !== 0) {
    fail("Approved TTMT import identity or product state does not match");
  }
}

function assertGpu(input: ValidatedUnverifiedInput["gpu"]): void {
  const complete = input.code === "764169" && input.level === "gpu" && input.outboundTpu > 0
    && input.relatedTpuPresent === input.outboundTpu
    && input.relatedMasterTmtPresent === input.outboundTpu
    && input.relatedConceptPresent === input.outboundTpu
    && input.activeMasterCount > 0;
  if (!complete) fail("GPU 764169 acceptance failed");
}

export function buildValidatedUnverifiedEvidence(input: ValidatedUnverifiedInput, validatedAt: Date): TmtRunValidationEvidence {
  assertRun(input.run);
  const checkpoint = checkpointEvidence(input.checkpoints);
  const blockingInvariants = {
    missingConceptCounterparts: input.blockingInvariants.missingConceptCounterparts,
    missingEndpointCounterparts: input.blockingInvariants.missingEndpointCounterparts,
    levelMismatch: input.blockingInvariants.levelMismatch,
    masterTmtMissingTpu: input.blockingInvariants.masterTmtMissingTpu,
    masterTmtMissingConcept: input.blockingInvariants.masterTmtMissingConcept,
    tpuMissingMasterTmt: input.blockingInvariants.tpuMissingMasterTmt,
    unknownLevels: input.blockingInvariants.unknownLevels,
    duplicateRelationshipPairs: input.blockingInvariants.duplicateRelationshipPairs,
    unknownMasterStatuses: input.blockingInvariants.unknownMasterStatuses,
  };
  const blockingInvariantCount = Object.values(blockingInvariants).reduce((sum, count) => sum + count, 0);
  if (blockingInvariantCount !== 0) fail(`TMT blocking invariant validation failed with ${blockingInvariantCount} rows`);
  assertGpu(input.gpu);
  assertTtmt(input.ttmt);

  const evidence = {
    policyVersion: VALIDATED_UNVERIFIED_POLICY_VERSION,
    run: {
      id: input.run.id, mode: input.run.mode, status: input.run.status,
      errorCode: input.run.errorCode, tmtVersion: input.run.tmtVersion,
    },
    checkpoints: checkpoint.checkpoints,
    blockingInvariants,
    gpu: {
      code: input.gpu.code, level: input.gpu.level, outboundTpu: input.gpu.outboundTpu,
      relatedTpuPresent: input.gpu.relatedTpuPresent, relatedMasterTmtPresent: input.gpu.relatedMasterTmtPresent,
      relatedConceptPresent: input.gpu.relatedConceptPresent, activeMasterCount: input.gpu.activeMasterCount,
    },
    ttmt: {
      id: input.ttmt.id, version: input.ttmt.version, contentHash: input.ttmt.contentHash,
      rowCount: input.ttmt.rowCount, status: input.ttmt.status, productCount: input.ttmt.productCount,
      activeCount: input.ttmt.activeCount, inactiveCount: input.ttmt.inactiveCount,
      foreignProductCount: input.ttmt.foreignProductCount,
    },
  };
  const invariantEvidence = JSON.stringify(evidence);
  return {
    runId: input.run.id,
    policyVersion: VALIDATED_UNVERIFIED_POLICY_VERSION,
    status: "passed",
    validatedAt,
    requiredCheckpointCount: checkpoint.requiredCheckpointCount,
    requiredSucceededCount: checkpoint.requiredSucceededCount,
    optionalFailureCount: checkpoint.optionalFailureCount,
    blockingInvariantCount,
    invariantEvidence,
    gpu764169Passed: true,
    ttmtImportId: input.ttmt.id,
    ttmtContentHash: input.ttmt.contentHash,
    ttmtRowCount: input.ttmt.rowCount,
    evidenceSha256: createHash("sha256").update(invariantEvidence).digest("hex"),
  };
}

export interface ValidatedUnverifiedRevalidationDependencies {
  load(runId: string): Promise<ValidatedUnverifiedInput>;
  save(evidence: TmtRunValidationEvidence): Promise<void>;
  now(): Date;
}

export async function runValidatedUnverifiedRevalidation(
  input: { runId: string; execute: boolean },
  dependencies: ValidatedUnverifiedRevalidationDependencies,
) {
  const evidence = buildValidatedUnverifiedEvidence(await dependencies.load(input.runId), dependencies.now());
  if (input.execute) await dependencies.save(evidence);
  return { ...evidence, executed: input.execute };
}

async function loadValidatedUnverifiedInput(connection: PoolConnection, runId: string): Promise<ValidatedUnverifiedInput> {
  const [runRows] = await connection.query<RowDataPacket[]>(
    "SELECT id,mode,status,error_code,tmt_version FROM tmt_sync_runs WHERE id=? FOR UPDATE",
    [runId],
  );
  const run = runRows[0];
  if (!run) throw new Error("TMT sync run not found");
  const [checkpointRows] = await connection.query<RowDataPacket[]>(
    "SELECT endpoint,DATE_FORMAT(window_begin,'%Y-%m-%d') AS window_begin,DATE_FORMAT(window_end,'%Y-%m-%d') AS window_end,status,error_code,received_rows,written_rows FROM tmt_sync_checkpoints WHERE run_id=? ORDER BY endpoint,window_begin,window_end",
    [runId],
  );
  const invariants = await buildTmtInvariantReport(connection);
  const gpu = await verifyTmtGpuAcceptance(connection, "764169");
  const [ttmtRows] = await connection.query<RowDataPacket[]>(
    `SELECT i.id,i.version,i.content_hash,i.row_count,i.status,
      (SELECT COUNT(*) FROM ttmt_products) AS product_count,
      (SELECT COUNT(*) FROM ttmt_products p WHERE p.source_import_id=i.id AND p.status='active') AS active_count,
      (SELECT COUNT(*) FROM ttmt_products p WHERE p.source_import_id=i.id AND p.status<>'active') AS inactive_count,
      (SELECT COUNT(*) FROM ttmt_products p WHERE p.source_import_id<>i.id) AS foreign_product_count
     FROM ttmt_imports i WHERE i.version=? AND i.content_hash=? LIMIT 1`,
    [APPROVED_TTMT_V1.version, APPROVED_TTMT_V1.contentHash],
  );
  const ttmt = ttmtRows[0];
  if (!ttmt) throw new Error("Approved TTMT import is missing");
  return {
    run: {
      id: String(run.id), mode: String(run.mode), status: String(run.status),
      errorCode: run.error_code === null ? null : String(run.error_code), tmtVersion: String(run.tmt_version),
    },
    checkpoints: checkpointRows.map((row) => ({
      endpoint: String(row.endpoint), status: String(row.status),
      errorCode: row.error_code === null ? null : String(row.error_code),
      windowBegin: String(row.window_begin), windowEnd: String(row.window_end),
      receivedRows: Number(row.received_rows), writtenRows: Number(row.written_rows),
    })),
    blockingInvariants: {
      missingConceptCounterparts: invariants.missingConceptCounterparts.count,
      missingEndpointCounterparts: invariants.missingEndpointCounterparts.count,
      levelMismatch: invariants.levelMismatch.count,
      masterTmtMissingTpu: invariants.masterTmtMissingTpu.count,
      masterTmtMissingConcept: invariants.masterTmtMissingConcept.count,
      tpuMissingMasterTmt: invariants.tpuMissingMasterTmt.count,
      unknownLevels: invariants.unknownLevels.count,
      duplicateRelationshipPairs: invariants.duplicateRelationshipPairs.count,
      unknownMasterStatuses: invariants.unknownMasterStatuses.count,
    },
    gpu: {
      code: "764169", level: gpu.concept?.levelName ?? null, outboundTpu: gpu.outboundTpu,
      relatedTpuPresent: gpu.relatedTpuPresent, relatedMasterTmtPresent: gpu.relatedMasterTmtPresent,
      relatedConceptPresent: gpu.relatedConceptPresent,
      activeMasterCount: gpu.masterStatuses.filter((row) => row.status === 0).length,
    },
    ttmt: {
      id: String(ttmt.id), version: String(ttmt.version), contentHash: String(ttmt.content_hash),
      rowCount: Number(ttmt.row_count), status: String(ttmt.status), productCount: Number(ttmt.product_count),
      activeCount: Number(ttmt.active_count), inactiveCount: Number(ttmt.inactive_count),
      foreignProductCount: Number(ttmt.foreign_product_count),
    },
  };
}

async function saveEvidence(connection: PoolConnection, evidence: TmtRunValidationEvidence): Promise<void> {
  await connection.execute(
    `INSERT INTO tmt_run_validations
      (run_id,policy_version,status,validated_at,required_checkpoint_count,required_succeeded_count,
       optional_failure_count,blocking_invariant_count,invariant_evidence,gpu_764169_passed,
       ttmt_import_id,ttmt_content_hash,ttmt_row_count,evidence_sha256)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       policy_version=VALUES(policy_version),status=VALUES(status),validated_at=VALUES(validated_at),
       required_checkpoint_count=VALUES(required_checkpoint_count),required_succeeded_count=VALUES(required_succeeded_count),
       optional_failure_count=VALUES(optional_failure_count),blocking_invariant_count=VALUES(blocking_invariant_count),
       invariant_evidence=VALUES(invariant_evidence),gpu_764169_passed=VALUES(gpu_764169_passed),
       ttmt_import_id=VALUES(ttmt_import_id),ttmt_content_hash=VALUES(ttmt_content_hash),
       ttmt_row_count=VALUES(ttmt_row_count),evidence_sha256=VALUES(evidence_sha256)`,
    [
      evidence.runId, evidence.policyVersion, evidence.status, evidence.validatedAt,
      evidence.requiredCheckpointCount, evidence.requiredSucceededCount, evidence.optionalFailureCount,
      evidence.blockingInvariantCount, evidence.invariantEvidence, 1, evidence.ttmtImportId,
      evidence.ttmtContentHash, evidence.ttmtRowCount, evidence.evidenceSha256,
    ],
  );
}

export async function revalidateTmtRun(
  pool: Pool,
  input: { runId: string; execute: boolean; now?: () => Date },
) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await runValidatedUnverifiedRevalidation(input, {
      load: (runId) => loadValidatedUnverifiedInput(connection, runId),
      save: (evidence) => saveEvidence(connection, evidence),
      now: input.now ?? (() => new Date()),
    });
    if (input.execute) await connection.commit();
    else await connection.rollback();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
