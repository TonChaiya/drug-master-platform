import { z } from "zod";
import { apiJson, forbidden, unauthorized } from "@/lib/api-response";
import { requireTenantContext } from "@/lib/authorization/effective-facility";
import { currentUser } from "@/modules/auth/session";
import { AgentAdminError, deleteUnusedInstallation, disableInstallation, supersedeInstallation } from "@/modules/agent/admin";
import { createEnrollment } from "@/modules/agent/enrollment";
import { AgentError } from "@/modules/agent/errors";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("disable"), installationId: z.uuid() }).strict(),
  z.object({ action: z.literal("reenroll"), installationId: z.uuid() }).strict(),
  z.object({ action: z.literal("supersede"), installationId: z.uuid(), currentInstallationId: z.uuid() }).strict(),
  z.object({ action: z.literal("delete"), installationId: z.uuid() }).strict(),
]);

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return unauthorized();
  if (user.role !== "admin") return forbidden();
  const context = await requireTenantContext(user).catch(() => null);
  if (!context) return apiJson({ ok: false, errorCode: "FACILITY_CONTEXT_REQUIRED", message: "กรุณาเลือกสถานบริการก่อน" }, 409);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiJson({ ok: false, errorCode: "INVALID_INPUT", message: "คำสั่งไม่ถูกต้อง" }, 400);
  try {
    if (parsed.data.action === "disable") await disableInstallation({ facilityId: context.facilityId, installationId: parsed.data.installationId, actorUserId: user.id });
    if (parsed.data.action === "supersede") await supersedeInstallation({ facilityId: context.facilityId, oldInstallationId: parsed.data.installationId, currentInstallationId: parsed.data.currentInstallationId, actorUserId: user.id });
    if (parsed.data.action === "delete") await deleteUnusedInstallation({ facilityId: context.facilityId, installationId: parsed.data.installationId, actorUserId: user.id });
    if (parsed.data.action === "reenroll") {
      const link = await createEnrollment(context.facilityId, user.id, new URL(request.url).origin, parsed.data.installationId);
      return apiJson({ ok: true, protocolUrl: link.protocolUrl, expiresAt: link.expiresAt.toISOString() });
    }
    return apiJson({ ok: true });
  } catch (error) {
    if (error instanceof AgentAdminError) return apiJson({ ok: false, errorCode: error.code, message: error.message }, 409);
    if (error instanceof AgentError) return apiJson({ ok: false, errorCode: error.code, message: error.message }, error.status);
    throw error;
  }
}
