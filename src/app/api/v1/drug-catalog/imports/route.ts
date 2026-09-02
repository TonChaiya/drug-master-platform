import { apiJson } from "@/lib/api-response";
import { withFacilityContext } from "@/lib/authorization/require-context";
import { listImports, previewImportRows } from "@/modules/catalog/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await withFacilityContext();
  if (!context.ok) return context.response;

  const importId = new URL(request.url).searchParams.get("importId");
  if (importId) {
    const rows = await previewImportRows(context.context.facilityId, importId, 100);
    return apiJson({ ok: true, rows });
  }
  return apiJson({ ok: true, imports: await listImports(context.context.facilityId) });
}
