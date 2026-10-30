import type { ZodType } from "zod";
import { apiJson } from "@/lib/api-response";
import { AgentError, agentErrors } from "./errors";
import { assertInstallation, assertOffice, clearOfficeMismatch, touchInstallation, verifyAgentRequest, type AgentIdentity } from "./auth";

/** docs/OPERATIONS.md targets <= 1 MiB per agent request. */
const MAX_BODY_BYTES = 1024 * 1024;

export interface AgentContext<T> {
  identity: AgentIdentity;
  body: T;
}

/**
 * Every agent route runs through this: read raw bytes (the HMAC covers the exact
 * bytes, so the body must not be re-serialised), verify the signature, parse with
 * zod, then assert the declared installation and officeId against the credential.
 */
export async function withAgentRequest<
  T extends {
    installationId: string;
    officeId?: string | null;
    agentVersion?: string;
    macAddress?: string | null;
  },
>(
  request: Request,
  path: string,
  schema: ZodType<T>,
  handler: (context: AgentContext<T>) => Promise<unknown>,
): Promise<Response> {
  try {
    const raw = new Uint8Array(await request.arrayBuffer());
    if (raw.byteLength > MAX_BODY_BYTES) throw agentErrors.payloadTooLarge();

    const identity = await verifyAgentRequest(request, path, raw);

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      throw agentErrors.bodyInvalid();
    }
    const parsed = schema.safeParse(parsedJson);
    if (!parsed.success) throw agentErrors.bodyInvalid();

    assertInstallation(identity, parsed.data.installationId);
    if (parsed.data.officeId) {
      await assertOffice(identity, parsed.data.officeId);
      await clearOfficeMismatch(identity.installationId);
    }
    if (parsed.data.agentVersion) {
      await touchInstallation(
        identity.installationId,
        parsed.data.agentVersion,
        parsed.data.officeId,
        parsed.data.macAddress,
      );
    }

    const result = await handler({ identity, body: parsed.data });
    return apiJson({ ok: true, ...(result as Record<string, unknown>) });
  } catch (error) {
    return agentErrorResponse(error);
  }
}

export function agentErrorResponse(error: unknown): Response {
  if (error instanceof AgentError) {
    return apiJson({ ok: false, errorCode: error.code, message: error.message }, error.status);
  }
  // Never leak driver or crypto details to an unauthenticated caller.
  return apiJson({ ok: false, errorCode: "AGENT_SERVICE_ERROR", message: "ระบบไม่พร้อมให้บริการชั่วคราว" }, 503);
}
