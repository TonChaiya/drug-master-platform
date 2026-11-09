import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

/** Loads only the explicitly named file and replaces inherited values for keys present in it. */
export function loadExplicitEnvFile(path: string | undefined): void {
  if (!path) throw new Error("--env-file is required; implicit .env.local loading is forbidden");
  const values = parseEnv(readFileSync(path, "utf8"));
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
}
