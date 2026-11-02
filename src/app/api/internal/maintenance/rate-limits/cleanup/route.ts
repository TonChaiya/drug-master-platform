import { apiJson } from "@/lib/api-response";
import { cleanupExpiredRateLimitBuckets } from "@/modules/security/rate-limit-cleanup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return apiJson({ ok: false, errorCode: "UNAUTHORIZED" }, 401);
  }

  try {
    const result = await cleanupExpiredRateLimitBuckets();
    console.info("security.rate_limit_cleanup", result);
    return apiJson({ ok: true, ...result });
  } catch (error) {
    console.error("security.rate_limit_cleanup_failed", {
      errorType: error instanceof Error ? error.name : typeof error,
    });
    return apiJson({ ok: false, errorCode: "CLEANUP_FAILED" }, 500);
  }
}
