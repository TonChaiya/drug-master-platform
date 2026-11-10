import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "vitest";
import { evaluateTmtV2Readiness } from "@/modules/tmt/readiness";
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
    ttmt: { id: "46ac7956-4a52-43da-8f0a-c54fa392a70c", version: "20261001", contentHash: "7be50149229747f2799039fbc27b0ae1cf19b6a16c40381355d40f36c6d19bf9", rowCount: 9654, status: "succeeded", productCount: 9654, activeCount: 9654, inactiveCount: 0, foreignProductCount: 0 },
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

test("missing, unsupported, or stale degraded evidence fails closed", () => {
  const state = degraded();
  assert.equal(evaluateTmtV2Readiness(state.run).ready, false);
  assert.equal(evaluateTmtV2Readiness(state.run, { ...state.validation, policyVersion: "future-v2" }).ready, false);
  assert.equal(evaluateTmtV2Readiness(state.run, { ...state.validation, ttmtStatus: "failed" }).ready, false);
  assert.equal(evaluateTmtV2Readiness(state.run, { ...state.validation, currentTtmtContentHash: "0".repeat(64) }).ready, false);
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
