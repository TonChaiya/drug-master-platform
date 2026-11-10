import { createHash } from "node:crypto";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { dbPool } from "@/db/client";
import { TMT_UNVERIFIED_REQUIRED_ENDPOINTS } from "./sync";
import { canonicalizeTmtValidationCheckpoints, parseTmtValidationEvidence, VALIDATED_UNVERIFIED_POLICY_VERSION } from "./validation";

export interface TmtReadinessRun {
  id: string;
  mode: string;
  status: string;
  errorCode: string | null;
  tmtVersion: string;
}

export interface TmtReadinessValidation {
  runId: string;
  policyVersion: string;
  status: string;
  requiredCheckpointCount: number;
  requiredSucceededCount: number;
  optionalFailureCount: number;
  blockingInvariantCount: number;
  invariantEvidence: string;
  gpu764169Passed: boolean;
  ttmtImportId: string;
  ttmtContentHash: string;
  ttmtRowCount: number;
  evidenceSha256: string;
  currentRequiredCheckpointCount: number;
  currentRequiredSucceededCount: number;
  disallowedCheckpointCount: number;
  nonterminalOptionalCheckpointCount: number;
  currentOptionalCheckpointCount: number;
  currentOptionalFailureCount: number;
  ttmtStatus: string | null;
  currentTtmtContentHash: string | null;
  currentTtmtRowCount: number | null;
  currentTtmtProductCount: number;
  currentTtmtForeignProductCount: number;
  checkpointEvidenceMatches: boolean;
  evidenceIdentityMatches: boolean;
}

export type TmtV2Readiness =
  | { ready: true; reason: null; assurance: "verified" | "validated_unverified"; run: TmtReadinessRun }
  | { ready: false; reason: "RUN_MISSING" | "RUN_UNVERIFIED" | "RUN_NOT_SUCCEEDED"; assurance: null; run: TmtReadinessRun | null };

export class TmtV2NotReadyError extends Error {
  readonly code = "TMT_V2_NOT_READY";
  constructor(readonly readiness: TmtV2Readiness) {
    super(`TMT v2 is not ready: ${readiness.reason ?? "unknown"}`);
    this.name = "TmtV2NotReadyError";
  }
}

function validationMatches(run: TmtReadinessRun, validation: TmtReadinessValidation | null | undefined): boolean {
  if (!validation) return false;
  const marker = `unverified:${run.id.replaceAll("-", "").slice(0, 20)}`;
  return run.mode === "full_unverified" && run.status === "unverified"
    && run.errorCode === "TMT_VERSION_UNVERIFIED" && run.tmtVersion === marker
    && validation.runId === run.id && validation.policyVersion === VALIDATED_UNVERIFIED_POLICY_VERSION
    && validation.status === "passed" && validation.requiredCheckpointCount > 0
    && validation.requiredCheckpointCount === validation.requiredSucceededCount
    && validation.currentRequiredCheckpointCount === validation.requiredCheckpointCount
    && validation.currentRequiredSucceededCount === validation.requiredSucceededCount
    && validation.disallowedCheckpointCount === 0 && validation.nonterminalOptionalCheckpointCount === 0
    && validation.currentOptionalCheckpointCount > 0
    && validation.currentOptionalFailureCount === validation.optionalFailureCount
    && validation.checkpointEvidenceMatches
    && validation.evidenceIdentityMatches
    && validation.blockingInvariantCount === 0 && validation.gpu764169Passed
    && validation.ttmtStatus === "succeeded"
    && validation.currentTtmtContentHash === validation.ttmtContentHash
    && validation.currentTtmtRowCount === validation.ttmtRowCount
    && validation.currentTtmtProductCount === validation.ttmtRowCount
    && validation.currentTtmtForeignProductCount === 0
    && createHash("sha256").update(validation.invariantEvidence).digest("hex") === validation.evidenceSha256;
}

export function evaluateTmtV2Readiness(run: TmtReadinessRun | null, validation?: TmtReadinessValidation | null): TmtV2Readiness {
  if (!run) return { ready: false, reason: "RUN_MISSING", assurance: null, run: null };
  if (run.mode === "full_unverified" || run.tmtVersion.startsWith("unverified:")) {
    return validationMatches(run, validation)
      ? { ready: true, reason: null, assurance: "validated_unverified", run }
      : { ready: false, reason: "RUN_UNVERIFIED", assurance: null, run };
  }
  if (run.status !== "succeeded") return { ready: false, reason: "RUN_NOT_SUCCEEDED", assurance: null, run };
  return { ready: true, reason: null, assurance: "verified", run };
}

