import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, test } from "vitest";
import {
  DatasetReleaseError,
  approveStandardRelease,
  prepareBaselineDataset,
  prepareStandardReleaseCandidate,
  publishStandardRelease,
  rollbackStandardRelease,
  type BaselineStore,
  type DatasetInspection,
  type ReleaseLifecycleStore,
  type ReleaseValidationBundle,
} from "@/modules/standards/dataset-release";
import { ACTIVE_STANDARD_RELEASE_POINTER_KEY } from "@/modules/standards/active-release";
import { APPROVED_TTMT_V1, VALIDATED_UNVERIFIED_POLICY_VERSION } from "@/modules/tmt/validation";
import { TMT_UNVERIFIED_REQUIRED_ENDPOINTS } from "@/modules/tmt/sync";

const TMT_DATASET_ID = "10000000-0000-4000-8000-000000000001";
const TTMT_DATASET_ID = "10000000-0000-4000-8000-000000000002";
const RELEASE_ID = "10000000-0000-4000-8000-000000000003";
const PREVIOUS_RELEASE_ID = "10000000-0000-4000-8000-000000000004";
const TMT_RUN_ID = "10000000-0000-4000-8000-000000000005";
const TTMT_IMPORT_ID = "10000000-0000-4000-8000-000000000006";

function inspection(hash = "a".repeat(64), rows = 2): DatasetInspection {
  return {
    contentHash: createHash("sha256").update(`tmt_dataset_concepts:${rows}:${hash}`).digest("hex"),
    manifests: [{ tableName: "tmt_dataset_concepts", rowCount: rows, contentHash: hash }],
  };
}

function baselineStore(options: { existing?: "writing" | "validated"; sourceChanges?: boolean; failCopyOnce?: boolean } = {}) {
  let state: "writing" | "validated" | "failed" | null = options.existing ?? null;
  let failed = false;
  let copied = 0;
  let inspections = 0;
  let failCopy = options.failCopyOnce ?? false;
  const expected = inspection();
  const changed = inspection("b".repeat(64));
  const store: BaselineStore = {
    async readCandidate() {
      return state ? {
        id: TMT_DATASET_ID, source: "TMT", state, sourceVersion: "v1", contentHash: expected.contentHash,
        tmtSyncRunId: TMT_RUN_ID, ttmtImportId: null,
      } : null;
    },
    async inspectLiveSource() {
      inspections += 1;
      return options.sourceChanges && inspections > 1 ? changed : expected;
    },
    async createCandidate() {
      state = "writing";
    },
    async copyNextBatch() {
      if (failCopy) {
        failCopy = false;
        throw new Error("transient copy failure");
      }
      copied += 1;
      return { copiedRows: 1, complete: copied >= 2 };
    },
    async inspectVersionedDataset() { return expected; },
    async completeCandidate() { state = "validated"; },
    async failCandidate() { state = "failed"; failed = true; },
  };
  return { store, state: () => state, failed: () => failed, copied: () => copied };
}

test("baseline copy is bounded, resumable, and completes only after source and target manifests match", async () => {
  const target = baselineStore();
  const result = await prepareBaselineDataset({
    datasetId: TMT_DATASET_ID, source: "TMT", sourceVersion: "v1", tmtSyncRunId: TMT_RUN_ID, batchSize: 1,
  }, target.store);
  assert.equal(target.copied(), 2);
  assert.equal(target.state(), "validated");
  assert.deepEqual(result, inspection());
});

test("baseline copy rejects a concurrent source change and never validates the candidate", async () => {
  const target = baselineStore({ sourceChanges: true });
  await assert.rejects(() => prepareBaselineDataset({
    datasetId: TMT_DATASET_ID, source: "TMT", sourceVersion: "v1", tmtSyncRunId: TMT_RUN_ID,
  }, target.store), /source changed/i);
  assert.equal(target.failed(), true);
  assert.equal(target.state(), "failed");
});

test("transient baseline failure leaves a writing candidate available for a safe retry", async () => {
  const target = baselineStore({ failCopyOnce: true });
  await assert.rejects(() => prepareBaselineDataset({
    datasetId: TMT_DATASET_ID, source: "TMT", sourceVersion: "v1", tmtSyncRunId: TMT_RUN_ID,
  }, target.store), /transient copy failure/);
  assert.equal(target.state(), "writing");
  assert.equal(target.failed(), false);
  await prepareBaselineDataset({
    datasetId: TMT_DATASET_ID, source: "TMT", sourceVersion: "v1", tmtSyncRunId: TMT_RUN_ID,
  }, target.store);
  assert.equal(target.state(), "validated");
});

