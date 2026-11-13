import assert from "node:assert/strict";
import { describe, test } from "vitest";
import {
  cleanupPhase2dTestDatabase,
  createPhase2dTestDatabase,
  phase2dTestConfig,
  verifyPhase2dServerIdentity,
  type Phase2dHarnessConnection,
  type Phase2dHarnessSession,
} from "./helpers/phase-2d-mysql-harness";

const validEnv = {
  NODE_ENV: "test",
  ALLOW_DB_INTEGRATION_TESTS: "1",
  TMT_V2_TEST_HOST: "127.0.0.1",
  TMT_V2_TEST_PORT: "3306",
  TMT_V2_TEST_DATABASE: "drug_master_mapping_v2_test",
  TMT_V2_TEST_USERNAME: "drug_master_phase2d_test",
};

const laragonIdentity = {
  port: 3306,
  version: "8.4.3",
  version_comment: "MySQL Community Server - GPL",
  datadir: "C:\\laragon\\data\\mysql-8.4\\",
};
const laragonProcess = async () => "C:\\laragon\\bin\\mysql\\mysql-8.4.3-winx64\\bin\\mysqld.exe";
const fixedToken = () => "a".repeat(64);

function fakeServer(options: { databaseExists?: boolean; createFails?: boolean } = {}) {
  const statements: string[] = [];
  let databaseExists = options.databaseExists ?? false;
  let ownershipToken: string | null = null;
  let lockOwner: number | null = null;
  let nextConnectionId = 1;

  function connection(): Phase2dHarnessConnection {
    const connectionId = nextConnectionId++;
    const target: Phase2dHarnessConnection = {
      async execute(sql, values = []) {
        statements.push(sql);
        if (sql.startsWith("SELECT @@port")) return [[laragonIdentity]];
        if (sql.startsWith("SELECT CONNECTION_ID")) return [[{ connection_id: connectionId }]];
        if (sql.startsWith("SELECT GET_LOCK")) {
          if (lockOwner === null) lockOwner = connectionId;
          return [[{ acquired: lockOwner === connectionId ? 1 : 0 }]];
        }
        if (sql.startsWith("SELECT IS_USED_LOCK")) return [[{ owner_id: lockOwner }]];
        if (sql.startsWith("SELECT RELEASE_LOCK")) {
          const released = lockOwner === connectionId ? 1 : 0;
          if (released) lockOwner = null;
          return [[{ released }]];
        }
        if (sql.includes("INFORMATION_SCHEMA.SCHEMATA")) {
          return [databaseExists ? [{ SCHEMA_NAME: "drug_master_mapping_v2_test" }] : []];
        }
        if (sql.startsWith("CREATE DATABASE")) {
          if (options.createFails) throw new Error("create failed");
          databaseExists = true;
          return [{ affectedRows: 1 }];
        }
        if (sql.startsWith("CREATE TABLE")) return [{ affectedRows: 1 }];
        if (sql.startsWith("INSERT INTO") && sql.includes("__phase2d_harness_ownership")) {
          ownershipToken = String(values[0]);
          return [{ affectedRows: 1 }];
        }
        if (sql.startsWith("SELECT ownership_token")) {
          return [ownershipToken === null ? [] : [{ ownership_token: ownershipToken }]];
        }
        if (sql.startsWith("DROP DATABASE")) {
          databaseExists = false;
          ownershipToken = null;
          return [{ affectedRows: 1 }];
        }
        return [{ affectedRows: 1 }];
      },
      async query(sql, values) {
        return this.execute(sql, values);
      },
    };
    return target;
  }

  return {
    connection,
    statements,
    databaseExists: () => databaseExists,
    ownershipToken: () => ownershipToken,
    removeMarker: () => { ownershipToken = null; },
    replaceDatabase: () => { databaseExists = true; ownershipToken = "b".repeat(64); },
    releaseLockExternally: () => { lockOwner = null; },
  };
}

