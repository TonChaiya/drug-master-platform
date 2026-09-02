import { z } from "zod";
import { apiJson, unauthorized } from "@/lib/api-response";
import { requireTenantContext } from "@/lib/authorization/effective-facility";
import { currentUser } from "@/modules/auth/session";
import { COMMAND_TYPES, queueCommand } from "@/modules/agent/commands";

export const runtime = "nodejs";

const schema = z.object({ commandType: z.enum(COMMAND_TYPES) }).strict();

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return unauthorized();

  let context;
  try {
    context = await requireTenantContext(user);
  } catch {
    return apiJson({ ok: false, errorCode: "FACILITY_CONTEXT_REQUIRED", message: "กรุณาเลือกสถานบริการก่อน" }, 409);
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiJson({ ok: false, errorCode: "INVALID_INPUT", message: "คำสั่งไม่ถูกต้อง" }, 400);

  const commandId = await queueCommand(context.facilityId, parsed.data.commandType, user.id);
  return apiJson({ ok: true, commandId });
}
