import assert from "node:assert/strict";
import { test } from "vitest";
import {
  GuardedTargetClassificationError,
  classifyGuardedTarget,
  type GuardedTargetIdentity,
} from "@/modules/phase7/target-classification";

const localClone: GuardedTargetIdentity = {
  environment: "local", host: "127.0.0.1", port: 3306, database: "drug_master_platform",
  serverVersion: "8.4.3", rehearsalIntent: true,
};

function refusal(target: GuardedTargetIdentity, code: string): void {
  assert.throws(
    () => classifyGuardedTarget(target),
    (error: unknown) => error instanceof GuardedTargetClassificationError && error.code === code,
  );
}

test("classifies the explicit localhost clone rehearsal without making v2 naming architectural", () => {
  assert.equal(classifyGuardedTarget(localClone), "LOCAL_CLONE_REHEARSAL");
  assert.equal(classifyGuardedTarget({ ...localClone, host: "localhost" }), "LOCAL_CLONE_REHEARSAL");
  assert.equal(classifyGuardedTarget({
    ...localClone, database: "drug_master_mapping_v2_test", rehearsalIntent: false, testOptIn: true,
  }), "TEST");
});

test("rehearsal fails closed without explicit intent or with a remote/unknown target", () => {
  refusal({ ...localClone, rehearsalIntent: false }, "REHEARSAL_INTENT_REQUIRED");
  refusal({ ...localClone, host: "192.0.2.10" }, "LOCAL_HOST_INVALID");
  refusal({ ...localClone, database: "drug_master_other" }, "LOCAL_DATABASE_INVALID");
  refusal({ ...localClone, database: "drug_master_mapping_v2_test", rehearsalIntent: false, testOptIn: false }, "LOCAL_TEST_OPT_IN_REQUIRED");
});

test("port 3333 and jhcisdb are forbidden for every target class", () => {
  refusal({ ...localClone, port: 3333 }, "PORT_FORBIDDEN");
  refusal({ ...localClone, database: "jhcisdb" }, "DATABASE_FORBIDDEN");
  refusal({ ...localClone, environment: "production", host: "gateway.prod.tidbcloud.com", port: 3333 }, "PORT_FORBIDDEN");
});

test("Production remains a distinct TiDB target and rejects rehearsal intent", () => {
  const production: GuardedTargetIdentity = {
    environment: "production", host: "gateway.prod.tidbcloud.com", port: 4000,
    database: "drug_master_platform", serverVersion: "TiDB-v8.5.3",
    provider: "tidb-cloud", driver: "mysql2", tlsVerified: true,
    productionIntent: true, guardedOperation: "preflight",
  };
  assert.equal(classifyGuardedTarget(production), "PRODUCTION");
  assert.equal(classifyGuardedTarget({
    ...production, productionIntent: false, guardedOperation: undefined, executeRequested: false,
  }), "PRODUCTION");
  refusal({ ...production, rehearsalIntent: true }, "REHEARSAL_ENVIRONMENT_INVALID");
  refusal({ ...production, host: "127.0.0.1" }, "PRODUCTION_HOST_INVALID");
  refusal({ ...production, productionIntent: false, executeRequested: true }, "PRODUCTION_INTENT_REQUIRED");
  refusal({ ...production, guardedOperation: undefined, executeRequested: true }, "PRODUCTION_OPERATION_REQUIRED");
  refusal({ ...production, provider: "other" }, "PRODUCTION_PROVIDER_INVALID");
  refusal({ ...production, driver: "other" }, "PRODUCTION_DRIVER_INVALID");
  refusal({ ...production, tlsVerified: false }, "PRODUCTION_TLS_REQUIRED");
});
