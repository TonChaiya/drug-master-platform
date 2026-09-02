import { abortStaleSessions, beginSync } from "@/modules/agent/sync";
import { withAgentRequest } from "@/modules/agent/route-helpers";
import { syncBeginSchema } from "@/modules/agent/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PATH = "/api/v1/agent/sync/begin";

export async function POST(request: Request) {
  return withAgentRequest(request, PATH, syncBeginSchema, async ({ identity, body }) => {
    const session = await beginSync(identity, body.officeId, body.expectedRows);
    await abortStaleSessions(identity.facilityId, session.sessionId);
    return session;
  });
}
