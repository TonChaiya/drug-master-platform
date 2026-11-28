import { apiJson } from "@/lib/api-response";
import { requireAdmin } from "@/lib/authorization/require-context";
import { readTmtOperations } from "@/modules/tmt/operations";
import { z } from "zod";
import { tmtCandidateControlsEnabled } from "@/modules/tmt/feature";
import { maintenanceMutationResponse } from "@/modules/maintenance/route-guard";
import { candidateRequestSchema } from "@/modules/tmt/candidate-plan";
import { activateTmtDataset } from "@/modules/tmt/candidate-lifecycle";
import { acceptTmtCandidate, readFailedCandidateDiagnostics, resumeTmtCandidate, revalidateTmtCandidate } from "@/modules/tmt/candidate-jobs";
import { candidateRuntime, dispatchTmtCandidate } from "@/modules/tmt/candidate-runtime";
import { dbPool } from "@/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request?: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  const candidate = request ? new URL(request.url).searchParams.get("candidateDiagnostics") : null;
  if (candidate !== null) {
    if (!z.string().uuid().safeParse(candidate).success) return apiJson({ ok: false, errorCode: "INVALID_INPUT" }, 400);
    const report = await readFailedCandidateDiagnostics(dbPool(), candidate);
    return report ? apiJson({ ok: true, report }) : apiJson({ ok: false, errorCode: "TMT_DIAGNOSTICS_UNAVAILABLE" }, 404);
  }
  return apiJson({ ok: true, operations: await readTmtOperations() });
}

const command = z.discriminatedUnion("action", [
  candidateRequestSchema.extend({ action: z.literal("start"), id: z.string().uuid() }),
  z.object({ action: z.literal("resume"), id: z.string().uuid() }).strict(),
  z.object({ action: z.literal("revalidate"), id: z.string().uuid(), confirm: z.string().max(60) }).strict(),
  z.object({
    action: z.enum(["promote", "rollback"]), id: z.string().uuid(), generation: z.number().int().nonnegative(),
    confirm: z.string().max(60),
  }).strict(),
]);

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  if (!tmtCandidateControlsEnabled()) return apiJson({ ok: false, errorCode: "TMT_CANDIDATE_DISABLED", message: "การสั่งงาน TMT ผ่านเว็บยังไม่เปิดใช้งาน" }, 503);
  const origin = request.headers.get("origin");
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("content-type") ?? "") || origin && origin !== new URL(request.url).origin) {
    return apiJson({ ok: false, errorCode: "INVALID_ORIGIN_OR_CONTENT_TYPE", message: "คำสั่งต้องมาจากหน้า Admin ของระบบนี้" }, 403);
  }
  const maintenance = await maintenanceMutationResponse();
  if (maintenance) return maintenance;
  const parsed = command.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiJson({ ok: false, errorCode: "INVALID_INPUT", message: "ข้อมูลคำสั่ง TMT ไม่ถูกต้อง" }, 400);
  const input = parsed.data;
  if ("confirm" in input && input.confirm !== `${input.action.toUpperCase()} ${input.id}`) {
    return apiJson({ ok: false, errorCode: "TMT_CONFIRMATION_REQUIRED", message: "ตรวจสอบรหัสชุดข้อมูลและยืนยันอีกครั้ง" }, 400);
  }
  try {
    const { pool, source } = await candidateRuntime();
    if (input.action === "start") await acceptTmtCandidate(pool, { ...input, actor: admin.user.id }, source, dispatchTmtCandidate);
    else if (input.action === "resume") await resumeTmtCandidate(pool, input.id, admin.user.id, source, dispatchTmtCandidate);
    else if (input.action === "revalidate") await revalidateTmtCandidate(pool, input.id, admin.user.id, source, dispatchTmtCandidate);
    else await activateTmtDataset(pool, {
      actor: admin.user.id, datasetId: input.id, generation: input.generation, action: input.action,
      observedVersion: input.action === "promote" ? await source.version() : undefined,
    });
    return apiJson({ ok: true, id: input.id }, input.action === "promote" || input.action === "rollback" ? 200 : 202);
  } catch (error) {
    const code = error instanceof Error && /^TMT_[A-Z_]{1,50}$/.test(error.message) ? error.message : "TMT_COMMAND_FAILED";
    const message = ({
      TMT_COVERAGE_MUST_END_TODAY: "วันสิ้นสุดต้องเป็นวันนี้ตามเวลาไทย",
      TMT_COVERAGE_GAP: "ช่วงวันที่เริ่มต้นขาดข้อมูลที่จำเป็นสำหรับชุดใหม่",
      TMT_VERSION_UNAVAILABLE: "ต้นทางยังไม่ยืนยันเวอร์ชัน",
      TMT_JOB_ALREADY_ACTIVE: "มีงาน TMT ที่ยังดำเนินการอยู่",
      TMT_BASELINE_BOOTSTRAP_REQUIRED: "ยังไม่ได้รับรอง snapshot ชุดข้อมูลปัจจุบัน",
      TMT_JOB_NOT_RESUMABLE: "ชุดข้อมูลหรือเวอร์ชันต้นทางเปลี่ยนแล้ว หรือสถานะงานไม่อนุญาตให้ทำต่อ",
      TMT_JOB_NOT_REVALIDATABLE: "ตรวจสอบซ้ำไม่ได้ เพราะสถานะงาน ชุดข้อมูลฐาน หรือเวอร์ชันต้นทางเปลี่ยนแล้ว",
      TMT_ACTIVE_DATASET_CHANGED: "ชุดข้อมูลที่ใช้งานอยู่เปลี่ยนแล้ว กรุณารีเฟรชก่อนยืนยันใหม่",
      TMT_CANDIDATE_VERSION_OR_BASE_CHANGED: "เวอร์ชันต้นทางหรือชุดข้อมูลฐานเปลี่ยน กรุณาตรวจสอบ candidate",
    } as Record<string, string>)[code] ?? "ดำเนินการไม่สำเร็จ กรุณาตรวจสถานะ TMT แล้วลองใหม่";
    return apiJson({ ok: false, errorCode: code, message }, code === "TMT_COMMAND_FAILED" ? 503 : 409);
  }
}
