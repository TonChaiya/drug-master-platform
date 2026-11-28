import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test, vi } from "vitest";
import type { Pool } from "mysql2/promise";
import { evaluateTmtV2Readiness, readTmtV2Readiness } from "@/modules/tmt/readiness";
import { buildValidatedUnverifiedEvidence } from "@/modules/tmt/validation";
import { TMT_UNVERIFIED_REQUIRED_ENDPOINTS } from "@/modules/tmt/sync";

function degraded() {
  const runId = "ae95225a-4d58-47f9-a170-a5ccc6cac7b9";
  const input = {
    run: { id: runId, mode: "full_unverified", status: "unverified", errorCode: "TMT_VERSION_UNVERIFIED", tmtVersion: `unverified:${runId.replaceAll("-", "").slice(0, 20)}` },
    checkpoints: [
      ...TMT_UNVERIFIED_REQUIRED_ENDPOINTS.map((endpoint) => ({ endpoint, status: "succeeded" })),
      { endpoint: "imagelist", status: "failed", errorCode: "REMOTE_HTTP_500" },
    ],
    blockingInvariants: { missingConceptCounterparts: 0, missingEndpointCounterparts: 0, levelMismatch: 0, masterTmtMissingTpu: 0, masterTmtMissingConcept: 0, tpuMissingMasterTmt: 0, unknownLevels: 0, duplicateRelationshipPairs: 0, unknownMasterStatuses: 0 },
    gpu: { code: "764169", level: "gpu", outboundTpu: 9, relatedTpuPresent: 9, relatedMasterTmtPresent: 9, relatedConceptPresent: 9, activeMasterCount: 9 },
    ttmt: { id: "46ac7956-4a52-43da-8f0a-c54fa392a70c", version: "20261001", contentHash: "071cb3d3708865f8d1428e23f25216ba65e6acb21e436070587d98a59dbce5c3", rowCount: 9654, status: "succeeded", productCount: 9654, activeCount: 9654, inactiveCount: 0, foreignProductCount: 0 },
  };
  const validation = buildValidatedUnverifiedEvidence(input, new Date("2026-11-10T09:00:00.000Z"));
  return {
    run: input.run,
    validation: {
      ...validation,
      currentRequiredCheckpointCount: validation.requiredCheckpointCount,
      currentRequiredSucceededCount: validation.requiredSucceededCount,
      disallowedCheckpointCount: 0,
      nonterminalOptionalCheckpointCount: 0,
      currentOptionalCheckpointCount: 1,
      currentOptionalFailureCount: 1,
      ttmtStatus: "succeeded",
      currentTtmtContentHash: validation.ttmtContentHash,
      currentTtmtRowCount: validation.ttmtRowCount,
      currentTtmtProductCount: validation.ttmtRowCount,
      currentTtmtForeignProductCount: 0,
      checkpointEvidenceMatches: true,
      evidenceIdentityMatches: true,
    },
  };
}

test("only the latest succeeded versioned run is TMT v2 ready", () => {
  assert.equal(evaluateTmtV2Readiness(null).ready, false);
  assert.deepEqual(evaluateTmtV2Readiness({ id: "1", mode: "full", status: "succeeded", errorCode: null, tmtVersion: "20261102" }).assurance, "verified");
  assert.deepEqual(evaluateTmtV2Readiness({ id: "2", mode: "incremental", status: "succeeded", errorCode: null, tmtVersion: "20261102" }).assurance, "verified");
});

test("persisted valid degraded evidence is ready without relabeling the run", () => {
  const state = degraded();
  const readiness = evaluateTmtV2Readiness(state.run, state.validation);
  assert.equal(readiness.ready, true);
  assert.equal(readiness.assurance, "validated_unverified");
  assert.equal(readiness.run?.status, "unverified");
});

test("live readiness reads historical TMT evidence without querying TTMT imports or products", async () => {
  const { run, validation } = degraded();
  const parsed = JSON.parse(validation.invariantEvidence);
  const query = vi.fn()
    .mockResolvedValueOnce([[{ id: run.id, mode: run.mode, status: run.status, error_code: run.errorCode, tmt_version: run.tmtVersion }]])
    .mockResolvedValueOnce([[{
      run_id: run.id, policy_version: validation.policyVersion, status: "passed", required_checkpoint_count: validation.requiredCheckpointCount,
      required_succeeded_count: validation.requiredSucceededCount, optional_failure_count: 1, blocking_invariant_count: 0,
      gpu_764169_passed: 1, invariant_evidence: validation.invariantEvidence, evidence_sha256: validation.evidenceSha256,
      ttmt_import_id: validation.ttmtImportId, ttmt_content_hash: validation.ttmtContentHash, ttmt_row_count: validation.ttmtRowCount,
    }]])
    .mockResolvedValueOnce([parsed.checkpoints.map((row: { endpoint: string; status: string; errorCode: string | null }) => ({
      endpoint: row.endpoint, status: row.status, error_code: row.errorCode, window_begin: null, window_end: null, received_rows: null, written_rows: null,
    }))]);
  assert.equal((await readTmtV2Readiness({ query } as unknown as Pick<Pool, "query">)).assurance, "validated_unverified");
  assert.equal(query.mock.calls.length, 3);
  for (const [sql] of query.mock.calls) assert.doesNotMatch(String(sql), /ttmt_imports|ttmt_products/i);
});

test("missing, unsupported, or stale degraded evidence fails closed", () => {
  const state = degraded();
  assert.equal(evaluateTmtV2Readiness(state.run).ready, false);
  assert.equal(evaluateTmtV2Readiness(state.run, { ...state.validation, policyVersion: "future-v2" }).ready, false);
  assert.equal(evaluateTmtV2Readiness(state.run, { ...state.validation, currentRequiredSucceededCount: state.validation.currentRequiredSucceededCount - 1 }).ready, false);
  assert.equal(evaluateTmtV2Readiness(state.run, { ...state.validation, checkpointEvidenceMatches: false }).ready, false);
  const forgedEvidence = state.validation.invariantEvidence.replace(state.run.id, "00000000-0000-4000-8000-000000000000");
  assert.equal(evaluateTmtV2Readiness(state.run, {
    ...state.validation,
    invariantEvidence: forgedEvidence,
    evidenceSha256: createHash("sha256").update(forgedEvidence).digest("hex"),
    evidenceIdentityMatches: false,
  }).ready, false);
});

test("unverified, failed, stale, and running runs fail closed", () => {
  for (const run of [
    { id: "1", mode: "full_unverified", status: "unverified", errorCode: "TMT_VERSION_UNVERIFIED", tmtVersion: "unverified:0123456789abcdef0123" },
    { id: "1", mode: "full_unverified", status: "succeeded", errorCode: null, tmtVersion: "unverified:0123456789abcdef0123" },
    { id: "1", mode: "full", status: "failed", errorCode: null, tmtVersion: "20261102" },
    { id: "1", mode: "full", status: "stale", errorCode: null, tmtVersion: "20261102" },
    { id: "1", mode: "full", status: "running", errorCode: null, tmtVersion: "20261102" },
  ]) {
    assert.equal(evaluateTmtV2Readiness(run).ready, false, JSON.stringify(run));
  }
});
