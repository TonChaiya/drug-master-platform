import { createHash } from "node:crypto";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { z } from "zod";
import { buildTmtInvariantReport, verifyTmtGpuAcceptance } from "./invariants";
import { TMT_UNVERIFIED_REQUIRED_ENDPOINTS } from "./sync";

export const VALIDATED_UNVERIFIED_POLICY_VERSION = "validated-unverified-v1";
export const TMT_SOURCE_VALIDATION_POLICY = "validated-unverified-v2";

const tmtEvidenceSchema = z.object({
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
}).strict();

const persistedEvidenceSchema = z.discriminatedUnion("policyVersion", [
  tmtEvidenceSchema.extend({ policyVersion: z.literal(TMT_SOURCE_VALIDATION_POLICY) }),
  tmtEvidenceSchema.extend({
    policyVersion: z.literal(VALIDATED_UNVERIFIED_POLICY_VERSION),
    ttmt: z.object({
    id: z.string().uuid(), version: z.string().min(1), contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    rowCount: z.number().int().positive(), status: z.literal("succeeded"), productCount: z.number().int().positive(),
    activeCount: z.number().int().nonnegative(), inactiveCount: z.number().int().nonnegative(),
    foreignProductCount: z.number().int().nonnegative(),
    }).strict(),
  }),
]);

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

type TmtSourceValidationInput = Omit<ValidatedUnverifiedInput, "ttmt">;
type TmtSourceValidationEvidence = Omit<TmtRunValidationEvidence, "policyVersion" | "ttmtImportId" | "ttmtContentHash" | "ttmtRowCount"> & {
  policyVersion: typeof TMT_SOURCE_VALIDATION_POLICY;
};

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

function assertHistoricalTtmtEvidence(input: ValidatedUnverifiedInput["ttmt"]): void {
  if (input.status !== "succeeded" || !input.version || !/^[a-f0-9]{64}$/.test(input.contentHash) || input.rowCount <= 0
    || input.productCount !== input.rowCount || input.activeCount !== input.rowCount
    || input.inactiveCount !== 0 || input.foreignProductCount !== 0) {
    fail("Historical TTMT import identity or product state does not match");
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

export function buildValidatedUnverifiedEvidence(input: ValidatedUnverifiedInput, validatedAt: Date): TmtRunValidationEvidence;
export function buildValidatedUnverifiedEvidence(input: TmtSourceValidationInput, validatedAt: Date): TmtSourceValidationEvidence;
export function buildValidatedUnverifiedEvidence(input: TmtSourceValidationInput | ValidatedUnverifiedInput, validatedAt: Date) {
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
  const tmtEvidence = {
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
  };
  const result = {
    runId: input.run.id,
    status: "passed" as const,
    validatedAt,
    requiredCheckpointCount: checkpoint.requiredCheckpointCount,
    requiredSucceededCount: checkpoint.requiredSucceededCount,
    optionalFailureCount: checkpoint.optionalFailureCount,
    blockingInvariantCount,
    gpu764169Passed: true as const,
  };
  const serialize = (evidence: object) => {
    const invariantEvidence = JSON.stringify(evidence);
    return { invariantEvidence, evidenceSha256: createHash("sha256").update(invariantEvidence).digest("hex") };
  };
  if ("ttmt" in input) {
    assertHistoricalTtmtEvidence(input.ttmt);
    const { id, version, contentHash, rowCount, status, productCount, activeCount, inactiveCount, foreignProductCount } = input.ttmt;
    return { ...result, ...serialize({ policyVersion: VALIDATED_UNVERIFIED_POLICY_VERSION, ...tmtEvidence,
      ttmt: { id, version, contentHash, rowCount, status, productCount, activeCount, inactiveCount, foreignProductCount } }),
      policyVersion: VALIDATED_UNVERIFIED_POLICY_VERSION, ttmtImportId: input.ttmt.id,
      ttmtContentHash: input.ttmt.contentHash, ttmtRowCount: input.ttmt.rowCount };
  }
  return { ...result, ...serialize({ policyVersion: TMT_SOURCE_VALIDATION_POLICY, ...tmtEvidence }),
    policyVersion: TMT_SOURCE_VALIDATION_POLICY };
}

export interface ValidatedUnverifiedRevalidationDependencies {
  load(runId: string): Promise<TmtSourceValidationInput>;
  save(evidence: TmtSourceValidationEvidence): Promise<void>;
  now(): Date;
}

export async function runValidatedUnverifiedRevalidation(
  input: { runId: string; execute: boolean },
  dependencies: ValidatedUnverifiedRevalidationDependencies,
) {
  const { run, checkpoints, blockingInvariants, gpu } = await dependencies.load(input.runId);
  const evidence = buildValidatedUnverifiedEvidence({ run, checkpoints, blockingInvariants, gpu }, dependencies.now());
  if (input.execute) await dependencies.save(evidence);
  return { ...evidence, executed: input.execute };
}

async function loadValidatedUnverifiedInput(connection: PoolConnection, runId: string): Promise<TmtSourceValidationInput> {
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
  };
}

async function saveEvidence(connection: PoolConnection, evidence: TmtSourceValidationEvidence): Promise<void> {
  const [existing] = await connection.execute<RowDataPacket[]>(
    "SELECT evidence_sha256 FROM tmt_run_validations WHERE run_id=? FOR UPDATE", [evidence.runId],
  );
  if (existing[0]) {
    if (existing[0].evidence_sha256 !== evidence.evidenceSha256) fail("TMT validation evidence for this run is immutable");
    return;
  }
  await connection.execute(
    `INSERT INTO tmt_run_validations
      (run_id,policy_version,status,validated_at,required_checkpoint_count,required_succeeded_count,
       optional_failure_count,blocking_invariant_count,invariant_evidence,gpu_764169_passed,
       evidence_sha256)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      evidence.runId, evidence.policyVersion, evidence.status, evidence.validatedAt,
      evidence.requiredCheckpointCount, evidence.requiredSucceededCount, evidence.optionalFailureCount,
      evidence.blockingInvariantCount, evidence.invariantEvidence, 1, evidence.evidenceSha256,
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
