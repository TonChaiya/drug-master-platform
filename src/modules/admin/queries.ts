import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { facilities, users } from "@/db/schema";
import { agentFacilitySummaries } from "@/modules/agent/queries";
import { emptyMappingLifecycleSummary, mappingLifecycleSummaries } from "@/modules/mappings/summary";

export interface FacilitySummary {
  facilityId: string;
  facilityCode: string;
  facilityName: string;
  sourceTotal: number;
  type01: number;
  type10: number;
  mappedTotal: number;
  pendingTotal: number;
  needsReviewTotal: number;
  exportReadyTotal: number;
  installationCount: number;
  agentCount: number;
  disabledAgentCount: number;
  supersededAgentCount: number;
  usableAgentCount: number;
  onlineAgentCount: number;
  offlineAgentCount: number;
  jhcisConnectedCount: number;
  jhcisUnreachableCount: number;
  jhcisUnknownCount: number;
  /** Agents still declaring a different office.offid than this facility's code. */
  agentMismatchCount: number;
  activeAccountCount: number;
  pendingAccountCount: number;
  disabledAccountCount: number;
  totalAccountCount: number;
  lastMappedAt: Date | null;
}

/**
 * The admin overview: one long row per facility, details on demand
 * (docs/SPEC.md).
 */
export async function facilitySummaries(): Promise<FacilitySummary[]> {
  const [rows, mappingByFacility, agentByFacility, accounts] = await Promise.all([
    db
      .select({ facilityId: facilities.id, facilityCode: facilities.facilityCode, facilityName: facilities.facilityName })
      .from(facilities)
      .where(eq(facilities.status, "active"))
      .orderBy(asc(facilities.facilityCode)),
    mappingLifecycleSummaries(),
    agentFacilitySummaries(),
    db
      .select({
        facilityId: users.facilityId,
        active: sql<number>`SUM(CASE WHEN ${users.status} = 'active' THEN 1 ELSE 0 END)`,
        pending: sql<number>`SUM(CASE WHEN ${users.status} = 'pending' THEN 1 ELSE 0 END)`,
        disabled: sql<number>`SUM(CASE WHEN ${users.status} = 'disabled' THEN 1 ELSE 0 END)`,
        total: count(),
      })
      .from(users)
      .where(sql`${users.facilityId} IS NOT NULL`)
      .groupBy(users.facilityId),
  ]);
  const accountByFacility = new Map(accounts.map((row) => [row.facilityId, row]));

  return rows.map((row) => {
    const mapping = mappingByFacility.get(row.facilityId) ?? emptyMappingLifecycleSummary(row.facilityId);
    const agent = agentByFacility.get(row.facilityId);
    const account = accountByFacility.get(row.facilityId);
    return {
      facilityId: row.facilityId,
      facilityCode: row.facilityCode,
      facilityName: row.facilityName,
      sourceTotal: mapping.sourceTotal,
      type01: mapping.type01,
      type10: mapping.type10,
      mappedTotal: mapping.mappedTotal,
      pendingTotal: mapping.pendingTotal,
      needsReviewTotal: mapping.needsReviewTotal,
      exportReadyTotal: mapping.exportReadyTotal,
      installationCount: agent?.installationCount ?? 0,
      agentCount: agent?.agentCount ?? 0,
      disabledAgentCount: agent?.disabledAgentCount ?? 0,
      supersededAgentCount: agent?.supersededAgentCount ?? 0,
      usableAgentCount: agent?.usableAgentCount ?? 0,
      onlineAgentCount: agent?.onlineAgentCount ?? 0,
      offlineAgentCount: agent?.offlineAgentCount ?? 0,
      jhcisConnectedCount: agent?.jhcisConnectedCount ?? 0,
      jhcisUnreachableCount: agent?.jhcisUnreachableCount ?? 0,
      jhcisUnknownCount: agent?.jhcisUnknownCount ?? 0,
      agentMismatchCount: agent?.agentMismatchCount ?? 0,
      activeAccountCount: Number(account?.active ?? 0),
      pendingAccountCount: Number(account?.pending ?? 0),
      disabledAccountCount: Number(account?.disabled ?? 0),
      totalAccountCount: Number(account?.total ?? 0),
      lastMappedAt: mapping.lastMappedAt,
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
    // Accounts awaiting approval first, because they are the only rows that
    // need a decision. Then grouped by facility — central accounts have no
    // facility and sort to the top — and by username inside each group, so a
    // given row is always in the same place.
    .orderBy(
      sql`FIELD(${users.status}, 'pending', 'active', 'disabled')`,
      sql`${facilities.facilityCode} IS NOT NULL`,
      facilities.facilityCode,
      users.username,
    )
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
