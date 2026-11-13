import { createHash } from "node:crypto";
import { z } from "zod";
import { ACTIVE_STANDARD_RELEASE_POINTER_KEY } from "./active-release";
import { parseTmtValidationEvidence, VALIDATED_UNVERIFIED_POLICY_VERSION } from "@/modules/tmt/validation";
import { TMT_UNVERIFIED_REQUIRED_ENDPOINTS } from "@/modules/tmt/sync";

export type StandardDatasetSource = "TMT" | "TTMT";
export type StandardDatasetState = "pending" | "writing" | "validated" | "failed";

export interface DatasetManifest {
  tableName: string;
  rowCount: number;
  contentHash: string;
}

export interface DatasetInspection {
  contentHash: string;
  manifests: DatasetManifest[];
}

export interface StandardDatasetRecord {
  id: string;
  source: StandardDatasetSource;
  state: StandardDatasetState;
  sourceVersion: string;
  contentHash: string | null;
  tmtSyncRunId: string | null;
  ttmtImportId: string | null;
}

export interface BaselineStore {
  readCandidate(datasetId: string): Promise<StandardDatasetRecord | null>;
  inspectLiveSource(source: StandardDatasetSource, batchSize: number): Promise<DatasetInspection>;
  createCandidate(input: {
    datasetId: string;
    source: StandardDatasetSource;
    sourceVersion: string;
    contentHash: string;
    tmtSyncRunId: string | null;
    ttmtImportId: string | null;
  }): Promise<void>;
  copyNextBatch(input: { datasetId: string; source: StandardDatasetSource; batchSize: number }): Promise<{ copiedRows: number; complete: boolean }>;
  inspectVersionedDataset(datasetId: string, source: StandardDatasetSource, batchSize: number): Promise<DatasetInspection>;
  completeCandidate(input: { datasetId: string; inspection: DatasetInspection }): Promise<void>;
  failCandidate(input: { datasetId: string; errorCode: string }): Promise<void>;
}

export interface ReleaseValidationBundle {
  tmtDataset: StandardDatasetRecord;
  ttmtDataset: StandardDatasetRecord;
  tmtManifestValid: boolean;
  ttmtManifestValid: boolean;
  regNoConflictCount: number;
  versionedBlockingInvariantCount: number;
  versionedGpu764169Passed: boolean;
  tmtForeignVersionRowCount: number;
  checkpointEvidenceMatches: boolean;
  currentRequiredCheckpointCount: number;
  currentRequiredSucceededCount: number;
  currentOptionalFailureCount: number;
  disallowedCheckpointCount: number;
  nonterminalOptionalCheckpointCount: number;
  ttmtDatasetRowCount: number;
  ttmtForeignImportRowCount: number;
  run: { id: string; mode: string; status: string; errorCode: string | null; tmtVersion: string };
  validation: {
    runId: string;
    policyVersion: string;
    status: string;
    requiredCheckpointCount: number;
    requiredSucceededCount: number;
    optionalFailureCount: number;
    blockingInvariantCount: number;
    gpu764169Passed: boolean;
    invariantEvidence: string;
    evidenceSha256: string;
    ttmtImportId: string;
    ttmtContentHash: string;
    ttmtRowCount: number;
  };
  ttmtImport: { id: string; version: string; status: string; contentHash: string; rowCount: number };
}

export interface StandardReleaseRecord {
  id: string;
  state: string;
  tmtDatasetId: string;
  ttmtDatasetId: string;
  validationEvidenceSha256: string | null;
  approvedAt: Date | null;
  supersededAt: Date | null;
}

export interface ReleaseLifecycleStore {
  transaction<T>(work: (store: ReleaseLifecycleStore) => Promise<T>): Promise<T>;
  loadValidationBundle(tmtDatasetId: string, ttmtDatasetId: string): Promise<ReleaseValidationBundle>;
  createReleaseCandidate(input: {
    releaseId: string;
    tmtDatasetId: string;
    ttmtDatasetId: string;
    validationRunId: string;
    validationEvidenceSha256: string;
  }): Promise<void>;
  loadRelease(releaseId: string): Promise<StandardReleaseRecord | null>;
  approveRelease(releaseId: string, approvedAt: Date): Promise<void>;
  lockActivePointer(pointerKey: string): Promise<string | null>;
  switchActivePointer(input: { pointerKey: string; releaseId: string; previousReleaseId: string | null; switchedAt: Date }): Promise<void>;
  recordAudit(input: {
    action: "standard_release.candidate_validated" | "standard_release.approved" | "standard_release.published" | "standard_release.rolled_back";
    releaseId: string;
    actorUserId: string | null;
    beforeReleaseId?: string | null;
    afterReleaseId?: string | null;
    assurance?: "validated_unverified";
  }): Promise<void>;
}

