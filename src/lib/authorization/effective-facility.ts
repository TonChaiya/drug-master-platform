import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { facilities } from "@/db/schema";
import type { SessionUser } from "@/modules/auth/types";
import type { TenantContext } from "./tenant-context";

export const EFFECTIVE_FACILITY_COOKIE = "drug_master_effective_facility";

export interface EffectiveFacility {
  id: string;
  code: string;
  name: string;
}

/**
 * A `user` is pinned to their own facility and can never widen scope. An `admin`
 * has no facility of their own and must pick one explicitly; the choice lives in
 * a cookie but is re-validated against the database on every read, so a forged
 * cookie yields null rather than access.
 */
export async function resolveEffectiveFacility(user: SessionUser): Promise<EffectiveFacility | null> {
  if (user.role === "user") {
    if (!user.facilityId || !user.facilityCode || !user.facilityName) return null;
    return { id: user.facilityId, code: user.facilityCode, name: user.facilityName };
  }

  const selected = (await cookies()).get(EFFECTIVE_FACILITY_COOKIE)?.value;
  if (!selected) return null;

  const rows = await db
    .select({ id: facilities.id, code: facilities.facilityCode, name: facilities.facilityName, status: facilities.status })
    .from(facilities)
    .where(eq(facilities.id, selected))
    .limit(1);
  const row = rows[0];
  if (!row || row.status !== "active") return null;
  return { id: row.id, code: row.code, name: row.name };
}

/** Throws unless a facility scope exists — use this before any facility-owned query. */
export async function requireTenantContext(user: SessionUser): Promise<TenantContext & { facility: EffectiveFacility }> {
  const facility = await resolveEffectiveFacility(user);
  if (!facility) throw new Error("FACILITY_CONTEXT_REQUIRED");
  return { actorUserId: user.id, role: user.role, facilityId: facility.id, facility };
}