describe("Phase 2D MySQL safety guard", () => {
  test("rejects every environment value outside the exact isolated target and dedicated user", () => {
    for (const override of [
      { NODE_ENV: "production" },
      { ALLOW_DB_INTEGRATION_TESTS: "0" },
      { TMT_V2_TEST_HOST: "localhost" },
      { TMT_V2_TEST_PORT: "3307" },
      { TMT_V2_TEST_DATABASE: "drug_master_platform" },
      { TMT_V2_TEST_USERNAME: "root" },
      { TMT_V2_TEST_USERNAME: "" },
    ]) {
      assert.throws(() => phase2dTestConfig({ ...validEnv, ...override }), /refusing phase 2d mysql integration/i);
    }
  });

  test("rejects a server whose listening executable is not exact", async () => {
    const server = fakeServer();
    await assert.rejects(
      () => verifyPhase2dServerIdentity(server.connection(), async () => "C:\\mysql56_jhcis\\bin\\mysqld.exe"),
      /executable/i,
    );
    assert.equal(server.statements.some((sql) => sql.startsWith("CREATE DATABASE")), false);
  });

  test("refuses a pre-existing target database before CREATE", async () => {
    const server = fakeServer({ databaseExists: true });
    await assert.rejects(
      () => createPhase2dTestDatabase(server.connection(), phase2dTestConfig(validEnv), laragonProcess, fixedToken),
      /pre-existing/i,
    );
    assert.equal(server.statements.some((sql) => sql.startsWith("CREATE DATABASE")), false);
  });

  test("persists an ownership token only after CREATE succeeds", async () => {
    const failed = fakeServer({ createFails: true });
    await assert.rejects(
      () => createPhase2dTestDatabase(failed.connection(), phase2dTestConfig(validEnv), laragonProcess, fixedToken),
      /create failed/,
    );
    assert.equal(failed.ownershipToken(), null);
    const created = fakeServer();
    const session = await createPhase2dTestDatabase(created.connection(), phase2dTestConfig(validEnv), laragonProcess, fixedToken);
    assert.equal(session.createdHere, true);
    assert.equal(session.ownershipToken, "a".repeat(64));
    assert.equal(created.ownershipToken(), session.ownershipToken);
  });

  test("rejects a forged ownership session even when its token matches", async () => {
    const server = fakeServer();
    const owner = server.connection();
    const session = await createPhase2dTestDatabase(owner, phase2dTestConfig(validEnv), laragonProcess, fixedToken);
    const forged = { ...session } as Phase2dHarnessSession;
    await assert.rejects(
      () => cleanupPhase2dTestDatabase(owner, server.connection(), phase2dTestConfig(validEnv), forged, laragonProcess),
      /not issued by this harness/i,
    );
    assert.equal(server.databaseExists(), true);
  });

  test("denies cleanup when the ownership token is missing", async () => {
    const server = fakeServer();
    const owner = server.connection();
    const session = await createPhase2dTestDatabase(owner, phase2dTestConfig(validEnv), laragonProcess, fixedToken);
    server.removeMarker();
    await assert.rejects(
      () => cleanupPhase2dTestDatabase(owner, server.connection(), phase2dTestConfig(validEnv), session, laragonProcess),
      /ownership token/i,
    );
    assert.equal(server.databaseExists(), true);
  });

  test("denies cleanup after the database is dropped and recreated", async () => {
    const server = fakeServer();
    const owner = server.connection();
    const session = await createPhase2dTestDatabase(owner, phase2dTestConfig(validEnv), laragonProcess, fixedToken);
    server.replaceDatabase();
    await assert.rejects(
      () => cleanupPhase2dTestDatabase(owner, server.connection(), phase2dTestConfig(validEnv), session, laragonProcess),
      /ownership token/i,
    );
    assert.equal(server.databaseExists(), true);
  });

  test("advisory lock refuses a concurrent harness without touching the database", async () => {
    const server = fakeServer();
    await createPhase2dTestDatabase(server.connection(), phase2dTestConfig(validEnv), laragonProcess, fixedToken);
    await assert.rejects(
      () => createPhase2dTestDatabase(server.connection(), phase2dTestConfig(validEnv), laragonProcess, () => "c".repeat(64)),
      /concurrent harness/i,
    );
    assert.equal(server.statements.filter((sql) => sql.startsWith("CREATE DATABASE")).length, 1);
  });

  test("denies cleanup when the advisory lock is no longer owned", async () => {
    const server = fakeServer();
    const owner = server.connection();
    const session = await createPhase2dTestDatabase(owner, phase2dTestConfig(validEnv), laragonProcess, fixedToken);
    server.releaseLockExternally();
    await assert.rejects(
      () => cleanupPhase2dTestDatabase(owner, server.connection(), phase2dTestConfig(validEnv), session, laragonProcess),
      /advisory lock/i,
    );
    assert.equal(server.databaseExists(), true);
  });

  test("denies cleanup when token verification reuses the owner connection", async () => {
    const server = fakeServer();
    const owner = server.connection();
    const session = await createPhase2dTestDatabase(owner, phase2dTestConfig(validEnv), laragonProcess, fixedToken);
    await assert.rejects(
      () => cleanupPhase2dTestDatabase(owner, owner, phase2dTestConfig(validEnv), session, laragonProcess),
      /fresh verification connection/i,
    );
    assert.equal(server.databaseExists(), true);
  });

  test("allows only one concurrent cleanup claim for an issued session", async () => {
    const server = fakeServer();
    const owner = server.connection();
    const session = await createPhase2dTestDatabase(owner, phase2dTestConfig(validEnv), laragonProcess, fixedToken);
    const results = await Promise.allSettled([
      cleanupPhase2dTestDatabase(owner, server.connection(), phase2dTestConfig(validEnv), session, laragonProcess),
      cleanupPhase2dTestDatabase(owner, server.connection(), phase2dTestConfig(validEnv), session, laragonProcess),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    assert.equal(server.statements.filter((sql) => sql.startsWith("DROP DATABASE")).length, 1);
  });

  test("valid cleanup verifies a fresh connection token and never changes default database", async () => {
    const server = fakeServer();
    const owner = server.connection();
    const session = await createPhase2dTestDatabase(owner, phase2dTestConfig(validEnv), laragonProcess, fixedToken);
    await cleanupPhase2dTestDatabase(owner, server.connection(), phase2dTestConfig(validEnv), session, laragonProcess);
    assert.equal(server.databaseExists(), false);
    assert.equal(server.statements.some((sql) => /^USE\s/i.test(sql)), false);
  });
});
