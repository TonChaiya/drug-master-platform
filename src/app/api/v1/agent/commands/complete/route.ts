import { completeCommand } from "@/modules/agent/commands";
import { withAgentRequest } from "@/modules/agent/route-helpers";
import { completeRequestSchema } from "@/modules/agent/schemas";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PATH = "/api/v1/agent/commands/complete";

const schema = completeRequestSchema.extend({ commandId: z.uuid() });

export async function POST(request: Request) {
  return withAgentRequest(request, PATH, schema, async ({ identity, body }) => {
    await completeCommand(identity, body.commandId, body.claimToken, body.success, body.resultCode, body.resultMessage);
    return {};
  });
}
