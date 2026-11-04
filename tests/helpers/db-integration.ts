import mysql, { type Pool, type PoolOptions } from "mysql2/promise";

const refusal = "Refusing to run DB integration test against non-test database";

type EnvLike = Record<string, string | undefined>;

export interface IntegrationTestDbConfig {
  host: "127.0.0.1" | "localhost";
  port: number;
  user: string;
  password: string;
  database: string;
}

export function dbIntegrationTestsEnabled(env: EnvLike = process.env): boolean {
  return env.ALLOW_DB_INTEGRATION_TESTS === "1";
}

export function integrationTestDbConfig(env: EnvLike = process.env): IntegrationTestDbConfig {
  if (env.NODE_ENV !== "test" || env.ALLOW_DB_INTEGRATION_TESTS !== "1") {
    throw new Error("DB integration tests require NODE_ENV=test and ALLOW_DB_INTEGRATION_TESTS=1");
  }

  const host = env.DB_HOST;
  const database = env.DB_DATABASE;
  const port = Number(env.DB_PORT);
  const user = env.DB_USERNAME?.trim();
  if (
    (host !== "127.0.0.1" && host !== "localhost") ||
    !/^drug_master_[a-z0-9_]*test$/.test(database ?? "") ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !user
  ) {
    throw new Error(refusal);
  }

  return { host, port, user, password: env.DB_PASSWORD ?? "", database: database as string };
}

export function createIntegrationTestPool(
  config: IntegrationTestDbConfig,
  overrides: Pick<PoolOptions, "connectionLimit"> = {},
): Pool {
  return mysql.createPool({
    ...config,
    connectionLimit: overrides.connectionLimit ?? 8,
    timezone: "Z",
  });
}

export function installIntegrationTestPool(pool: Pool): void {
  const globals = globalThis as typeof globalThis & { appDbPool?: Pool; appDb?: unknown };
  globals.appDbPool = pool;
  globals.appDb = undefined;
}

export function clearIntegrationTestPool(): void {
  const globals = globalThis as typeof globalThis & { appDbPool?: Pool; appDb?: unknown };
  globals.appDbPool = undefined;
  globals.appDb = undefined;
}
