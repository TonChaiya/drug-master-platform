import { apiJson } from "@/lib/api-response";
import { agentErrorResponse } from "@/modules/agent/route-helpers";
import { agentErrors } from "@/modules/agent/errors";
import { redeemEnrollment } from "@/modules/agent/enrollment";
import { enrollRequestSchema } from "@/modules/agent/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The only unsigned agent endpoint: the agent has no credential yet. It is
 * protected by the single-use, 10-minute enrollment token plus an officeId match.
 */
export async function POST(request: Request) {
  try {
    const raw = await request.text();
    if (raw.length > 8192) throw agentErrors.payloadTooLarge();
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      throw agentErrors.bodyInvalid();
    }
    const parsed = enrollRequestSchema.safeParse(parsedJson);
    // A malformed field is not an expired token: blaming the token here sends
    // the operator to regenerate a link that was never the problem.
    if (!parsed.success) throw agentErrors.bodyInvalid(parsed.error.issues[0]?.path.join("."));

    const credential = await redeemEnrollment(parsed.data);
    return apiJson({
      ok: true,
      keyId: credential.keyId,
      secret: credential.secret,
      facilityCode: credential.facilityCode,
      installationId: credential.installationId,
      protocol: "1",
    });
  } catch (error) {
    return agentErrorResponse(error);
  }
}
