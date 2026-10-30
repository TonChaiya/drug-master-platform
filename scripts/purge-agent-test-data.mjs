import mysql from "mysql2/promise";

const envIndex = process.argv.indexOf("--env");
if (envIndex < 0 || !process.argv[envIndex + 1]) throw new Error("Usage: node scripts/purge-agent-test-data.mjs --env <file> [--execute-agent-test-data --confirm-database <name>]");
process.loadEnvFile(process.argv[envIndex + 1]);

const database = process.env.DB_DATABASE;
if (!database || !/^[A-Za-z0-9_]+$/.test(database) || ["mysql", "sys", "test"].includes(database.toLowerCase())) {
  throw new Error("DB_DATABASE must be a dedicated application database");
}
if (process.env.DB_SSL !== "true") throw new Error("DB_SSL=true is required");
const execute = process.argv.includes("--execute-agent-test-data");
const confirmIndex = process.argv.indexOf("--confirm-database");
if (execute && (confirmIndex < 0 || process.argv[confirmIndex + 1] !== database)) {
  throw new Error("Execution requires --confirm-database with the exact DB_DATABASE value");
}

const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database,
  ssl: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
});

const tables = ["agent_request_nonces", "agent_sync_staging", "agent_commands", "agent_enrollment_tokens", "agent_credentials", "agent_installations"];
async function counts() {
  const result = {};
  for (const table of tables) {
    const [rows] = await connection.query(`SELECT COUNT(*) AS total FROM \`${table}\``);
    result[table] = Number(rows[0].total);
  }
  const [sessions] = await connection.query("SELECT COUNT(*) AS total FROM agent_sync_sessions");
  const [preserved] = await connection.query("SELECT COUNT(DISTINCT last_seen_sync_id) AS total FROM source_drugs WHERE last_seen_sync_id IS NOT NULL");
  result.agent_sync_sessions = Number(sessions[0].total);
  result.sync_sessions_preserved_for_source_drugs = Number(preserved[0].total);
  return result;
}

try {
  console.log(JSON.stringify({ mode: execute ? "execute" : "dry-run", database, before: await counts() }, null, 2));
  if (!execute) process.exitCode = 2;
  else {
    await connection.beginTransaction();
    try {
      await connection.query("DELETE FROM agent_request_nonces");
      await connection.query("DELETE FROM agent_sync_staging");
      await connection.query("DELETE FROM agent_commands");
      await connection.query("DELETE FROM agent_enrollment_tokens");
      await connection.query("DELETE FROM agent_credentials");
      await connection.query("DELETE FROM agent_installations");
      await connection.query("DELETE s FROM agent_sync_sessions s LEFT JOIN source_drugs d ON d.last_seen_sync_id = s.id WHERE d.id IS NULL");
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }
    console.log(JSON.stringify({ after: await counts() }, null, 2));
  }
} finally {
  await connection.end();
}
