import { z } from "zod";
import { apiJson } from "@/lib/api-response";
import { withFacilityContext } from "@/lib/authorization/require-context";
import { createExportPreview } from "@/modules/exports/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  selection: z.enum(["all-mapped", "manual-changes"]),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

/**
 * The preview must show the real rows of the selected set, and the count here is
 * the count in the downloaded file (docs/SPEC.md).
 */
export async function GET(request: Request) {
  const context = await withFacilityContext();
  if (!context.ok) return context.response;

  const parsed = schema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  if (!parsed.success) return apiJson({ ok: false, errorCode: "INVALID_QUERY", message: "ตัวเลือกไม่ถูกต้อง" }, 400);

  const { candidates, previewToken } = await createExportPreview(context.context.facilityId, parsed.data.selection);
  const rows = candidates.map((candidate) => candidate.row);
  const limit = parsed.data.limit ?? 100;
  return apiJson({
    ok: true,
    previewToken,
    total: rows.length,
    shown: Math.min(limit, rows.length),
    rows: rows.slice(0, limit),
  });
}
