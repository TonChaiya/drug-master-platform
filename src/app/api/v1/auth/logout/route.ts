import { apiJson } from "@/lib/api-response";
import { revokeCurrentSession } from "@/modules/auth/session";

export async function POST() {
  await revokeCurrentSession();
  return apiJson({ ok: true });
}
