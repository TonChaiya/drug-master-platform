import { execFile } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { promisify } from "node:util";

export const PHASE_2D_TEST_DATABASE = "drug_master_mapping_v2_test";

const expectedHost = "127.0.0.1";
const expectedPort = 3306;
const expectedVersion = "8.4.3";
const expectedVersionComment = "MySQL Community Server - GPL";
const expectedDataDirectory = "C:\\laragon\\data\\mysql-8.4";
const expectedExecutable = "C:\\laragon\\bin\\mysql\\mysql-8.4.3-winx64\\bin\\mysqld.exe";
const expectedUser = "drug_master_phase2d_test";
const ownershipTable = "__phase2d_harness_ownership";
const ownershipKey = "phase-2d-run";
const advisoryLockName = "drug-master-platform:phase2d:drug_master_mapping_v2_test";
const refusal = "Refusing Phase 2D MySQL integration outside the exact isolated Laragon target";
const execFileAsync = promisify(execFile);
const issuedSessions = new WeakSet<Phase2dHarnessSession>();
const cleanupClaims = new WeakSet<Phase2dHarnessSession>();

type EnvLike = Record<string, string | undefined>;

export interface Phase2dTestConfig {
  host: typeof expectedHost;
  port: typeof expectedPort;
  database: typeof PHASE_2D_TEST_DATABASE;
  user: string;
  password: string;
}

export interface Phase2dHarnessConnection {
  execute(sql: string, values?: readonly unknown[]): Promise<readonly [unknown, ...unknown[]]>;
  query?(sql: string, values?: readonly unknown[]): Promise<readonly [unknown, ...unknown[]]>;
}

export interface Phase2dHarnessSession {
  database: typeof PHASE_2D_TEST_DATABASE;
  createdHere: true;
  ownershipToken: string;
  lockName: typeof advisoryLockName;
  ownerConnectionId: number;
}

export type Phase2dProcessInspector = () => Promise<string>;
export type Phase2dOwnershipTokenFactory = () => string;

function normalizeWindowsPath(value: string): string {
  return value.trim().replaceAll("/", "\\").replace(/\\+$/, "").toLowerCase();
}

function rows(result: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(result)) throw new Error(`${refusal}: expected a row result`);
  return result.filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null);
}

export function phase2dTestConfig(env: EnvLike = process.env): Phase2dTestConfig {
  const user = env.TMT_V2_TEST_USERNAME?.trim();
  if (
    env.NODE_ENV !== "test"
    || env.ALLOW_DB_INTEGRATION_TESTS !== "1"
    || env.TMT_V2_TEST_HOST !== expectedHost
    || env.TMT_V2_TEST_PORT !== String(expectedPort)
    || env.TMT_V2_TEST_DATABASE !== PHASE_2D_TEST_DATABASE
    || user !== expectedUser
  ) {
    throw new Error(refusal);
  }
  return {
    host: expectedHost,
    port: expectedPort,
    database: PHASE_2D_TEST_DATABASE,
    user,
    password: env.TMT_V2_TEST_PASSWORD ?? "",
  };
}

function randomOwnershipToken(): string {
  return randomBytes(32).toString("hex");
}

export async function readLaragonMySqlExecutablePath(): Promise<string> {
  if (process.platform !== "win32") throw new Error(`${refusal}: Windows process inspection is required`);
  const script = [
    "$listeners=@(Get-NetTCPConnection -LocalPort 3306 -State Listen -ErrorAction Stop)",
    "if($listeners.Count -ne 1){throw 'Expected exactly one listener on port 3306'}",
    "$path=(Get-Process -Id $listeners[0].OwningProcess -ErrorAction Stop).Path",
    "if(-not $path){throw 'Listener executable path is unavailable'}",
    "[Console]::Out.Write($path)",
  ].join("; ");
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    windowsHide: true,
  });
  return stdout.trim();
}

export async function verifyPhase2dServerIdentity(
  connection: Phase2dHarnessConnection,
  inspectProcess: Phase2dProcessInspector = readLaragonMySqlExecutablePath,
): Promise<void> {
  const executable = await inspectProcess();
  if (normalizeWindowsPath(executable) !== normalizeWindowsPath(expectedExecutable)) {
    throw new Error(`${refusal}: unexpected MySQL executable path`);
  }

  const [result] = await connection.execute(
    "SELECT @@port AS port,@@version AS version,@@version_comment AS version_comment,@@datadir AS datadir",
  );
  const identity = rows(result)[0];
  if (
    Number(identity?.port) !== expectedPort
    || String(identity?.version) !== expectedVersion
    || String(identity?.version_comment) !== expectedVersionComment
    || normalizeWindowsPath(String(identity?.datadir ?? "")) !== normalizeWindowsPath(expectedDataDirectory)
  ) {
    throw new Error(`${refusal}: unexpected MySQL server identity`);
  }
}