export class DatasetReleaseError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "DatasetReleaseError";
  }
}

const baselineInputSchema = z.object({
  datasetId: z.string().uuid(),
  source: z.enum(["TMT", "TTMT"]),
  sourceVersion: z.string().trim().min(1).max(120),
  tmtSyncRunId: z.string().uuid().optional(),
  ttmtImportId: z.string().uuid().optional(),
  batchSize: z.number().int().min(1).max(5_000).default(500),
}).strict().superRefine((input, context) => {
  const validLink = input.source === "TMT"
    ? Boolean(input.tmtSyncRunId) && !input.ttmtImportId
    : Boolean(input.ttmtImportId) && !input.tmtSyncRunId;
  if (!validLink) context.addIssue({ code: "custom", message: "Dataset must reference exactly one matching source run or import" });
});

const candidateInputSchema = z.object({
  releaseId: z.string().uuid(),
  tmtDatasetId: z.string().uuid(),
  ttmtDatasetId: z.string().uuid(),
  actorUserId: z.string().uuid().nullable().optional(),
}).strict();

const approvalInputSchema = z.object({
  releaseId: z.string().uuid(),
  approvedAt: z.date().optional(),
  actorUserId: z.string().uuid().nullable().optional(),
}).strict();

const switchInputSchema = z.object({
  releaseId: z.string().uuid(),
  expectedActiveReleaseId: z.string().uuid().nullable(),
  switchedAt: z.date().optional(),
  actorUserId: z.string().uuid().nullable().optional(),
}).strict();

function sameInspection(left: DatasetInspection, right: DatasetInspection): boolean {
  return left.contentHash === right.contentHash
    && JSON.stringify(left.manifests) === JSON.stringify(right.manifests);
}

function assertCandidateIdentity(
  candidate: StandardDatasetRecord,
  input: z.infer<typeof baselineInputSchema>,
): void {
  const matches = candidate.id === input.datasetId
    && candidate.source === input.source
    && candidate.sourceVersion === input.sourceVersion
    && candidate.tmtSyncRunId === (input.tmtSyncRunId ?? null)
    && candidate.ttmtImportId === (input.ttmtImportId ?? null);
  if (!matches) throw new DatasetReleaseError("Baseline candidate identity does not match the requested source", "BASELINE_IDENTITY_MISMATCH");
  if (candidate.state === "failed") throw new DatasetReleaseError("Failed baseline candidates are immutable", "BASELINE_FAILED");
}

export async function prepareBaselineDataset(
  rawInput: z.input<typeof baselineInputSchema>,
  store: BaselineStore,
): Promise<DatasetInspection> {
  const input = baselineInputSchema.parse(rawInput);
  let candidate = await store.readCandidate(input.datasetId);
  if (candidate) {
    assertCandidateIdentity(candidate, input);
    if (candidate.state === "validated") {
      const target = await store.inspectVersionedDataset(input.datasetId, input.source, input.batchSize);
      if (!candidate.contentHash || candidate.contentHash !== target.contentHash) {
        throw new DatasetReleaseError("Validated immutable baseline content no longer matches its manifest", "BASELINE_IMMUTABILITY_VIOLATION");
      }
      return target;
    }
  } else {
    const source = await store.inspectLiveSource(input.source, input.batchSize);
    await store.createCandidate({
      datasetId: input.datasetId,
      source: input.source,
      sourceVersion: input.sourceVersion,
      contentHash: source.contentHash,
      tmtSyncRunId: input.tmtSyncRunId ?? null,
      ttmtImportId: input.ttmtImportId ?? null,
    });
    candidate = await store.readCandidate(input.datasetId) ?? {
      id: input.datasetId,
      source: input.source,
      state: "writing",
      sourceVersion: input.sourceVersion,
      contentHash: source.contentHash,
      tmtSyncRunId: input.tmtSyncRunId ?? null,
      ttmtImportId: input.ttmtImportId ?? null,
    };
  }

  const sourceBefore = await store.inspectLiveSource(input.source, input.batchSize);
  if (!candidate.contentHash || candidate.contentHash !== sourceBefore.contentHash) {
    await store.failCandidate({ datasetId: input.datasetId, errorCode: "BASELINE_SOURCE_CHANGED" });
    throw new DatasetReleaseError("Baseline source changed before copy could resume", "BASELINE_SOURCE_CHANGED");
  }

  let complete = false;
  try {
    while (!complete) ({ complete } = await store.copyNextBatch({ datasetId: input.datasetId, source: input.source, batchSize: input.batchSize }));
  } catch (error) {
    if (error instanceof DatasetReleaseError) {
      await store.failCandidate({ datasetId: input.datasetId, errorCode: error.code });
    }
    throw error;
  }

  const [sourceAfter, target] = await Promise.all([
    store.inspectLiveSource(input.source, input.batchSize),
    store.inspectVersionedDataset(input.datasetId, input.source, input.batchSize),
  ]);
  if (!sameInspection(sourceBefore, sourceAfter)) {
    await store.failCandidate({ datasetId: input.datasetId, errorCode: "BASELINE_SOURCE_CHANGED" });
    throw new DatasetReleaseError("Baseline source changed during copy", "BASELINE_SOURCE_CHANGED");
  }
  if (!sameInspection(sourceBefore, target)) {
    await store.failCandidate({ datasetId: input.datasetId, errorCode: "BASELINE_MANIFEST_MISMATCH" });
    throw new DatasetReleaseError("Baseline target manifest does not match the source", "BASELINE_MANIFEST_MISMATCH");
  }
  await store.completeCandidate({ datasetId: input.datasetId, inspection: target });
  return target;
}

