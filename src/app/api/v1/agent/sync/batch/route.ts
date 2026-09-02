import { stageBatch } from "@/modules/agent/sync";
import { withAgentRequest } from "@/modules/agent/route-helpers";
import { syncBatchSchema } from "@/modules/agent/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PATH = "/api/v1/agent/sync/batch";

export async function POST(request: Request) {
  return withAgentRequest(request, PATH, syncBatchSchema, async ({ identity, body }) =>
    stageBatch(identity, body.sessionId, body.officeId, body.rows),
  );
}
