import { and, asc, count, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { agentInstallations, drugMappings, facilities, sourceDrugs, users } from "@/db/schema";

export interface FacilitySummary {
  facilityId: string;
  facilityCode: string;
  facilityName: string;
  sourceTotal: number;
  type01: number;
  type10: number;
  mappedTotal: number;
  pendingTotal: number;
  agentCount: number;
  lastMappedAt: Date | null;
}

/**
 * The admin overview: one long row per facility, details on demand
 * (docs/SPEC.md).
 */
export async function facilitySummaries(): Promise<FacilitySummary[]> {
  const rows = await db
    .select({
      facilityId: facilities.id,
      facilityCode: facilities.facilityCode,
      facilityName: facilities.facilityName,
      sourceTotal: sql<number>`COUNT(DISTINCT ${sourceDrugs.id})`,
      type01: sql<number>`COUNT(DISTINCT CASE WHEN ${sourceDrugs.drugtype} = '01' THEN ${sourceDrugs.id} END)`,
      type10: sql<number>`COUNT(DISTINCT CASE WHEN ${sourceDrugs.drugtype} = '10' THEN ${sourceDrugs.id} END)`,
      mappedTotal: sql<number>`COUNT(DISTINCT ${drugMappings.id})`,
      lastMappedAt: sql<Date | null>`MAX(${drugMappings.updatedAt})`,
    })
    .from(facilities)
    .leftJoin(sourceDrugs, and(eq(sourceDrugs.facilityId, facilities.id), eq(sourceDrugs.active, 1)))
    .leftJoin(drugMappings, eq(drugMappings.sourceDrugId, sourceDrugs.id))
    .where(eq(facilities.status, "active"))
    .groupBy(facilities.id, facilities.facilityCode, facilities.facilityName)
    .orderBy(asc(facilities.facilityCode));

  const agents = await db
    .select({ facilityId: agentInstallations.facilityId, total: count() })
    .from(agentInstallations)
    .where(eq(agentInstallations.status, "active"))
    .groupBy(agentInstallations.facilityId);
  const agentByFacility = new Map(agents.map((row) => [row.facilityId, Number(row.total)]));

  return rows.map((row) => {
    const sourceTotal = Number(row.sourceTotal ?? 0);
    const mappedTotal = Number(row.mappedTotal ?? 0);
    return {
      facilityId: row.facilityId,
      facilityCode: row.facilityCode,
      facilityName: row.facilityName,
      sourceTotal,
      type01: Number(row.type01 ?? 0),
      type10: Number(row.type10 ?? 0),
      mappedTotal,
      pendingTotal: Math.max(0, sourceTotal - mappedTotal),
      agentCount: agentByFacility.get(row.facilityId) ?? 0,
      lastMappedAt: row.lastMappedAt ? new Date(row.lastMappedAt) : null,
    };
  });
}

export async function listUsers(limit = 200) {
  return db
    .select({
      id: users.id,
      username: users.username,
      fullName: users.fullName,
      positionName: users.positionName,
      role: users.role,
      status: users.status,
      mustChangePassword: users.mustChangePassword,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
      facilityCode: facilities.facilityCode,
      facilityName: facilities.facilityName,
    })
    .from(users)
    .leftJoin(facilities, eq(facilities.id, users.facilityId))
    .orderBy(sql`FIELD(${users.status}, 'pending', 'active', 'disabled')`, desc(users.createdAt))
    .limit(limit);
}

export async function countPendingUsers(): Promise<number> {
  const [row] = await db.select({ total: count() }).from(users).where(eq(users.status, "pending"));
  return Number(row?.total ?? 0);
}

/** Central admins must not be attached to a facility. */
export async function countMisconfiguredAdmins(): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(users)
    .where(and(eq(users.role, "admin"), sql`${users.facilityId} IS NOT NULL`));
  return Number(row?.total ?? 0);
}

export async function countFacilitylessUsers(): Promise<number> {
  const [row] = await db.select({ total: count() }).from(users).where(and(eq(users.role, "user"), isNull(users.facilityId)));
  return Number(row?.total ?? 0);
}
