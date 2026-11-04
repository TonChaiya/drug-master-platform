import assert from "node:assert/strict";
import { test } from "vitest";
import { integrationTestDbConfig } from "./helpers/db-integration";

const localTestEnv = {
  NODE_ENV: "test",
  ALLOW_DB_INTEGRATION_TESTS: "1",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3307",
  DB_USERNAME: "root",
  DB_PASSWORD: "local-only",
  DB_DATABASE: "drug_master_tmt_v2_test",
};

test("accepts only an explicitly opted-in local test database", () => {
  assert.deepEqual(integrationTestDbConfig(localTestEnv), {
    host: "127.0.0.1",
    port: 3307,
    user: "root",
    password: "local-only",
    database: "drug_master_tmt_v2_test",
  });
});

test("rejects a production-like hostname before a connection is created", () => {
  assert.throws(
    () => integrationTestDbConfig({ ...localTestEnv, DB_HOST: "gateway.example.tidbcloud.com" }),
    /Refusing to run DB integration test against non-test database/,
  );
});

test("rejects a production database name on localhost", () => {
  assert.throws(
    () => integrationTestDbConfig({ ...localTestEnv, DB_DATABASE: "drug_master_platform" }),
    /Refusing to run DB integration test against non-test database/,
  );
});

test("rejects missing explicit opt-in even when all DB values look local", () => {
  const { ALLOW_DB_INTEGRATION_TESTS: _ignored, ...withoutOptIn } = localTestEnv;
  assert.throws(
    () => integrationTestDbConfig(withoutOptIn),
    /ALLOW_DB_INTEGRATION_TESTS=1/,
  );
});

test("does not trust production-like values inherited from an env file without opt-in", () => {
  assert.throws(
    () => integrationTestDbConfig({
      NODE_ENV: "test",
      DB_HOST: "gateway.example.tidbcloud.com",
      DB_PORT: "4000",
      DB_USERNAME: "fixture",
      DB_PASSWORD: "fixture",
      DB_DATABASE: "drug_master_platform",
    }),
    /ALLOW_DB_INTEGRATION_TESTS=1/,
  );
});
