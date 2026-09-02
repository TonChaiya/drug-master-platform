import { z } from "zod";
import { apiJson } from "@/lib/api-response";
import { requireAdmin } from "@/lib/authorization/require-context";
import { clearInstallerLink, readInstallerLink, saveInstallerLink } from "@/modules/agent/installer-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z
  .object({
    // HTTPS only: the installer is an executable, and the page that offers it
    // must not send anyone to a plain-HTTP download.
    url: z.url().max(500).refine((value) => value.startsWith("https://"), "ต้องเป็น HTTPS"),
    version: z.string().trim().max(32).default(""),
  })
  .strict();

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  return apiJson({ ok: true, link: await readInstallerLink() });
}

export async function PUT(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiJson(
      { ok: false, errorCode: "INVALID_INPUT", message: `ลิงก์ไม่ถูกต้อง: ${parsed.error.issues[0]?.message ?? "ตรวจรูปแบบ URL"}` },
      400,
    );
  }

  await saveInstallerLink(parsed.data, admin.user.id);
  return apiJson({ ok: true, link: await readInstallerLink() });
}

export async function DELETE() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  await clearInstallerLink();
  return apiJson({ ok: true, link: await readInstallerLink() });
}
