import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import mysql from "mysql2/promise";

process.loadEnvFile(".env.local");

const database = process.env.DB_DATABASE;
if (!database || !/^[A-Za-z0-9_]+$/.test(database) || ["mysql", "sys", "test"].includes(database.toLowerCase())) {
  throw new Error("DB_DATABASE must be a dedicated application database");
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
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await connection.query(`USE \`${database}\``);
  await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename VARCHAR(255) NOT NULL PRIMARY KEY,
    content_hash CHAR(64) NOT NULL,
    applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  )`);
  const directory = new URL("../src/db/migrations/", import.meta.url);
  const filenames = (await readdir(directory)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
  for (const filename of filenames) {
    const sql = await readFile(new URL(filename, directory), "utf8");
    const hash = createHash("sha256").update(sql).digest("hex");
    const [rows] = await connection.execute("SELECT content_hash FROM schema_migrations WHERE filename = ?", [filename]);
    if (rows.length > 0) {
      if (rows[0].content_hash !== hash) throw new Error(`Applied migration was modified: ${filename}`);
      continue;
    }
    // TiDB does not roll back DDL, so a transaction here would only pretend the
    // failure was undone and the next run would hit "table already exists".
    // Fail loudly with the half-applied file named instead.
    try {
      await connection.query(sql);
    } catch (error) {
      throw new Error(
        `${filename} failed part-way through and was NOT recorded as applied. ` +
          `DDL is not transactional here, so the statements before the failure are still in place. ` +
          `Undo those by hand, then re-run. Cause: ${error.message}`,
        { cause: error },
      );
    }
    await connection.execute("INSERT INTO schema_migrations (filename, content_hash) VALUES (?, ?)", [filename, hash]);
    console.log(`Applied ${filename}`);
  }
  console.log(`Database ready: ${database}`);
} finally {
  await connection.end();
}
