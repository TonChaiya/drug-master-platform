import { apiJson, unauthorized } from "@/lib/api-response";
import { requireTenantContext, type EffectiveFacility } from "./effective-facility";
import { currentUser } from "@/modules/auth/session";
import type { SessionUser } from "@/modules/auth/types";
import type { TenantContext } from "./tenant-context";

export interface RequestContext extends TenantContext {
  user: SessionUser;
  facility: EffectiveFacility;
}

export type ContextResult = { ok: true; context: RequestContext } | { ok: false; response: Response };

/**
 * Resolves the authenticated user and the facility currently in scope. Route
 * handlers must go through this instead of reading a facility id from the
 * request — that is the tenant-isolation rule in docs/SPEC.md.
 */
export async function withFacilityContext(): Promise<ContextResult> {
  const user = await currentUser();
  if (!user) return { ok: false, response: unauthorized() };
  try {
    const context = await requireTenantContext(user);
    return { ok: true, context: { ...context, user } };
  } catch {
    return {
      ok: false,
      response: apiJson({ ok: false, errorCode: "FACILITY_CONTEXT_REQUIRED", message: "กรุณาเลือกสถานบริการก่อน" }, 409),
    };
  }
}

export async function requireAdmin(): Promise<{ ok: true; user: SessionUser } | { ok: false; response: Response }> {
  const user = await currentUser();
  if (!user) return { ok: false, response: unauthorized() };
  if (user.role !== "admin") {
    return { ok: false, response: apiJson({ ok: false, errorCode: "FORBIDDEN", message: "ต้องเป็นผู้ดูแลระบบ" }, 403) };
  }
  return { ok: true, user };
}
