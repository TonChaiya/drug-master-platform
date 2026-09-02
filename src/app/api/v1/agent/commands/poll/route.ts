import { claimNextCommand } from "@/modules/agent/commands";
import { withAgentRequest } from "@/modules/agent/route-helpers";
import { pollRequestSchema } from "@/modules/agent/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PATH = "/api/v1/agent/commands/poll";

export async function POST(request: Request) {
  return withAgentRequest(request, PATH, pollRequestSchema, async ({ identity }) => {
    const command = await claimNextCommand(identity);
    return {
      command,
      pollIntervalSeconds: command ? 5 : 20,
    };
  });
}
