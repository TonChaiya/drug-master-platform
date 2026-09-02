import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import mysql from "mysql2/promise";

/**
 * One-time central-admin bootstrap. Refuses to run once any admin exists.
 *
 * By default it generates a random password and prints it once. Setting
 * BOOTSTRAP_ADMIN_PASSWORD lets you choose one for local development, but that
 * is refused when NODE_ENV=production: a predictable central-admin credential on
 * a live system is the one mistake this project explicitly set out not to repeat.
 *
 * Either way the account is created with must_change_password = 1.
 */
process.loadEnvFile(".env.local");

const scrypt = promisify(scryptCallback);
const PARAMETERS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64, PARAMETERS);
  return `scrypt$v=1$N=${PARAMETERS.N},r=${PARAMETERS.r},p=${PARAMETERS.p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

const username = (process.env.BOOTSTRAP_ADMIN_USERNAME ?? "").trim();
if (!/^[A-Za-z0-9._-]{4,80}$/.test(username)) {
  throw new Error("BOOTSTRAP_ADMIN_USERNAME must be 4-80 chars of [A-Za-z0-9._-]");
}

const chosen = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "";
if (chosen && process.env.NODE_ENV === "production") {
  throw new Error("BOOTSTRAP_ADMIN_PASSWORD is not allowed when NODE_ENV=production; let the script generate one");
}

const password = chosen || randomBytes(18).toString("base64url");
const generated = !chosen;

const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  ssl: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
});

try {
  const [admins] = await connection.execute("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  if (admins.length > 0) throw new Error("An admin already exists; bootstrap is disabled");

  await connection.execute(
    `INSERT INTO users (id, facility_id, username, username_normalized, full_name, position_name, password_hash, role, status, must_change_password)
     VALUES (?, NULL, ?, ?, ?, ?, ?, 'admin', 'active', 1)`,
    [randomUUID(), username, username.toLowerCase(), "ผู้ดูแลระบบส่วนกลาง", "ผู้ดูแลระบบ", await hashPassword(password)],
  );

  console.log("Central admin created.");
  console.log(`  username: ${username}`);
  if (generated) {
    console.log(`  password: ${password}   (shown once - copy it now)`);
  } else {
    console.log("  password: the value you set in BOOTSTRAP_ADMIN_PASSWORD");
  }
  if (password.length < 12) {
    console.log("");
    console.log("WARNING: that password is shorter than the 12-character policy this app");
    console.log("enforces for every other account. Fine for a local database; change it");
    console.log("before this database is reachable by anyone else.");
  }
  console.log("");
  console.log("Remove BOOTSTRAP_ADMIN_PASSWORD from .env.local once you have signed in.");
} finally {
  await connection.end();
}
