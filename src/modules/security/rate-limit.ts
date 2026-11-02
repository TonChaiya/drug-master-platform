import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { and, eq, sql } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { rateLimitBuckets } from "@/db/schema";

export interface RateLimitPolicy {
  scope: "auth.login" | "auth.signup" | "agent.enroll";
  limit: number;
  windowMs: number;
}

export const LOGIN_RATE_LIMIT = { scope: "auth.login", limit: 15, windowMs: 5 * 60 * 1000 } as const satisfies RateLimitPolicy;
export const SIGNUP_RATE_LIMIT = { scope: "auth.signup", limit: 5, windowMs: 30 * 60 * 1000 } as const satisfies RateLimitPolicy;
export const ENROLL_RATE_LIMIT = { scope: "agent.enroll", limit: 10, windowMs: 10 * 60 * 1000 } as const satisfies RateLimitPolicy;

export interface RateLimitBucketInput {
  scope: RateLimitPolicy["scope"];
  clientKeyHash: string;
  windowStart: Date;
  expiresAt: Date;
}

export type RateLimitDecision =
  | { allowed: true; retryAfterSeconds: 0 }
  | { allowed: false; retryAfterSeconds: number };

type RateLimitDatabase = MySql2Database<typeof schema>;
type IncrementBucket = (input: RateLimitBucketInput) => Promise<number>;

function clientAddress(request: Request): string {
  const value = request.headers.get("x-vercel-forwarded-for")
    ?? request.headers.get("x-forwarded-for")
    ?? request.headers.get("x-real-ip");
  const candidate = value?.split(",", 1)[0]?.trim() ?? "";
  return isIP(candidate) ? candidate : "unknown";
}

function clientKeyHash(request: Request, secret: string): string {
  if (secret.length < 32) throw new Error("RATE_LIMIT_SECRET_INVALID");
  return createHmac("sha256", secret).update("public-rate-limit:v1\0").update(clientAddress(request)).digest("hex");
}

export async function incrementRateLimitBucket(database: RateLimitDatabase, input: RateLimitBucketInput): Promise<number> {
  return database.transaction(async (tx) => {
    await tx
      .insert(rateLimitBuckets)
      .values({ ...input, requestCount: 1, updatedAt: new Date() })
      .onDuplicateKeyUpdate({
        set: {
          requestCount: sql`${rateLimitBuckets.requestCount} + 1`,
          expiresAt: input.expiresAt,
          updatedAt: new Date(),
        },
      });
    const rows = await tx
      .select({ requestCount: rateLimitBuckets.requestCount })
      .from(rateLimitBuckets)
      .where(
        and(
          eq(rateLimitBuckets.scope, input.scope),
          eq(rateLimitBuckets.clientKeyHash, input.clientKeyHash),
          eq(rateLimitBuckets.windowStart, input.windowStart),
        ),
      )
      .for("update")
      .limit(1);
    const count = rows[0]?.requestCount;
    if (count === undefined) throw new Error("RATE_LIMIT_BUCKET_MISSING");
    return count;
  });
}

const incrementDefault: IncrementBucket = (input) => incrementRateLimitBucket(db, input);

export async function checkPublicRateLimit(
  request: Request,
  policy: RateLimitPolicy,
  options: {
    secret?: string;
    now?: Date;
    increment?: IncrementBucket;
  } = {},
): Promise<RateLimitDecision> {
  try {
    const secret = options.secret ?? process.env.SESSION_SECRET ?? "";
    const now = options.now ?? new Date();
    const windowStartMs = Math.floor(now.getTime() / policy.windowMs) * policy.windowMs;
    const expiresAtMs = windowStartMs + policy.windowMs;
    const count = await (options.increment ?? incrementDefault)({
      scope: policy.scope,
      clientKeyHash: clientKeyHash(request, secret),
      windowStart: new Date(windowStartMs),
      expiresAt: new Date(expiresAtMs),
    });
    if (count <= policy.limit) return { allowed: true, retryAfterSeconds: 0 };
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((expiresAtMs - now.getTime()) / 1000)) };
  } catch (error) {
    console.error("security.rate_limit_unavailable", {
      scope: policy.scope,
      errorType: error instanceof Error ? error.name : typeof error,
    });
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

export function rateLimitExceededResponse(decision: Extract<RateLimitDecision, { allowed: false }>): NextResponse {
  return NextResponse.json(
    { ok: false, errorCode: "RATE_LIMITED", message: "มีคำขอมากเกินไป กรุณาลองใหม่ภายหลัง" },
    {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(decision.retryAfterSeconds),
      },
    },
  );
}