export async function readTmtV2Readiness(pool: Pick<Pool, "query"> = dbPool()): Promise<TmtV2Readiness> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id,mode,status,error_code,tmt_version FROM tmt_sync_runs ORDER BY started_at DESC,created_at DESC,id DESC LIMIT 1",
  );
  const row = rows[0];
  if (!row) return evaluateTmtV2Readiness(null);
  const run: TmtReadinessRun = {
    id: String(row.id), mode: String(row.mode), status: String(row.status),
    errorCode: row.error_code === null ? null : String(row.error_code), tmtVersion: String(row.tmt_version),
  };
  if (run.mode !== "full_unverified" && !run.tmtVersion.startsWith("unverified:")) return evaluateTmtV2Readiness(run);

  const [validationRows] = await pool.query<RowDataPacket[]>(
    `SELECT v.*,i.status AS ttmt_status,i.content_hash AS current_ttmt_content_hash,i.row_count AS current_ttmt_row_count,
      (SELECT COUNT(*) FROM ttmt_products) AS current_ttmt_product_count,
      (SELECT COUNT(*) FROM ttmt_products p WHERE p.source_import_id<>v.ttmt_import_id) AS current_ttmt_foreign_product_count
     FROM tmt_run_validations v LEFT JOIN ttmt_imports i ON i.id=v.ttmt_import_id WHERE v.run_id=? LIMIT 1`,
    [run.id],
  );
  const validationRow = validationRows[0];
  if (!validationRow) return evaluateTmtV2Readiness(run, null);
  const [checkpointRows] = await pool.query<RowDataPacket[]>(
    "SELECT endpoint,DATE_FORMAT(window_begin,'%Y-%m-%d') AS window_begin,DATE_FORMAT(window_end,'%Y-%m-%d') AS window_end,status,error_code,received_rows,written_rows FROM tmt_sync_checkpoints WHERE run_id=? ORDER BY endpoint,window_begin,window_end",
    [run.id],
  );
  const required = new Set<string>(TMT_UNVERIFIED_REQUIRED_ENDPOINTS);
  const currentRequired = checkpointRows.filter((checkpoint) => required.has(String(checkpoint.endpoint)));
  const disallowed = checkpointRows.filter((checkpoint) => !required.has(String(checkpoint.endpoint)) && String(checkpoint.endpoint) !== "imagelist");
  const currentOptional = checkpointRows.filter((checkpoint) => String(checkpoint.endpoint) === "imagelist");
  const nonterminalOptional = checkpointRows.filter((checkpoint) => String(checkpoint.endpoint) === "imagelist" && !["succeeded", "failed"].includes(String(checkpoint.status)));
  const storedEvidence = parseTmtValidationEvidence(String(validationRow.invariant_evidence));
  const storedCheckpoints = storedEvidence?.checkpoints ?? null;
  const currentCheckpointEvidence = canonicalizeTmtValidationCheckpoints(checkpointRows.map((checkpoint) => ({
    endpoint: String(checkpoint.endpoint), status: String(checkpoint.status),
    errorCode: checkpoint.error_code === null ? null : String(checkpoint.error_code),
    windowBegin: String(checkpoint.window_begin), windowEnd: String(checkpoint.window_end),
    receivedRows: Number(checkpoint.received_rows), writtenRows: Number(checkpoint.written_rows),
  })));
  return evaluateTmtV2Readiness(run, {
    runId: String(validationRow.run_id), policyVersion: String(validationRow.policy_version), status: String(validationRow.status),
    requiredCheckpointCount: Number(validationRow.required_checkpoint_count), requiredSucceededCount: Number(validationRow.required_succeeded_count),
    optionalFailureCount: Number(validationRow.optional_failure_count), blockingInvariantCount: Number(validationRow.blocking_invariant_count),
    invariantEvidence: String(validationRow.invariant_evidence), gpu764169Passed: Number(validationRow.gpu_764169_passed) === 1,
    ttmtImportId: String(validationRow.ttmt_import_id), ttmtContentHash: String(validationRow.ttmt_content_hash),
    ttmtRowCount: Number(validationRow.ttmt_row_count), evidenceSha256: String(validationRow.evidence_sha256),
    currentRequiredCheckpointCount: currentRequired.length,
    currentRequiredSucceededCount: currentRequired.filter((checkpoint) => String(checkpoint.status) === "succeeded").length,
    disallowedCheckpointCount: disallowed.length, nonterminalOptionalCheckpointCount: nonterminalOptional.length,
    currentOptionalCheckpointCount: currentOptional.length,
    currentOptionalFailureCount: currentOptional.filter((checkpoint) => String(checkpoint.status) === "failed").length,
    ttmtStatus: validationRow.ttmt_status === null ? null : String(validationRow.ttmt_status),
    currentTtmtContentHash: validationRow.current_ttmt_content_hash === null ? null : String(validationRow.current_ttmt_content_hash),
    currentTtmtRowCount: validationRow.current_ttmt_row_count === null ? null : Number(validationRow.current_ttmt_row_count),
    currentTtmtProductCount: Number(validationRow.current_ttmt_product_count),
    currentTtmtForeignProductCount: Number(validationRow.current_ttmt_foreign_product_count),
    checkpointEvidenceMatches: JSON.stringify(storedCheckpoints) === JSON.stringify(currentCheckpointEvidence),
    evidenceIdentityMatches: storedEvidence !== null
      && storedEvidence.run.id === run.id
      && storedEvidence.run.tmtVersion === run.tmtVersion
      && storedEvidence.ttmt.id === String(validationRow.ttmt_import_id)
      && storedEvidence.ttmt.contentHash === String(validationRow.ttmt_content_hash)
      && storedEvidence.ttmt.rowCount === Number(validationRow.ttmt_row_count),
  });
}

export async function requireTmtV2Ready(pool: Pick<Pool, "query"> = dbPool()): Promise<void> {
  const readiness = await readTmtV2Readiness(pool);
  if (!readiness.ready) throw new TmtV2NotReadyError(readiness);
}
