import { apiJson, unauthorized } from "@/lib/api-response";
import { currentUser } from "@/modules/auth/session";

export async function GET() {
  const user = await currentUser();
  if (!user) return unauthorized();
  return apiJson({ ok: true, user });
}
