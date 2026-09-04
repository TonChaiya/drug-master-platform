import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db/client";
import { facilities, sessions, users } from "@/db/schema";
import type { SessionUser } from "./types";

export const SESSION_COOKIE = "drug_master_session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function metadataHash(value: string | null): string | null {
  if (!value) return null;
  const key = process.env.SESSION_SECRET;
  if (!key || key.length < 32) return null;
  return createHmac("sha256", key).update(value).digest("hex");
}

export async function createSession(userId: string, request: Request): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({
    id: randomUUID(),
    tokenHash: tokenHash(token),
    userId,
    expiresAt,
    ipHash: metadataHash(request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null),
    userAgent: request.headers.get("user-agent")?.slice(0, 255) ?? null,
  });
  return { token, expiresAt };
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
}

export async function revokeCurrentSession(): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.tokenHash, tokenHash(token)), isNull(sessions.revokedAt)));
  await clearSessionCookie();
}

/**
 * The hash of the session cookie on this request, or null.
 *
 * An admin changing their own password signs out every other device but has to
 * stay signed in here, and this is what tells the two apart.
 */
export async function currentSessionTokenHash(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? tokenHash(token) : null;
}

export async function currentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      fullName: users.fullName,
      role: users.role,
      facilityId: users.facilityId,
      facilityCode: facilities.facilityCode,
      facilityName: facilities.facilityName,
      mustChangePassword: users.mustChangePassword,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .leftJoin(facilities, eq(facilities.id, users.facilityId))
    .where(and(eq(sessions.tokenHash, tokenHash(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date()), eq(users.status, "active")))
    .limit(1);
  const row = rows[0];
  if (!row || (row.role !== "admin" && row.role !== "user")) return null;
  return { ...row, role: row.role, mustChangePassword: row.mustChangePassword === 1 };
}

export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  return user;
}