test("validated baseline retry fails closed when immutable dataset content no longer matches", async () => {
  const target = baselineStore({ existing: "validated" });
  target.store.inspectVersionedDataset = async () => inspection("c".repeat(64));
  await assert.rejects(() => prepareBaselineDataset({
    datasetId: TMT_DATASET_ID, source: "TMT", sourceVersion: "v1", tmtSyncRunId: TMT_RUN_ID,
  }, target.store), /immutable baseline/i);
});

test("deterministic baseline integrity failure marks the candidate failed", async () => {
  const target = baselineStore();
  target.store.copyNextBatch = async () => {
    throw new DatasetReleaseError("Baseline batch could not copy every selected row", "BASELINE_BATCH_INCOMPLETE");
  };
  await assert.rejects(() => prepareBaselineDataset({
    datasetId: TMT_DATASET_ID, source: "TMT", sourceVersion: "v1", tmtSyncRunId: TMT_RUN_ID,
  }, target.store), /copy every selected row/i);
  assert.equal(target.failed(), true);
});

function validationBundle(overrides: Partial<ReleaseValidationBundle> = {}): ReleaseValidationBundle {
  const checkpoints = TMT_UNVERIFIED_REQUIRED_ENDPOINTS.map((endpoint) => ({
    endpoint, windowBegin: "2026-01-01", windowEnd: "2026-01-02", status: "succeeded", errorCode: null,
    receivedRows: 1, writtenRows: 1,
  }));
  const invariantEvidence = JSON.stringify({
    policyVersion: VALIDATED_UNVERIFIED_POLICY_VERSION,
    run: { id: TMT_RUN_ID, mode: "full_unverified", status: "unverified", errorCode: "TMT_VERSION_UNVERIFIED", tmtVersion: `unverified:${TMT_RUN_ID.replaceAll("-", "").slice(0, 20)}` },
    checkpoints,
    blockingInvariants: { missingConceptCounterparts: 0, missingEndpointCounterparts: 0, levelMismatch: 0, masterTmtMissingTpu: 0, masterTmtMissingConcept: 0, tpuMissingMasterTmt: 0, unknownLevels: 0, duplicateRelationshipPairs: 0, unknownMasterStatuses: 0 },
    gpu: { code: "764169", level: "gpu", outboundTpu: 1, relatedTpuPresent: 1, relatedMasterTmtPresent: 1, relatedConceptPresent: 1, activeMasterCount: 1 },
    ttmt: { id: TTMT_IMPORT_ID, version: APPROVED_TTMT_V1.version, contentHash: APPROVED_TTMT_V1.contentHash, rowCount: APPROVED_TTMT_V1.rowCount, status: "succeeded", productCount: APPROVED_TTMT_V1.rowCount, activeCount: APPROVED_TTMT_V1.rowCount, inactiveCount: 0, foreignProductCount: 0 },
  });
  return {
    tmtDataset: { id: TMT_DATASET_ID, source: "TMT", state: "validated", sourceVersion: "v1", contentHash: "a".repeat(64), tmtSyncRunId: TMT_RUN_ID, ttmtImportId: null },
    ttmtDataset: { id: TTMT_DATASET_ID, source: "TTMT", state: "validated", sourceVersion: APPROVED_TTMT_V1.version, contentHash: "b".repeat(64), tmtSyncRunId: null, ttmtImportId: TTMT_IMPORT_ID },
    tmtManifestValid: true,
    ttmtManifestValid: true,
    regNoConflictCount: 0,
    versionedBlockingInvariantCount: 0,
    versionedGpu764169Passed: true,
    tmtForeignVersionRowCount: 0,
    checkpointEvidenceMatches: true,
    ttmtDatasetRowCount: APPROVED_TTMT_V1.rowCount,
    ttmtForeignImportRowCount: 0,
    run: { id: TMT_RUN_ID, mode: "full_unverified", status: "unverified", errorCode: "TMT_VERSION_UNVERIFIED", tmtVersion: `unverified:${TMT_RUN_ID.replaceAll("-", "").slice(0, 20)}` },
    validation: {
      runId: TMT_RUN_ID, policyVersion: VALIDATED_UNVERIFIED_POLICY_VERSION, status: "passed", blockingInvariantCount: 0,
      requiredCheckpointCount: checkpoints.length, requiredSucceededCount: checkpoints.length, optionalFailureCount: 0,
      gpu764169Passed: true, invariantEvidence, evidenceSha256: createHash("sha256").update(invariantEvidence).digest("hex"),
      ttmtImportId: TTMT_IMPORT_ID, ttmtContentHash: APPROVED_TTMT_V1.contentHash, ttmtRowCount: APPROVED_TTMT_V1.rowCount,
    },
    ttmtImport: { id: TTMT_IMPORT_ID, version: APPROVED_TTMT_V1.version, status: "succeeded", contentHash: APPROVED_TTMT_V1.contentHash, rowCount: APPROVED_TTMT_V1.rowCount },
    currentRequiredCheckpointCount: checkpoints.length,
    currentRequiredSucceededCount: checkpoints.length,
    currentOptionalFailureCount: 0,
    disallowedCheckpointCount: 0,
    nonterminalOptionalCheckpointCount: 0,
    ...overrides,
  };
}