function assertValidatedUnverifiedPair(bundle: ReleaseValidationBundle): void {
  const { tmtDataset, ttmtDataset, validation, run, ttmtImport } = bundle;
  if (tmtDataset.source !== "TMT" || ttmtDataset.source !== "TTMT"
    || tmtDataset.state !== "validated" || ttmtDataset.state !== "validated") {
    throw new DatasetReleaseError("Both release datasets must be validated with matching sources", "DATASET_NOT_VALIDATED");
  }
  if (!bundle.tmtManifestValid || !bundle.ttmtManifestValid) {
    throw new DatasetReleaseError("Dataset manifests are incomplete or inconsistent", "MANIFEST_INVALID");
  }
  if (bundle.regNoConflictCount !== 0) throw new DatasetReleaseError("TMT RegNo conflicts block release approval", "REGNO_CONFLICT");
  if (bundle.versionedBlockingInvariantCount !== 0 || !bundle.versionedGpu764169Passed || bundle.tmtForeignVersionRowCount !== 0) {
    throw new DatasetReleaseError("Versioned TMT snapshot does not satisfy its persisted validation invariants", "VERSIONED_TMT_INVARIANT_INVALID");
  }
  if (tmtDataset.tmtSyncRunId !== run.id || validation.runId !== run.id || ttmtDataset.ttmtImportId !== ttmtImport.id
    || validation.ttmtImportId !== ttmtImport.id) {
    throw new DatasetReleaseError("Release source run/import linkage is inconsistent", "SOURCE_LINKAGE_INVALID");
  }
  const evidence = parseTmtValidationEvidence(validation.invariantEvidence);
  const evidenceHash = createHash("sha256").update(validation.invariantEvidence).digest("hex");
  const marker = `unverified:${run.id.replaceAll("-", "").slice(0, 20)}`;
  const requiredEndpoints = new Set<string>(TMT_UNVERIFIED_REQUIRED_ENDPOINTS);
  const evidenceRequired = evidence?.checkpoints.filter((checkpoint) => requiredEndpoints.has(checkpoint.endpoint)) ?? [];
  if (!evidence || validation.policyVersion !== VALIDATED_UNVERIFIED_POLICY_VERSION || validation.status !== "passed"
    || validation.blockingInvariantCount !== 0 || !validation.gpu764169Passed
    || evidenceHash !== validation.evidenceSha256 || !bundle.checkpointEvidenceMatches
    || validation.requiredCheckpointCount <= 0
    || validation.requiredSucceededCount !== validation.requiredCheckpointCount
    || bundle.currentRequiredCheckpointCount !== validation.requiredCheckpointCount
    || bundle.currentRequiredSucceededCount !== validation.requiredSucceededCount
    || evidenceRequired.length !== validation.requiredCheckpointCount
    || evidenceRequired.some((checkpoint) => checkpoint.status !== "succeeded")
    || bundle.currentOptionalFailureCount !== validation.optionalFailureCount
    || bundle.disallowedCheckpointCount !== 0 || bundle.nonterminalOptionalCheckpointCount !== 0
    || run.mode !== "full_unverified" || run.status !== "unverified" || run.errorCode !== "TMT_VERSION_UNVERIFIED" || run.tmtVersion !== marker
    || evidence.run.id !== run.id || evidence.ttmt.id !== ttmtImport.id) {
    throw new DatasetReleaseError("Validated-unverified evidence is missing or inconsistent", "VALIDATION_EVIDENCE_INVALID");
  }
  if (ttmtImport.status !== "succeeded" || validation.ttmtContentHash !== ttmtImport.contentHash
    || validation.ttmtRowCount !== ttmtImport.rowCount || bundle.ttmtDatasetRowCount !== ttmtImport.rowCount
    || bundle.ttmtForeignImportRowCount !== 0 || evidence.ttmt.contentHash !== ttmtImport.contentHash
    || evidence.ttmt.rowCount !== ttmtImport.rowCount) {
    throw new DatasetReleaseError("TTMT evidence or versioned dataset does not match the approved import", "TTMT_EVIDENCE_INVALID");
  }
}

