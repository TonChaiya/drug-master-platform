import { z } from "zod";
import { apiJson } from "@/lib/api-response";
import { withFacilityContext } from "@/lib/authorization/require-context";
import { searchStandards } from "@/modules/standards/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  standardType: z.enum(["TMT", "TTMT"]),
  code: z.string().trim().max(64).optional(),
  tradeName: z.string().trim().max(120).optional(),
  genericName: z.string().trim().max(120).optional(),
  manufacturer: z.string().trim().max(120).optional(),
  registrationNumber: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export async function GET(request: Request) {
  // Search reads the shared standard catalogue, but it is only offered to a
  // signed-in user working inside a facility.
  const context = await withFacilityContext();
  if (!context.ok) return context.response;

  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) return apiJson({ ok: false, errorCode: "INVALID_QUERY", message: "ตัวกรองไม่ถูกต้อง" }, 400);

  const rows = await searchStandards(parsed.data);
  return apiJson({ ok: true, rows, count: rows.length });
}
