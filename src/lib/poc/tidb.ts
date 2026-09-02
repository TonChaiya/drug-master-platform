import { z } from "zod";
import mysql, { type Pool } from "mysql2/promise";

const configSchema = z.object({
  host: z.string().trim().min(1),
  port: z.coerce.number().int().min(1).max(65535),
  user: z.string().trim().min(1),
  password: z.string().min(1),
  database: z.string().trim().regex(/^[A-Za-z0-9_]+$/),
  ssl: z.literal("true"),
});

let pool: Pool | undefined;

export function getPocTiDbPool(): Pool {
  if (pool) return pool;
  const config = configSchema.parse({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    ssl: process.env.DB_SSL,
  });
  pool = mysql.createPool({
    ...config,
    waitForConnections: true,
    connectionLimit: 4,
    maxIdle: 2,
    idleTimeout: 30_000,
    enableKeepAlive: true,
    timezone: "Z",
    dateStrings: false,
    ssl: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
  });
  return pool;
}
