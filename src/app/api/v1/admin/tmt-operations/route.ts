import { apiJson } from "@/lib/api-response";
import { requireAdmin } from "@/lib/authorization/require-context";
import { readTmtOperations } from "@/modules/tmt/operations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  return apiJson({ ok: true, operations: await readTmtOperations() });
}
