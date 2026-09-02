import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql, { type Pool } from "mysql2/promise";
import { z } from "zod";
import * as schema from "@/db/schema";

const envSchema = z.object({
  host: z.string().trim().min(1),
  port: z.coerce.number().int().min(1).max(65535),
  user: z.string().trim().min(1),
  password: z.string().min(1),
  database: z.string().trim().regex(/^[A-Za-z0-9_]+$/),
  ssl: z.literal("true"),
});

declare global {
  var appDbPool: Pool | undefined;
  var appDb: MySql2Database<typeof schema> | undefined;
}

function createPool(): Pool {
  const env = envSchema.parse({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    ssl: process.env.DB_SSL,
  });
  return mysql.createPool({
    ...env,
    waitForConnections: true,
    connectionLimit: 8,
    maxIdle: 4,
    idleTimeout: 30_000,
    enableKeepAlive: true,
    timezone: "Z",
    ssl: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
  });
}

export const dbPool = globalThis.appDbPool ?? createPool();
export const db = globalThis.appDb ?? drizzle(dbPool, { schema, mode: "default" });

if (process.env.NODE_ENV !== "production") {
  globalThis.appDbPool = dbPool;
  globalThis.appDb = db;
}
