import { z } from "zod";
import { apiJson } from "@/lib/api-response";
import { requireAdmin } from "@/lib/authorization/require-context";
import { fetchTmtVersion, resetTmtTokenCache } from "@/modules/standards/tmt-client";
import { clearTmtCredentials, readTmtCredentialStatus, saveTmtCredentials } from "@/modules/standards/tmt-credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z
  .object({
    baseUrl: z.url().max(255).refine((value) => value.startsWith("https://"), "ต้องเป็น HTTPS"),
    username: z.string().trim().min(1).max(160),
    password: z.string().min(1).max(255),
  })
  .strict();

/** Status only: the stored password is never returned, not even to an admin. */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  return apiJson({ ok: true, status: await readTmtCredentialStatus() });
}

export async function PUT(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiJson(
      { ok: false, errorCode: "INVALID_INPUT", message: `ข้อมูลไม่ถูกต้องที่ ${parsed.error.issues[0]?.path.join(".") || "ฟอร์ม"}` },
      400,
    );
  }

  await saveTmtCredentials(parsed.data, admin.user.id);
  // The cached token belongs to the credential that was just replaced.
  resetTmtTokenCache();
  return apiJson({ ok: true, status: await readTmtCredentialStatus() });
}

export async function DELETE() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  await clearTmtCredentials();
  resetTmtTokenCache();
  return apiJson({ ok: true, status: await readTmtCredentialStatus() });
}

/** Live check against the TMT API with whatever credential is in effect. */
export async function POST() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  return apiJson({ ok: true, result: await fetchTmtVersion() });
}
