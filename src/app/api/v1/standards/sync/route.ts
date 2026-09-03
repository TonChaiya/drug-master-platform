import { z } from "zod";
import { apiJson } from "@/lib/api-response";
import { requireAdmin } from "@/lib/authorization/require-context";
import { syncMasterTmt } from "@/modules/standards/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * All fields optional: with none, the sync covers the whole TMT history to
 * today and continues an unfinished run rather than starting it again.
 */
const schema = z
  .object({
    beginDate: isoDate.optional(),
    endDate: isoDate.optional(),
    resume: z.boolean().optional(),
  })
  .strict();

/** Syncing rewrites the shared standard catalogue, so it is admin-only. */
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const parsed = schema.safeParse((await request.json().catch(() => null)) ?? {});
  if (!parsed.success) return apiJson({ ok: false, errorCode: "INVALID_INPUT", message: "ช่วงวันที่ไม่ถูกต้อง" }, 400);

  try {
    const result = await syncMasterTmt({ ...parsed.data, userId: admin.user.id });
    return apiJson({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "sync ไม่สำเร็จ";
    return apiJson({ ok: false, errorCode: "STANDARD_SYNC_FAILED", message }, 502);
  }
}
