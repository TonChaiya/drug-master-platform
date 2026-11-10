import assert from "node:assert/strict";
import { test } from "vitest";
import {
  APPROVED_TTMT_V1,
  VALIDATED_UNVERIFIED_POLICY_VERSION,
  buildValidatedUnverifiedEvidence,
  runValidatedUnverifiedRevalidation,
  type ValidatedUnverifiedInput,
} from "@/modules/tmt/validation";
import { TMT_UNVERIFIED_REQUIRED_ENDPOINTS } from "@/modules/tmt/sync";

function validInput(): ValidatedUnverifiedInput {
  const runId = "ae95225a-4d58-47f9-a170-a5ccc6cac7b9";
  return {
    run: {
      id: runId,
      mode: "full_unverified",
      status: "unverified",
      errorCode: "TMT_VERSION_UNVERIFIED",
      tmtVersion: `unverified:${runId.replaceAll("-", "").slice(0, 20)}`,
    },
    checkpoints: [
      ...TMT_UNVERIFIED_REQUIRED_ENDPOINTS.map((endpoint) => ({ endpoint, status: "succeeded" })),
      { endpoint: "imagelist", status: "failed", errorCode: "REMOTE_HTTP_500" },
    ],
    blockingInvariants: {
      missingConceptCounterparts: 0,
      missingEndpointCounterparts: 0,
      levelMismatch: 0,
      masterTmtMissingTpu: 0,
      masterTmtMissingConcept: 0,
      tpuMissingMasterTmt: 0,
      unknownLevels: 0,
      duplicateRelationshipPairs: 0,
      unknownMasterStatuses: 0,
    },
    gpu: {
      code: "764169", level: "gpu", outboundTpu: 9,
      relatedTpuPresent: 9, relatedMasterTmtPresent: 9, relatedConceptPresent: 9,
      activeMasterCount: 9,
    },
    ttmt: {
      id: "46ac7956-4a52-43da-8f0a-c54fa392a70c",
      ...APPROVED_TTMT_V1,
      status: "succeeded",
      productCount: 9_654,
      activeCount: 9_654,
      inactiveCount: 0,
      foreignProductCount: 0,
    },
  };
}

test("valid degraded evidence is deterministic and records imagelist-only failures", () => {
  const input = validInput();
  const first = buildValidatedUnverifiedEvidence(input, new Date("2026-11-10T09:00:00.000Z"));
  const second = buildValidatedUnverifiedEvidence(
    {
      ...input,
      checkpoints: [...input.checkpoints].reverse(),
      blockingInvariants: Object.fromEntries(Object.entries(input.blockingInvariants).reverse()) as ValidatedUnverifiedInput["blockingInvariants"],
    },
    new Date("2026-11-10T09:00:00.000Z"),
  );
  assert.equal(first.policyVersion, VALIDATED_UNVERIFIED_POLICY_VERSION);
  assert.equal(first.status, "passed");
  assert.equal(first.requiredCheckpointCount, TMT_UNVERIFIED_REQUIRED_ENDPOINTS.length);
  assert.equal(first.requiredSucceededCount, TMT_UNVERIFIED_REQUIRED_ENDPOINTS.length);
  assert.equal(first.optionalFailureCount, 1);
  assert.equal(first.blockingInvariantCount, 0);
  assert.equal(first.gpu764169Passed, true);
  assert.match(first.evidenceSha256, /^[a-f0-9]{64}$/);
  assert.equal(second.evidenceSha256, first.evidenceSha256);
  assert.equal(second.invariantEvidence, first.invariantEvidence);
});

test("required checkpoint failure and non-imagelist optional failure fail closed", () => {
  const required = validInput();
  required.checkpoints[0] = { ...required.checkpoints[0]!, status: "failed" };
  assert.throws(() => buildValidatedUnverifiedEvidence(required, new Date()), /required checkpoint/i);

  const unexpected = validInput();
  unexpected.checkpoints.push({ endpoint: "unexpected", status: "failed" });
  assert.throws(() => buildValidatedUnverifiedEvidence(unexpected, new Date()), /endpoint/i);

  const missingImagelist = validInput();
  missingImagelist.checkpoints = missingImagelist.checkpoints.filter((row) => row.endpoint !== "imagelist");
  assert.throws(() => buildValidatedUnverifiedEvidence(missingImagelist, new Date()), /imagelist/i);
});

test("run identity and approved TTMT identity are exact", () => {
  const wrongRun = validInput();
  wrongRun.run.errorCode = null;
  assert.throws(() => buildValidatedUnverifiedEvidence(wrongRun, new Date()), /run identity/i);

  const wrongTtmt = validInput();
  wrongTtmt.ttmt.contentHash = "0".repeat(64);
  assert.throws(() => buildValidatedUnverifiedEvidence(wrongTtmt, new Date()), /TTMT/i);
});

test("invariant or GPU failure never persists a validation row", async () => {
  for (const mutate of [
    (input: ValidatedUnverifiedInput) => { input.blockingInvariants.levelMismatch = 1; },
    (input: ValidatedUnverifiedInput) => { input.gpu.level = "tpu"; },
  ]) {
    const input = validInput();
    mutate(input);
    let writes = 0;
    await assert.rejects(
      () => runValidatedUnverifiedRevalidation({ runId: input.run.id, execute: true }, {
        load: async () => input,
        save: async () => { writes += 1; },
        now: () => new Date("2026-11-10T09:00:00.000Z"),
      }),
      /invariant|GPU/i,
    );
    assert.equal(writes, 0);
  }
});

test("dry-run computes evidence without persisting", async () => {
  let writes = 0;
  const result = await runValidatedUnverifiedRevalidation({ runId: validInput().run.id, execute: false }, {
    load: async () => validInput(),
    save: async () => { writes += 1; },
    now: () => new Date("2026-11-10T09:00:00.000Z"),
  });
  assert.equal(result.executed, false);
  assert.equal(writes, 0);
});
