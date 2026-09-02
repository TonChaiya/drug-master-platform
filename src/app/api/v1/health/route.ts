import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { apiJson } from "@/lib/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Deployment diagnostic, deliberately unauthenticated: when configuration is
 * wrong nobody can sign in, so an admin-only check would be unreachable exactly
 * when it is needed.
 *
 * It reports only whether each required variable is present and whether the
 * database answers — never a value, hostname, username or query result. The
 * database error is reduced to the driver's code (ETIMEDOUT, ER_ACCESS_DENIED,
 * …), which says what to fix without describing the target.
 */
const REQUIRED = ["DB_HOST", "DB_PORT", "DB_USERNAME", "DB_PASSWORD", "DB_DATABASE", "DB_SSL", "SESSION_SECRET", "APP_ENCRYPTION_KEY"] as const;

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const candidate = error as { code?: unknown; message?: unknown };
    if (typeof candidate.code === "string") return candidate.code;
    // zod's parse failure on the DB_* block, thrown when the pool is built.
    if (typeof candidate.message === "string" && candidate.message.includes("invalid_type")) return "DB_ENV_INVALID";
  }
  return "DB_UNKNOWN_ERROR";
}

export async function GET() {
  const env = Object.fromEntries(REQUIRED.map((name) => [name, Boolean(process.env[name]?.trim())]));
  const missing = REQUIRED.filter((name) => !env[name]);

  let database: { ok: boolean; errorCode: string | null; latencyMs: number };
  const startedAt = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    database = { ok: true, errorCode: null, latencyMs: Date.now() - startedAt };
  } catch (error) {
    database = { ok: false, errorCode: errorCode(error), latencyMs: Date.now() - startedAt };
  }

  const ok = missing.length === 0 && database.ok;
  return apiJson({ ok, env, missing, database, sslExpected: process.env.DB_SSL === "true" }, ok ? 200 : 503);
}
