import { apiJson, unauthorized } from "@/lib/api-response";
import { requireTenantContext } from "@/lib/authorization/effective-facility";
import { currentUser } from "@/modules/auth/session";
import { createEnrollment } from "@/modules/agent/enrollment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Creates a 10-minute enrollment link for the facility currently in scope. The
 * facility is never taken from the request body.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return unauthorized();

  let context;
  try {
    context = await requireTenantContext(user);
  } catch {
    return apiJson({ ok: false, errorCode: "FACILITY_CONTEXT_REQUIRED", message: "กรุณาเลือกสถานบริการก่อน" }, 409);
  }

  const origin = new URL(request.url).origin;
  const link = await createEnrollment(context.facilityId, user.id, origin);
  return apiJson({
    ok: true,
    protocolUrl: link.protocolUrl,
    expiresAt: link.expiresAt.toISOString(),
    facilityCode: context.facility.code,
    serverUrl: origin,
    // The raw token is shown once so the operator can paste it if the
    // tmtagent:// handler is not registered on that machine.
    enrollmentToken: link.token,
  });
}
