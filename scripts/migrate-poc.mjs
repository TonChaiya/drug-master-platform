import { readFile } from "node:fs/promises";
import mysql from "mysql2/promise";

process.loadEnvFile(".env.local");

const targetDatabase = process.env.DB_DATABASE;
if (!targetDatabase || !/^[A-Za-z0-9_]+$/.test(targetDatabase) || targetDatabase === "sys") {
  throw new Error("DB_DATABASE must be a dedicated non-system database name");
}
if (process.env.DB_SSL !== "true") throw new Error("DB_SSL=true is required");

const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: "sys",
  ssl: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
  multipleStatements: true,
});

try {
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${targetDatabase}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await connection.query(`USE \`${targetDatabase}\``);
  const migration = await readFile(new URL("../src/db/migrations/0001_poc_connectivity.sql", import.meta.url), "utf8");
  await connection.query(migration);
  console.log(`PoC migration applied to ${targetDatabase}`);
} finally {
  await connection.end();
}