function lifecycleStore(bundle = validationBundle()) {
  const releases = new Map<string, { id: string; state: string; tmtDatasetId: string; ttmtDatasetId: string; validationEvidenceSha256: string | null; approvedAt: Date | null; supersededAt: Date | null }>();
  let activeReleaseId: string | null = PREVIOUS_RELEASE_ID;
  const audits: string[] = [];
  releases.set(PREVIOUS_RELEASE_ID, { id: PREVIOUS_RELEASE_ID, state: "approved", tmtDatasetId: TMT_DATASET_ID, ttmtDatasetId: TTMT_DATASET_ID, validationEvidenceSha256: bundle.validation.evidenceSha256, approvedAt: new Date("2026-01-01"), supersededAt: new Date("2026-01-02") });
  const store: ReleaseLifecycleStore = {
    async transaction(work) { return work(this); },
    async loadValidationBundle() { return bundle; },
    async createReleaseCandidate(input) {
      releases.set(input.releaseId, { id: input.releaseId, state: "candidate", tmtDatasetId: input.tmtDatasetId, ttmtDatasetId: input.ttmtDatasetId, validationEvidenceSha256: input.validationEvidenceSha256, approvedAt: null, supersededAt: null });
    },
    async loadRelease(releaseId) { return releases.get(releaseId) ?? null; },
    async approveRelease(releaseId, approvedAt) { const release = releases.get(releaseId); if (release) { release.state = "approved"; release.approvedAt = approvedAt; } },
    async lockActivePointer(pointerKey) { assert.equal(pointerKey, ACTIVE_STANDARD_RELEASE_POINTER_KEY); return activeReleaseId; },
    async switchActivePointer(input) {
      const previous = activeReleaseId;
      activeReleaseId = input.releaseId;
      const previousRelease = previous ? releases.get(previous) : null;
      if (previousRelease) previousRelease.supersededAt = input.switchedAt;
      const target = releases.get(input.releaseId);
      if (target) target.supersededAt = null;
    },
    async recordAudit(input) { audits.push(input.action); },
  };
  return { store, releases, audits, active: () => activeReleaseId, setActive: (value: string | null) => { activeReleaseId = value; } };
}

