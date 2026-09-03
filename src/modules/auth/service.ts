import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs, facilities, users } from "@/db/schema";
import { hashPassword, verifyPassword } from "./password";
import { normalizeFacilityName } from "@/lib/validation/facility";
import { normalizeUsername } from "./schemas";

const DUMMY_HASH = "scrypt$v=1$N=32768,r=8,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export class AuthError extends Error {
  constructor(
    public readonly code: "USERNAME_TAKEN" | "FACILITY_NAME_MISMATCH" | "INVALID_CREDENTIALS",
    /** For FACILITY_NAME_MISMATCH: the name the code is registered under, so
     * the message can tell the person what to type instead of just "no". */
    public readonly registeredFacilityName?: string,
  ) {
    super(code);
  }
}

export interface SignupInput {
  username: string;
  password: string;
  fullName: string;
  positionName: string;
  facilityCode: string;
  facilityName: string;
}

export async function signup(input: SignupInput): Promise<void> {
  const normalized = normalizeUsername(input.username);
  const passwordHash = await hashPassword(input.password);
  await db.transaction(async (tx) => {
    const duplicate = await tx.select({ id: users.id }).from(users).where(eq(users.usernameNormalized, normalized)).limit(1);
    if (duplicate.length) throw new AuthError("USERNAME_TAKEN");
    const existingFacilities = await tx.select().from(facilities).where(eq(facilities.facilityCode, input.facilityCode)).limit(1);
    let facilityId = existingFacilities[0]?.id;
    const existing = existingFacilities[0];
    if (existing && normalizeFacilityName(existing.facilityName) !== normalizeFacilityName(input.facilityName)) {
      throw new AuthError("FACILITY_NAME_MISMATCH", existing.facilityName);
    }
    if (!facilityId) {
      facilityId = randomUUID();
      await tx.insert(facilities).values({ id: facilityId, facilityCode: input.facilityCode, facilityName: input.facilityName.trim() });
    }
    const userId = randomUUID();
    await tx.insert(users).values({
      id: userId,
      facilityId,
      username: input.username.trim(),
      usernameNormalized: normalized,
      fullName: input.fullName.trim(),
      positionName: input.positionName.trim(),
      passwordHash,
      role: "user",
      status: "pending",
    });
    await tx.insert(auditLogs).values({ id: randomUUID(), effectiveFacilityId: facilityId, action: "auth.signup", entityType: "user", entityId: userId });
  });
}

export async function authenticate(username: string, password: string) {
  const rows = await db.select().from(users).where(eq(users.usernameNormalized, normalizeUsername(username))).limit(1);
  const user = rows[0];
  const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH).catch(() => false);
  if (!user || !valid || user.status !== "active") throw new AuthError("INVALID_CREDENTIALS");
  if ((user.role === "user" && !user.facilityId) || (user.role === "admin" && user.facilityId)) throw new AuthError("INVALID_CREDENTIALS");
  await db.update(users).set({ lastLoginAt: new Date(), updatedAt: new Date() }).where(and(eq(users.id, user.id), eq(users.status, "active")));
  return user;
}