async function databaseRows(connection: Phase2dHarnessConnection): Promise<Array<Record<string, unknown>>> {
  const [result] = await connection.execute(
    "SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME=?",
    [PHASE_2D_TEST_DATABASE],
  );
  return rows(result);
}

async function scalarNumber(connection: Phase2dHarnessConnection, sql: string, values: readonly unknown[]): Promise<number | null> {
  const [result] = await connection.execute(sql, values);
  const row = rows(result)[0];
  if (!row) return null;
  const value = Object.values(row)[0];
  return value === null || value === undefined ? null : Number(value);
}

async function releaseAdvisoryLock(connection: Phase2dHarnessConnection): Promise<void> {
  await connection.execute("SELECT RELEASE_LOCK(?) AS released", [advisoryLockName]);
}

async function readOwnershipToken(connection: Phase2dHarnessConnection): Promise<string | null> {
  const [result] = await connection.execute(
    `SELECT ownership_token FROM \`${PHASE_2D_TEST_DATABASE}\`.\`${ownershipTable}\` WHERE marker_key=? LIMIT 1`,
    [ownershipKey],
  );
  const row = rows(result)[0];
  return row?.ownership_token === undefined ? null : String(row.ownership_token);
}

function ownershipTokensMatch(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export async function createPhase2dTestDatabase(
  connection: Phase2dHarnessConnection,
  config: Phase2dTestConfig,
  inspectProcess: Phase2dProcessInspector = readLaragonMySqlExecutablePath,
  createToken: Phase2dOwnershipTokenFactory = randomOwnershipToken,
): Promise<Phase2dHarnessSession> {
  if (config.host !== expectedHost || config.port !== expectedPort || config.database !== PHASE_2D_TEST_DATABASE || config.user !== expectedUser) {
    throw new Error(refusal);
  }
  await verifyPhase2dServerIdentity(connection, inspectProcess);
  const ownershipToken = createToken();
  if (!/^[a-f0-9]{64}$/.test(ownershipToken)) throw new Error(`${refusal}: invalid ownership token`);
  const acquired = await scalarNumber(connection, "SELECT GET_LOCK(?,0) AS acquired", [advisoryLockName]);
  if (acquired !== 1) throw new Error(`${refusal}: concurrent harness holds the advisory lock`);
  let createdHere = false;
  try {
    if ((await databaseRows(connection)).length !== 0) {
      throw new Error(`${refusal}: pre-existing database ${PHASE_2D_TEST_DATABASE}`);
    }
    await connection.execute(
      `CREATE DATABASE \`${PHASE_2D_TEST_DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    createdHere = true;
    await connection.execute(
      `CREATE TABLE \`${PHASE_2D_TEST_DATABASE}\`.\`${ownershipTable}\` (marker_key VARCHAR(32) NOT NULL PRIMARY KEY,ownership_token CHAR(64) NOT NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3))`,
    );
    await connection.execute(
      `INSERT INTO \`${PHASE_2D_TEST_DATABASE}\`.\`${ownershipTable}\` (ownership_token,marker_key) VALUES (?,?)`,
      [ownershipToken, ownershipKey],
    );
    const storedToken = await readOwnershipToken(connection);
    if (storedToken === null || !ownershipTokensMatch(storedToken, ownershipToken)) {
      throw new Error(`${refusal}: ownership token could not be verified after creation`);
    }
    const ownerConnectionId = await scalarNumber(connection, "SELECT CONNECTION_ID() AS connection_id", []);
    if (!Number.isInteger(ownerConnectionId) || Number(ownerConnectionId) <= 0) {
      throw new Error(`${refusal}: owner connection identity is unavailable`);
    }
    const session = Object.freeze({
      database: PHASE_2D_TEST_DATABASE,
      createdHere: true as const,
      ownershipToken,
      lockName: advisoryLockName,
      ownerConnectionId: Number(ownerConnectionId),
    });
    issuedSessions.add(session);
    return session;
  } catch (error) {
    await releaseAdvisoryLock(connection);
    if (createdHere) {
      throw new Error(`${refusal}: created database retained because ownership setup did not complete`, { cause: error });
    }
    throw error;
  }
}

export async function cleanupPhase2dTestDatabase(
  ownerConnection: Phase2dHarnessConnection,
  verificationConnection: Phase2dHarnessConnection,
  config: Phase2dTestConfig,
  session: Phase2dHarnessSession,
  inspectProcess: Phase2dProcessInspector = readLaragonMySqlExecutablePath,
): Promise<void> {
  if (!issuedSessions.has(session)) {
    throw new Error(`${refusal}: ownership session was not issued by this harness`);
  }
  if (cleanupClaims.has(session)) throw new Error(`${refusal}: cleanup was already claimed for this harness session`);
  cleanupClaims.add(session);
  if (session.database !== PHASE_2D_TEST_DATABASE || session.lockName !== advisoryLockName || config.database !== PHASE_2D_TEST_DATABASE || config.user !== expectedUser) {
    throw new Error(`${refusal}: invalid cleanup scope`);
  }
  try {
    await verifyPhase2dServerIdentity(verificationConnection, inspectProcess);
    const [ownerConnectionId, verificationConnectionId, lockOwnerId] = await Promise.all([
      scalarNumber(ownerConnection, "SELECT CONNECTION_ID() AS connection_id", []),
      scalarNumber(verificationConnection, "SELECT CONNECTION_ID() AS connection_id", []),
      scalarNumber(verificationConnection, "SELECT IS_USED_LOCK(?) AS owner_id", [advisoryLockName]),
    ]);
    if (verificationConnectionId === ownerConnectionId) {
      throw new Error(`${refusal}: cleanup requires a fresh verification connection`);
    }
    if (ownerConnectionId !== session.ownerConnectionId || lockOwnerId !== session.ownerConnectionId) {
      throw new Error(`${refusal}: advisory lock is not owned by this harness session`);
    }
    if ((await databaseRows(verificationConnection)).length !== 1) {
      throw new Error(`${refusal}: owned test database is missing or ambiguous`);
    }
    const storedToken = await readOwnershipToken(verificationConnection);
    if (storedToken === null || !ownershipTokensMatch(storedToken, session.ownershipToken)) {
      throw new Error(`${refusal}: ownership token is missing or does not match`);
    }
    await verificationConnection.execute(`DROP DATABASE \`${PHASE_2D_TEST_DATABASE}\``);
    if ((await databaseRows(verificationConnection)).length !== 0) {
      throw new Error(`${refusal}: test database cleanup could not be verified`);
    }
  } finally {
    await releaseAdvisoryLock(ownerConnection);
  }
}

async function phase2dMigrationFiles(maximum: number): Promise<string[]> {
  const directory = new URL("../../src/db/migrations/", import.meta.url);
  const migrations = (await readdir(directory))
    .filter((filename) => /^\d{4}_.+\.sql$/.test(filename))
    .sort()
    .filter((filename) => Number(filename.slice(0, 4)) <= maximum);
  const expectedNumbers = Array.from({ length: maximum }, (_, index) => String(index + 1).padStart(4, "0"));
  if (migrations.length !== maximum || migrations.some((filename, index) => !filename.startsWith(`${expectedNumbers[index]}_`))) {
    throw new Error(`Phase 2D integration requires the complete migration chain 0001-${String(maximum).padStart(4, "0")}`);
  }
  return migrations;
}

async function applyPhase2dMigrations(connection: Phase2dHarnessConnection, migrations: readonly string[]): Promise<void> {
  const directory = new URL("../../src/db/migrations/", import.meta.url);
  for (const filename of migrations) {
    const sql = await readFile(new URL(filename, directory), "utf8");
    await connection.query!(sql);
    await connection.execute(
      "INSERT INTO schema_migrations (filename,content_hash) VALUES (?,?)",
      [filename, createHash("sha256").update(sql).digest("hex")],
    );
  }
}

export async function migratePhase2dDatabaseThrough0017(connection: Phase2dHarnessConnection): Promise<string[]> {
  if (!connection.query) throw new Error("Phase 2D migration harness requires a multi-statement query connection");
  await connection.query(`USE \`${PHASE_2D_TEST_DATABASE}\``);
  await connection.execute(
    "CREATE TABLE schema_migrations (filename VARCHAR(255) NOT NULL PRIMARY KEY,content_hash CHAR(64) NOT NULL,applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3))",
  );
  const migrations = await phase2dMigrationFiles(17);
  await applyPhase2dMigrations(connection, migrations);
  return migrations;
}

export async function applyPhase2dMigration0018(connection: Phase2dHarnessConnection): Promise<string> {
  if (!connection.query) throw new Error("Phase 2D migration harness requires a multi-statement query connection");
  const [journal] = await connection.execute("SELECT filename FROM schema_migrations ORDER BY filename");
  const applied = rows(journal).map((row) => String(row.filename));
  const expected = await phase2dMigrationFiles(17);
  if (JSON.stringify(applied) !== JSON.stringify(expected)) throw new Error("Migration 0018 upgrade requires an exact 0001-0017 journal");
  const filename = (await phase2dMigrationFiles(18)).at(-1)!;
  await applyPhase2dMigrations(connection, [filename]);
  return filename;
}

export async function migratePhase2dDatabaseThrough0018(connection: Phase2dHarnessConnection): Promise<string[]> {
  const migrations = await migratePhase2dDatabaseThrough0017(connection);
  return [...migrations, await applyPhase2dMigration0018(connection)];
}
