import { finishSync } from "@/modules/agent/sync";
import { withAgentRequest } from "@/modules/agent/route-helpers";
import { syncFinishSchema } from "@/modules/agent/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PATH = "/api/v1/agent/sync/finish";

export async function POST(request: Request) {
  return withAgentRequest(request, PATH, syncFinishSchema, async ({ identity, body }) =>
    finishSync(identity, body.sessionId, body.officeId),
  );
}
