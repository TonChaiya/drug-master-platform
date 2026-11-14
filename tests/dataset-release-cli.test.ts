import assert from "node:assert/strict";
import { describe, test } from "vitest";
import {
  DatasetReleaseCliError,
  parseDatasetReleaseCli,
  redactDatasetReleaseCliValue,
  runDatasetReleaseCli,
  type DatasetReleaseCliDependencies,
  type DatasetReleaseCliRequest,
} from "@/modules/standards/dataset-release-cli";

const RELEASE_ID = "10000000-0000-4000-8000-000000000001";
const PREVIOUS_RELEASE_ID = "10000000-0000-4000-8000-000000000002";
const TMT_DATASET_ID = "10000000-0000-4000-8000-000000000003";
const TTMT_DATASET_ID = "10000000-0000-4000-8000-000000000004";
const ACTOR_ID = "10000000-0000-4000-8000-000000000005";

function argv(command: string, extra: string[] = []): string[] {
  return [command, "--environment", "production", "--env-file", "production.explicit.env", ...extra];
}

function target(overrides: Record<string, unknown> = {}) {
  return {
    environment: "production" as const,
    host: "gateway01.ap-southeast-1.prod.aws.tidbcloud.com",
    port: 4000,
    database: "drug_master_platform",
    serverVersion: "8.0.11-TiDB-v8.5.3-serverless",
    appliedMigrations: ["0018_versioned_standard_dataset_foundation.sql"],
    maintenanceEnabled: true,
    executeRequested: false,
    ...overrides,
  };
}

function dependencies(overrides: Partial<DatasetReleaseCliDependencies> = {}): DatasetReleaseCliDependencies & { calls: DatasetReleaseCliRequest[] } {
  const calls: DatasetReleaseCliRequest[] = [];
  return {
    calls,
    inspectTarget: async (request) => target({ executeRequested: request.execute, confirmDatabase: request.confirmDatabase }),
    readActiveReleaseId: async () => PREVIOUS_RELEASE_ID,
    read: async (request) => ({ command: request.command, activeReleaseId: PREVIOUS_RELEASE_ID }),
    mutate: async (request) => { calls.push(request); return { changed: true }; },
    ...overrides,
  };
}

function publishArgs(extra: string[] = []): string[] {
  return argv("publish", [
    "--release-id", RELEASE_ID,
    "--expected-active-release-id", PREVIOUS_RELEASE_ID,
    "--actor-user-id", ACTOR_ID,
    "--reason", "approved maintenance window",
    ...extra,
  ]);
}

