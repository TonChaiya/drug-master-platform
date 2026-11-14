import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import mysql, { type Connection, type Pool, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import {
  EXPECTED_MIGRATION_0018_SHA256,
  MIGRATION_0018_FILENAME,
  Migration0018GuardError,
  assertExternalEnvFile,
  createMigration0018PoolDependencies,
  executeGuardedMigration0018,
  parseMigration0018Cli,
  redactMigration0018Error,
  splitMigrationStatements,
  type Migration0018Dependencies,
  type Migration0018Request,
  type Migration0018TargetSnapshot,
} from "@/db/migration-0018-guard";
import {
  cleanupPhase2dTestDatabase,
  createPhase2dTestDatabase,
  migratePhase2dDatabaseThrough0017,
  phase2dTestConfig,
  type Phase2dHarnessConnection,
  type Phase2dHarnessSession,
  type Phase2dTestConfig,
} from "./helpers/phase-2d-mysql-harness";

const priorJournal = Array.from({ length: 17 }, (_, index) => ({
  filename: `${String(index + 1).padStart(4, "0")}_migration.sql`,
  contentHash: `${String(index + 1).padStart(64, "0")}`,
}));

const request = (overrides: Partial<Migration0018Request> = {}): Migration0018Request => ({
  environment: "production",
  execute: false,
  envFile: "C:\\secure\\drug-master-production.env",
  confirmDatabase: undefined,
  confirmMigration: undefined,
  confirmHash: undefined,
  maintenanceApproved: false,
  actorUserId: "00000000-0000-4000-8000-000000000001",
  reason: "approved migration window",
  ...overrides,
});
const target = (overrides: Partial<Migration0018TargetSnapshot> = {}): Migration0018TargetSnapshot => ({
  host: "gateway01.ap-southeast-1.prod.aws.tidbcloud.com",
  port: 4000,
  database: "drug_master_platform",
  serverVersion: "8.5.3-TiDB-v8.5.3",
  tlsVerified: true,
  maintenanceAvailable: true,
  maintenanceEnabled: true,
  journalTablePresent: true,
  journal: priorJournal,
  datasetReleaseTables: [],
  ...overrides,
});

function dependencies(overrides: Partial<Migration0018Dependencies> = {}): Migration0018Dependencies {
  return {
    expectedPriorJournal: priorJournal,
    migrationSql: "CREATE TABLE standard_datasets (id CHAR(36) PRIMARY KEY);\nCREATE TABLE standard_releases (id CHAR(36) PRIMARY KEY);",
    migrationHash: EXPECTED_MIGRATION_0018_SHA256,
    inspectTarget: vi.fn(async () => target()),
    executeStatement: vi.fn(async () => undefined),
    verifySchema: vi.fn(async () => ({ valid: true, missingTables: [], invalidPrimaryKeys: [], invalidForeignKeys: [] })),
    recordJournal: vi.fn(async () => undefined),
    onStatementComplete: vi.fn(),
    ...overrides,
  };
}

async function refusal(
  expectedCode: string,
  requestOverrides: Partial<Migration0018Request> = {},
  targetOverrides: Partial<Migration0018TargetSnapshot> = {},
): Promise<void> {
  const deps = dependencies({ inspectTarget: vi.fn(async () => target(targetOverrides)) });
  await expect(executeGuardedMigration0018(request(requestOverrides), deps)).rejects.toMatchObject({ code: expectedCode });
  expect(deps.executeStatement).not.toHaveBeenCalled();
  expect(deps.recordJournal).not.toHaveBeenCalled();
}

describe("guarded Migration 0018 safety", () => {
  test("dry-run performs the exact preflight without DDL or journal writes", async () => {
    const deps = dependencies();
    const result = await executeGuardedMigration0018(request(), deps);
    assert.equal(result.mode, "dry-run");
    assert.equal(result.database, "drug_master_platform");
    assert.equal(result.migrationHash, EXPECTED_MIGRATION_0018_SHA256);
    assert.doesNotMatch(JSON.stringify(result), /approved migration window/);
    assert.match(result.reasonSha256, /^[a-f0-9]{64}$/);
    expect(deps.executeStatement).not.toHaveBeenCalled();
    expect(deps.recordJournal).not.toHaveBeenCalled();
  });

  test.each([
    { code: "PRODUCTION_DATABASE_INVALID", targetOverrides: { database: "other" } },
    { code: "PRODUCTION_HOST_INVALID", targetOverrides: { host: "127.0.0.1" } },
    { code: "MIGRATION_HASH_INVALID", targetOverrides: {}, hash: "f".repeat(64) },
    { code: "JOURNAL_MISSING", targetOverrides: { journalTablePresent: false } },
    { code: "MIGRATION_ALREADY_APPLIED", targetOverrides: { journal: [...priorJournal, { filename: MIGRATION_0018_FILENAME, contentHash: EXPECTED_MIGRATION_0018_SHA256 }] } },
    { code: "PARTIAL_SCHEMA", targetOverrides: { datasetReleaseTables: ["standard_datasets"] } },
  ])("refuses $code", async ({ code, targetOverrides, hash }) => {
    const deps = dependencies({
      migrationHash: hash ?? EXPECTED_MIGRATION_0018_SHA256,
      inspectTarget: vi.fn(async () => target(targetOverrides)),
    });
    await expect(executeGuardedMigration0018(request(), deps)).rejects.toMatchObject({ code });
    expect(deps.executeStatement).not.toHaveBeenCalled();
  });

  test("refuses incomplete and hash-mismatched prior journals", async () => {
    await refusal("JOURNAL_INCOMPLETE", {}, { journal: priorJournal.slice(0, 16) });
    await refusal("JOURNAL_HASH_MISMATCH", {}, {
      journal: priorJournal.map((entry, index) => index === 3 ? { ...entry, contentHash: "a".repeat(64) } : entry),
    });
  });

  test.each([
    ["EXECUTE_CONFIRM_DB_REQUIRED", { confirmDatabase: undefined }],
    ["EXECUTE_CONFIRM_MIGRATION_REQUIRED", { confirmMigration: undefined }],
    ["EXECUTE_CONFIRM_HASH_REQUIRED", { confirmHash: undefined }],
    ["MAINTENANCE_APPROVAL_REQUIRED", { maintenanceApproved: false }],
    ["MAINTENANCE_MODE_REQUIRED", {}, { maintenanceEnabled: false }],
    ["MAINTENANCE_STATE_UNAVAILABLE", {}, { maintenanceAvailable: false }],
    ["ACTOR_REQUIRED", { actorUserId: "" }],
    ["REASON_REQUIRED", { reason: "" }],
  ] as const)("execution refuses %s", async (code, overrides, snapshot?: Partial<Migration0018TargetSnapshot>) => {
    await refusal(code, {
      execute: true,
      confirmDatabase: "drug_master_platform",
      confirmMigration: "0018",
      confirmHash: EXPECTED_MIGRATION_0018_SHA256,
      maintenanceApproved: true,
      ...overrides,
    }, snapshot ?? {});
  });

  test("executes statements in order and journals only after schema verification", async () => {
    const events: string[] = [];
    const deps = dependencies({
      executeStatement: vi.fn(async (_sql, index) => { events.push(`statement:${index}`); }),
      verifySchema: vi.fn(async () => { events.push("verify"); return { valid: true, missingTables: [], invalidPrimaryKeys: [], invalidForeignKeys: [] }; }),
      recordJournal: vi.fn(async () => { events.push("journal"); }),
    });
    const result = await executeGuardedMigration0018(request({
      execute: true,
      confirmDatabase: "drug_master_platform",
      confirmMigration: "0018",
      confirmHash: EXPECTED_MIGRATION_0018_SHA256,
      maintenanceApproved: true,
    }), deps);
    assert.equal(result.mode, "executed");
    assert.deepEqual(events, ["statement:1", "statement:2", "verify", "journal"]);
  });

  test("partial DDL failure stops without retry or journal write", async () => {
    const executeStatement = vi.fn(async (_sql: string, index: number) => {
      if (index === 2) throw new Error("DDL failed with password=super-secret");
    });
    const deps = dependencies({ executeStatement });
    await expect(executeGuardedMigration0018(request({
      execute: true,
      confirmDatabase: "drug_master_platform",
      confirmMigration: "0018",
      confirmHash: EXPECTED_MIGRATION_0018_SHA256,
      maintenanceApproved: true,
    }), deps)).rejects.toMatchObject({ code: "PARTIAL_DDL_FAILURE", statementIndex: 2 });
    assert.equal(executeStatement.mock.calls.length, 2);
    expect(deps.verifySchema).not.toHaveBeenCalled();
    expect(deps.recordJournal).not.toHaveBeenCalled();
  });

  test("post-migration schema failure never records the journal", async () => {
    const deps = dependencies({
      verifySchema: vi.fn(async () => ({
        valid: false, missingTables: ["standard_releases"], invalidPrimaryKeys: [], invalidForeignKeys: [],
      })),
    });
    await expect(executeGuardedMigration0018(request({
      execute: true, confirmDatabase: "drug_master_platform", confirmMigration: "0018",
      confirmHash: EXPECTED_MIGRATION_0018_SHA256, maintenanceApproved: true,
    }), deps)).rejects.toMatchObject({ code: "POST_SCHEMA_INVALID" });
    expect(deps.recordJournal).not.toHaveBeenCalled();
  });

  test("production requires verified TLS and exact hash confirmation", async () => {
    await refusal("TLS_REQUIRED", {}, { tlsVerified: false });
    await refusal("EXECUTE_CONFIRM_HASH_REQUIRED", {
      execute: true, confirmDatabase: "drug_master_platform", confirmMigration: "0018",
      confirmHash: "f".repeat(64), maintenanceApproved: true,
    });
  });

  test("redacts credentials and never returns secret values", () => {
    const output = redactMigration0018Error(new Error("password=super-secret token=abc DB_PASSWORD=hunter2"));
    assert.doesNotMatch(output, /super-secret|abc|hunter2/);
    assert.match(output, /\[REDACTED\]/);
  });

  test("requires an explicit environment file outside the repository and rejects implicit .env.local", async () => {
    const repository = resolve("C:\\repo");
    assert.throws(() => assertExternalEnvFile(undefined, repository), Migration0018GuardError);
    assert.throws(() => assertExternalEnvFile(join(repository, ".env.local"), repository), Migration0018GuardError);
    assert.throws(() => assertExternalEnvFile(join(repository, "production.env"), repository), Migration0018GuardError);

    const directory = await mkdtemp(join(tmpdir(), "migration-0018-env-"));
    try {
      const external = join(directory, "production.env");
      await writeFile(external, "DB_HOST=example.invalid\n");
      assert.equal(assertExternalEnvFile(external, repository), resolve(external));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("CLI refuses an invalid environment and has no implicit environment file", () => {
    assert.throws(() => parseMigration0018Cli(["--environment", "staging", "--env-file", "C:\\secure\\x.env"]),
      (error: unknown) => error instanceof Migration0018GuardError && error.code === "ENVIRONMENT_INVALID");
    assert.throws(() => parseMigration0018Cli(["--environment", "production"]),
      (error: unknown) => error instanceof Migration0018GuardError && error.code === "ENV_FILE_REQUIRED");
  });

  test("executor source never loads .env.local or creates a database", async () => {
    const script = await readFile(new URL("../scripts/migrate-0018-guarded.ts", import.meta.url), "utf8");
    assert.doesNotMatch(script, /process\.loadEnvFile|\.env\.local|CREATE\s+DATABASE/i);
    const migration = await readFile(new URL("../src/db/migrations/0018_versioned_standard_dataset_foundation.sql", import.meta.url), "utf8");
    assert.equal(createHash("sha256").update(migration).digest("hex"), EXPECTED_MIGRATION_0018_SHA256);
  });

  test("splits Migration 0018 without splitting quoted semicolons", () => {
    assert.deepEqual(splitMigrationStatements("CREATE TABLE a (v VARCHAR(8) DEFAULT ';'); -- x;\nCREATE TABLE b (id INT);"), [
      "CREATE TABLE a (v VARCHAR(8) DEFAULT ';')",
      "-- x;\nCREATE TABLE b (id INT)",
    ]);
  });
});

const integrationEnabled = process.env.ALLOW_DB_INTEGRATION_TESTS === "1";

describe.runIf(integrationEnabled).sequential("guarded Migration 0018 on isolated Laragon MySQL", () => {
  let owner: Connection;
  let pool: Pool;
  let config: Phase2dTestConfig;
  let session: Phase2dHarnessSession | undefined;

  beforeAll(async () => {
    config = phase2dTestConfig();
    owner = await mysql.createConnection({
      host: config.host, port: config.port, user: config.user, password: config.password, multipleStatements: true,
    });
    session = await createPhase2dTestDatabase(owner as unknown as Phase2dHarnessConnection, config);
    await migratePhase2dDatabaseThrough0017(owner as unknown as Phase2dHarnessConnection);
    pool = mysql.createPool({ ...config, connectionLimit: 2 });
  }, 30_000);

  afterAll(async () => {
    try {
      await pool?.end();
      if (owner && session) {
        const verification = await mysql.createConnection({
          host: config.host, port: config.port, user: config.user, password: config.password,
        });
        try {
          await cleanupPhase2dTestDatabase(
            owner as unknown as Phase2dHarnessConnection,
            verification as unknown as Phase2dHarnessConnection,
            config,
            session,
          );
        } finally {
          await verification.end();
        }
      }
    } finally {
      await owner?.end();
    }
  });

  test("executes exact 0018, verifies schema, and journals only after complete success", async () => {
    const directory = new URL("../src/db/migrations/", import.meta.url);
    const filenames = (await readdir(directory)).filter((filename) => /^00(?:0[1-9]|1[0-7])_.+\.sql$/.test(filename)).sort();
    const expectedPriorJournal = await Promise.all(filenames.map(async (filename) => {
      const content = await readFile(new URL(filename, directory), "utf8");
      return { filename, contentHash: createHash("sha256").update(content).digest("hex") };
    }));
    const migrationSql = await readFile(new URL(MIGRATION_0018_FILENAME, directory), "utf8");
    const dependencies = createMigration0018PoolDependencies({
      pool,
      environment: "local",
      host: config.host,
      port: config.port,
      tlsVerified: false,
      expectedPriorJournal,
      migrationSql,
      migrationHash: createHash("sha256").update(migrationSql).digest("hex"),
      maintenanceState: async () => ({ available: true, enabled: true }),
    });
    const result = await executeGuardedMigration0018(request({
      environment: "local",
      execute: true,
      confirmDatabase: config.database,
      confirmMigration: "0018",
      confirmHash: EXPECTED_MIGRATION_0018_SHA256,
      maintenanceApproved: true,
    }), dependencies);
    assert.equal(result.mode, "executed");
    const [journal] = await pool.execute<RowDataPacket[]>("SELECT filename,content_hash FROM schema_migrations ORDER BY filename");
    assert.equal(journal.length, 18);
    assert.equal(journal.at(-1)?.filename, MIGRATION_0018_FILENAME);
    assert.equal(journal.at(-1)?.content_hash, EXPECTED_MIGRATION_0018_SHA256);
    const schema = await dependencies.verifySchema();
    assert.deepEqual(schema, { valid: true, missingTables: [], invalidPrimaryKeys: [], invalidForeignKeys: [] });
  }, 30_000);
});