describe("release validation and approval", () => {
  test("preserves validated-unverified evidence through explicit candidate and approval gates", async () => {
    const target = lifecycleStore();
    await prepareStandardReleaseCandidate({ releaseId: RELEASE_ID, tmtDatasetId: TMT_DATASET_ID, ttmtDatasetId: TTMT_DATASET_ID }, target.store);
    assert.equal(target.releases.get(RELEASE_ID)?.state, "candidate");
    assert.equal(target.releases.get(RELEASE_ID)?.validationEvidenceSha256, validationBundle().validation.evidenceSha256);
    await approveStandardRelease({ releaseId: RELEASE_ID, approvedAt: new Date("2026-02-01") }, target.store);
    assert.equal(target.releases.get(RELEASE_ID)?.state, "approved");
    assert.deepEqual(target.audits, ["standard_release.candidate_validated", "standard_release.approved"]);
  });

  test("rejects incomplete manifests, RegNo conflicts, and failed candidates", async () => {
    const invalid = lifecycleStore(validationBundle({ tmtManifestValid: false, regNoConflictCount: 1 }));
    await assert.rejects(() => prepareStandardReleaseCandidate({ releaseId: RELEASE_ID, tmtDatasetId: TMT_DATASET_ID, ttmtDatasetId: TTMT_DATASET_ID }, invalid.store), DatasetReleaseError);
    assert.equal(invalid.releases.has(RELEASE_ID), false);
  });

  test("rejects validation evidence whose required checkpoint counts no longer match", async () => {
    const bundle = validationBundle();
    bundle.validation.requiredSucceededCount = 0;
    const invalid = lifecycleStore(bundle);
    await assert.rejects(() => prepareStandardReleaseCandidate({ releaseId: RELEASE_ID, tmtDatasetId: TMT_DATASET_ID, ttmtDatasetId: TTMT_DATASET_ID }, invalid.store), /evidence/i);
  });

  test("rejects a copied snapshot that no longer satisfies the persisted TMT invariants", async () => {
    const invalid = lifecycleStore(validationBundle({ versionedBlockingInvariantCount: 1, versionedGpu764169Passed: false }));
    await assert.rejects(() => prepareStandardReleaseCandidate({ releaseId: RELEASE_ID, tmtDatasetId: TMT_DATASET_ID, ttmtDatasetId: TTMT_DATASET_ID }, invalid.store), /versioned TMT/i);
  });
});

describe("atomic publish and rollback", () => {
  test("publishes only an approved intact release under the shared pointer lock", async () => {
    const target = lifecycleStore();
    await prepareStandardReleaseCandidate({ releaseId: RELEASE_ID, tmtDatasetId: TMT_DATASET_ID, ttmtDatasetId: TTMT_DATASET_ID }, target.store);
    await approveStandardRelease({ releaseId: RELEASE_ID }, target.store);
    await publishStandardRelease({ releaseId: RELEASE_ID, expectedActiveReleaseId: PREVIOUS_RELEASE_ID }, target.store);
    assert.equal(target.active(), RELEASE_ID);
    assert.equal(target.releases.get(PREVIOUS_RELEASE_ID)?.supersededAt instanceof Date, true);
    assert.equal(target.audits.at(-1), "standard_release.published");
  });

  test("rejects a concurrent publisher without moving the pointer", async () => {
    const target = lifecycleStore();
    await prepareStandardReleaseCandidate({ releaseId: RELEASE_ID, tmtDatasetId: TMT_DATASET_ID, ttmtDatasetId: TTMT_DATASET_ID }, target.store);
    await approveStandardRelease({ releaseId: RELEASE_ID }, target.store);
    await assert.rejects(() => publishStandardRelease({ releaseId: RELEASE_ID, expectedActiveReleaseId: null }, target.store), /concurrent/i);
    assert.equal(target.active(), PREVIOUS_RELEASE_ID);
  });

  test("rolls back by pointer only to a previously superseded intact release", async () => {
    const target = lifecycleStore();
    await prepareStandardReleaseCandidate({ releaseId: RELEASE_ID, tmtDatasetId: TMT_DATASET_ID, ttmtDatasetId: TTMT_DATASET_ID }, target.store);
    await approveStandardRelease({ releaseId: RELEASE_ID }, target.store);
    target.setActive(RELEASE_ID);
    await rollbackStandardRelease({ releaseId: PREVIOUS_RELEASE_ID, expectedActiveReleaseId: RELEASE_ID }, target.store);
    assert.equal(target.active(), PREVIOUS_RELEASE_ID);
    assert.equal(target.audits.at(-1), "standard_release.rolled_back");
  });

  test("idempotent publish still fails closed when the active release is no longer intact", async () => {
    const invalid = lifecycleStore(validationBundle({ tmtManifestValid: false }));
    invalid.releases.set(RELEASE_ID, {
      id: RELEASE_ID, state: "approved", tmtDatasetId: TMT_DATASET_ID, ttmtDatasetId: TTMT_DATASET_ID,
      validationEvidenceSha256: validationBundle().validation.evidenceSha256, approvedAt: new Date("2026-02-01"), supersededAt: null,
    });
    invalid.setActive(RELEASE_ID);
    await assert.rejects(() => publishStandardRelease({ releaseId: RELEASE_ID, expectedActiveReleaseId: RELEASE_ID }, invalid.store), /manifest/i);
  });
});
