import type { SessionUser } from "@/modules/auth/types";

export interface TenantContext {
  actorUserId: string;
  role: "admin" | "user";
  facilityId: string;
}

export function tenantContext(user: SessionUser, adminFacilityId?: string): TenantContext {
  if (user.role === "user" && user.facilityId) return { actorUserId: user.id, role: user.role, facilityId: user.facilityId };
  if (user.role === "admin" && adminFacilityId) return { actorUserId: user.id, role: user.role, facilityId: adminFacilityId };
  throw new Error("FACILITY_CONTEXT_REQUIRED");
}
