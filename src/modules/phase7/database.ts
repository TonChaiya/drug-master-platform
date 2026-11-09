import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { z } from "zod";
import { maintenanceStoreForPool, readMaintenanceState } from "@/modules/maintenance/service";
import type { OperationalEnvironment, OperationalTarget } from "./guards";

const databaseEnvSchema = z.object({
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().min(1).max(65535),
  DB_USERNAME: z.string().min(1),
  DB_PASSWORD: z.string(),
  DB_DATABASE: z.string().regex(/^[A-Za-z0-9_]+$/),
  DB_SSL: z.enum(["true", "false"]),
});

export function createOperationalPool(environment: OperationalEnvironment): Pool {
  const env = databaseEnvSchema.parse(process.env);
  if (environment === "production" && env.DB_SSL !== "true") throw new Error("Production requires DB_SSL=true");
  if (environment === "production" && env.DB_PASSWORD.length === 0) throw new Error("Production requires a database password");
  return mysql.createPool({
    host: env.DB_HOST, port: env.DB_PORT, user: env.DB_USERNAME, password: env.DB_PASSWORD,
    database: env.DB_DATABASE, waitForConnections: true, connectionLimit: 4,
    ssl: env.DB_SSL === "true" ? { rejectUnauthorized: true, minVersion: "TLSv1.2" } : undefined,
  });
}

export async function inspectOperationalTarget(
  pool: Pool,
  input: { environment: OperationalEnvironment; executeRequested: boolean; confirmDatabase?: string },
): Promise<OperationalTarget> {
  const [identityRows] = await pool.query<RowDataPacket[]>("SELECT DATABASE() AS databaseName, VERSION() AS serverVersion, @@hostname AS serverHost");
  const [journal] = await pool.query<RowDataPacket[]>("SELECT filename FROM schema_migrations ORDER BY filename");
  const maintenance = await readMaintenanceState(maintenanceStoreForPool(pool));
  const env = databaseEnvSchema.parse(process.env);
  const identity = identityRows[0];
  return {
    environment: input.environment,
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: String(identity?.databaseName ?? env.DB_DATABASE),
    serverVersion: String(identity?.serverVersion ?? ""),
    appliedMigrations: journal.map((row) => String(row.filename)),
    maintenanceEnabled: maintenance.enabled,
    executeRequested: input.executeRequested,
    confirmDatabase: input.confirmDatabase,
  };
}

export async function tableCounts(pool: Pool, tables: readonly string[]): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const table of tables) {
    if (!/^[a-z0-9_]+$/.test(table)) throw new Error(`Unsafe table name: ${table}`);
    const [rows] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM \`${table}\``);
    result[table] = Number(rows[0]?.total ?? 0);
  }
  return result;
}
