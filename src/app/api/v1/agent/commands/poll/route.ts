import { claimNextCommand } from "@/modules/agent/commands";
import { withAgentRequest } from "@/modules/agent/route-helpers";
import { pollRequestSchema } from "@/modules/agent/schemas";
import { recordHeartbeat } from "@/modules/agent/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PATH = "/api/v1/agent/commands/poll";

export async function POST(request: Request) {
  return withAgentRequest(request, PATH, pollRequestSchema, async ({ identity, body }) => {
    await recordHeartbeat(identity.installationId, body);
    if (!body.jhcisConnected) {
      return { command: null, pollIntervalSeconds: 20 };
    }
    const command = await claimNextCommand(identity);
    return {
      command,
      pollIntervalSeconds: command ? 5 : 20,
    };
  });
}
