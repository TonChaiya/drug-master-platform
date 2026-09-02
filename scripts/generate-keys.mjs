import { randomBytes } from "node:crypto";

/**
 * Prints fresh secrets for .env.local / hosting dashboard.
 * Nothing is written to disk: copy the values manually so they never land in Git.
 */
const values = {
  SESSION_SECRET: randomBytes(32).toString("base64"),
  APP_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
};

console.log("# Generated secrets — paste into .env.local (never commit)");
for (const [key, value] of Object.entries(values)) {
  console.log(`${key}=${value}`);
}