describe("dataset release CLI parser and guard", () => {
  test("defaults mutation commands to dry-run without calling the writer", async () => {
    const request = parseDatasetReleaseCli(publishArgs());
    const deps = dependencies();
    const result = await runDatasetReleaseCli(request, deps);
    assert.equal(request.execute, false);
    assert.equal(result.executed, false);
    assert.equal(deps.calls.length, 0);
    assert.doesNotMatch(JSON.stringify(result), /approved maintenance window/);
    assert.match(JSON.stringify(result), /reasonSha256/);
  });

  test("preflight remains read-only and reports a target before migration 0018 is applied", async () => {
    const request = parseDatasetReleaseCli(argv("preflight"));
    const deps = dependencies({
      inspectTarget: async () => target({ appliedMigrations: [], maintenanceEnabled: false }),
      read: async (_request, operationalTarget) => ({ migration0018Applied: operationalTarget.appliedMigrations.includes("0018_versioned_standard_dataset_foundation.sql") }),
    });
    const result = await runDatasetReleaseCli(request, deps);
    assert.deepEqual(result.result, { migration0018Applied: false });
    assert.equal(result.executed, false);
    assert.equal(deps.calls.length, 0);
  });

  test("refuses a production database identity mismatch", async () => {
    const request = parseDatasetReleaseCli(publishArgs([
      "--execute", "--confirm-db", "drug_master_platform",
      "--confirm-action", `EXECUTE publish ${RELEASE_ID}`,
    ]));
    const deps = dependencies({ inspectTarget: async () => target({ database: "other_database", executeRequested: true, confirmDatabase: "drug_master_platform" }) });
    await assert.rejects(() => runDatasetReleaseCli(request, deps), /database identity mismatch/i);
    assert.equal(deps.calls.length, 0);
  });

  test("requires the exact action confirmation before execution", async () => {
    const request = parseDatasetReleaseCli(publishArgs([
      "--execute", "--confirm-db", "drug_master_platform", "--confirm-action", "publish it",
    ]));
    const deps = dependencies();
    await assert.rejects(
      () => runDatasetReleaseCli(request, deps),
      (error: unknown) => error instanceof DatasetReleaseCliError && error.code === "ACTION_CONFIRMATION_MISMATCH",
    );
    assert.equal(deps.calls.length, 0);
  });

  test("rejects unauthorized environments and invalid target identifiers", () => {
    const unauthorized = argv("status");
    unauthorized[2] = "staging";
    assert.throws(() => parseDatasetReleaseCli(unauthorized), /environment/i);
    assert.throws(() => parseDatasetReleaseCli(argv("approve", [
      "--release-id", "not-a-uuid", "--actor-user-id", ACTOR_ID, "--reason", "invalid target",
    ])), /uuid/i);
  });

  test("requires actor, reason, expected active release and explicit execution fields for mutations", () => {
    assert.throws(() => parseDatasetReleaseCli(argv("approve", ["--release-id", RELEASE_ID])), /actor-user-id|reason/i);
    assert.throws(() => parseDatasetReleaseCli(argv("publish", [
      "--release-id", RELEASE_ID, "--actor-user-id", ACTOR_ID, "--reason", "missing expected",
    ])), /expected-active-release-id/i);
    assert.throws(() => parseDatasetReleaseCli(publishArgs(["--execute"])), /confirm-db|confirm-action/i);
    assert.throws(() => parseDatasetReleaseCli(argv("baseline", [
      "--dataset-id", TMT_DATASET_ID, "--source", "TMT", "--source-version", "v1", "--tmt-sync-run-id", RELEASE_ID,
      "--actor-user-id", ACTOR_ID, "--reason", "missing active pointer expectation",
    ])), /expected-active-release-id/i);
  });

  test("refuses ambiguous source linkage instead of ignoring extra target options", () => {
    assert.throws(() => parseDatasetReleaseCli(argv("baseline", [
      "--dataset-id", TMT_DATASET_ID, "--source", "TMT", "--source-version", "v1",
      "--tmt-sync-run-id", RELEASE_ID, "--ttmt-import-id", PREVIOUS_RELEASE_ID,
      "--expected-active-release-id", PREVIOUS_RELEASE_ID,
      "--actor-user-id", ACTOR_ID, "--reason", "ambiguous source",
    ])), /ambiguous|matching source/i);
  });

  test("executes a fully confirmed baseline request with exact source identity", async () => {
    const request = parseDatasetReleaseCli(argv("baseline", [
      "--dataset-id", TMT_DATASET_ID, "--source", "TMT", "--source-version", "unverified:1234",
      "--tmt-sync-run-id", RELEASE_ID, "--batch-size", "250",
      "--expected-active-release-id", PREVIOUS_RELEASE_ID,
      "--actor-user-id", ACTOR_ID, "--reason", "approved baseline",
      "--execute", "--confirm-db", "drug_master_platform",
      "--confirm-action", `EXECUTE baseline ${TMT_DATASET_ID}`,
    ]));
    const deps = dependencies();
    const result = await runDatasetReleaseCli(request, deps);
    assert.equal(result.executed, true);
    assert.equal(deps.calls.length, 1);
    assert.equal(deps.calls[0]?.command, "baseline");
  });

  test("refuses a stale active release before invoking any mutation", async () => {
    const request = parseDatasetReleaseCli(publishArgs([
      "--execute", "--confirm-db", "drug_master_platform",
      "--confirm-action", `EXECUTE publish ${RELEASE_ID}`,
    ]));
    const deps = dependencies({ readActiveReleaseId: async () => RELEASE_ID });
    await assert.rejects(
      () => runDatasetReleaseCli(request, deps),
      (error: unknown) => error instanceof DatasetReleaseCliError && error.code === "ACTIVE_RELEASE_CHANGED",
    );
    assert.equal(deps.calls.length, 0);
  });

  test("propagates stale pointer, missing evidence, duplicate publish and unsafe rollback failures", async () => {
    for (const [code, message, command] of [
      ["ACTIVE_RELEASE_CHANGED", "stale active release", "publish"],
      ["VALIDATION_EVIDENCE_INVALID", "missing validation evidence", "validate"],
      ["RELEASE_ALREADY_ACTIVE", "duplicate publish", "publish"],
      ["RELEASE_NOT_APPROVED", "unsafe rollback", "rollback"],
    ] as const) {
      const releaseArgs = command === "validate"
        ? argv(command, [
          "--release-id", RELEASE_ID, "--tmt-dataset-id", TMT_DATASET_ID, "--ttmt-dataset-id", TTMT_DATASET_ID,
          "--expected-active-release-id", PREVIOUS_RELEASE_ID,
          "--actor-user-id", ACTOR_ID, "--reason", message, "--execute", "--confirm-db", "drug_master_platform",
          "--confirm-action", `EXECUTE ${command} ${RELEASE_ID}`,
        ])
        : argv(command, [
          "--release-id", RELEASE_ID, "--expected-active-release-id", PREVIOUS_RELEASE_ID,
          "--actor-user-id", ACTOR_ID, "--reason", message, "--execute", "--confirm-db", "drug_master_platform",
          "--confirm-action", `EXECUTE ${command} ${RELEASE_ID}`,
        ]);
      const request = parseDatasetReleaseCli(releaseArgs);
      const deps = dependencies({ mutate: async () => { throw new DatasetReleaseCliError(code, message); } });
      await assert.rejects(
        () => runDatasetReleaseCli(request, deps),
        (error: unknown) => error instanceof DatasetReleaseCliError && error.code === code,
      );
    }
  });

  test("redacts nested secrets without changing safe operational evidence", () => {
    assert.deepEqual(redactDatasetReleaseCliValue({
      database: "drug_master_platform",
      password: "never-print-me",
      nested: { sessionToken: "secret-token", evidenceSha256: "a".repeat(64) },
    }), {
      database: "drug_master_platform",
      password: "[REDACTED]",
      nested: { sessionToken: "[REDACTED]", evidenceSha256: "a".repeat(64) },
    });
  });
});