export async function prepareStandardReleaseCandidate(
  rawInput: z.input<typeof candidateInputSchema>,
  store: ReleaseLifecycleStore,
): Promise<void> {
  const input = candidateInputSchema.parse(rawInput);
  await store.transaction(async (tx) => {
    const bundle = await tx.loadValidationBundle(input.tmtDatasetId, input.ttmtDatasetId);
    assertValidatedUnverifiedPair(bundle);
    await tx.createReleaseCandidate({
      releaseId: input.releaseId,
      tmtDatasetId: input.tmtDatasetId,
      ttmtDatasetId: input.ttmtDatasetId,
      validationRunId: bundle.validation.runId,
      validationEvidenceSha256: bundle.validation.evidenceSha256,
    });
    await tx.recordAudit({ action: "standard_release.candidate_validated", releaseId: input.releaseId, actorUserId: input.actorUserId ?? null, assurance: "validated_unverified" });
  });
}

async function validatedRelease(store: ReleaseLifecycleStore, releaseId: string, requireSuperseded = false): Promise<StandardReleaseRecord> {
  const release = await store.loadRelease(releaseId);
  if (!release || release.state !== "approved" || !release.approvedAt
    || !release.validationEvidenceSha256 || (requireSuperseded && !release.supersededAt)) {
    throw new DatasetReleaseError("Release is not approved and eligible for activation", "RELEASE_NOT_APPROVED");
  }
  const bundle = await store.loadValidationBundle(release.tmtDatasetId, release.ttmtDatasetId);
  assertValidatedUnverifiedPair(bundle);
  if (bundle.validation.evidenceSha256 !== release.validationEvidenceSha256) {
    throw new DatasetReleaseError("Release validation evidence changed", "RELEASE_EVIDENCE_CHANGED");
  }
  return release;
}

export async function approveStandardRelease(
  rawInput: z.input<typeof approvalInputSchema>,
  store: ReleaseLifecycleStore,
): Promise<void> {
  const input = approvalInputSchema.parse(rawInput);
  await store.transaction(async (tx) => {
    const release = await tx.loadRelease(input.releaseId);
    if (!release || release.state !== "candidate" || release.approvedAt) {
      throw new DatasetReleaseError("Only a validated candidate release can be approved", "RELEASE_NOT_CANDIDATE");
    }
    const bundle = await tx.loadValidationBundle(release.tmtDatasetId, release.ttmtDatasetId);
    assertValidatedUnverifiedPair(bundle);
    if (release.validationEvidenceSha256 !== bundle.validation.evidenceSha256) {
      throw new DatasetReleaseError("Candidate validation evidence changed before approval", "RELEASE_EVIDENCE_CHANGED");
    }
    await tx.approveRelease(input.releaseId, input.approvedAt ?? new Date());
    await tx.recordAudit({ action: "standard_release.approved", releaseId: input.releaseId, actorUserId: input.actorUserId ?? null, assurance: "validated_unverified" });
  });
}

async function switchRelease(
  rawInput: z.input<typeof switchInputSchema>,
  store: ReleaseLifecycleStore,
  rollback: boolean,
): Promise<void> {
  const input = switchInputSchema.parse(rawInput);
  await store.transaction(async (tx) => {
    const activeReleaseId = await tx.lockActivePointer(ACTIVE_STANDARD_RELEASE_POINTER_KEY);
    if (activeReleaseId !== input.expectedActiveReleaseId) {
      throw new DatasetReleaseError("Concurrent standard release publication detected", "ACTIVE_RELEASE_CHANGED");
    }
    await validatedRelease(tx, input.releaseId, rollback);
    if (activeReleaseId === input.releaseId) return;
    const switchedAt = input.switchedAt ?? new Date();
    await tx.switchActivePointer({
      pointerKey: ACTIVE_STANDARD_RELEASE_POINTER_KEY,
      releaseId: input.releaseId,
      previousReleaseId: activeReleaseId,
      switchedAt,
    });
    await tx.recordAudit({
      action: rollback ? "standard_release.rolled_back" : "standard_release.published",
      releaseId: input.releaseId,
      actorUserId: input.actorUserId ?? null,
      beforeReleaseId: activeReleaseId,
      afterReleaseId: input.releaseId,
      assurance: "validated_unverified",
    });
  });
}

export async function publishStandardRelease(rawInput: z.input<typeof switchInputSchema>, store: ReleaseLifecycleStore): Promise<void> {
  return switchRelease(rawInput, store, false);
}

export async function rollbackStandardRelease(rawInput: z.input<typeof switchInputSchema>, store: ReleaseLifecycleStore): Promise<void> {
  return switchRelease(rawInput, store, true);
}
