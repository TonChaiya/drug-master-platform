import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ guard: vi.fn(), facilityContext: vi.fn(), adminContext: vi.fn() }));
vi.mock("@/modules/maintenance/route-guard", () => ({ maintenanceMutationResponse: mocks.guard }));
vi.mock("@/lib/authorization/require-context", () => ({
  withFacilityContext: mocks.facilityContext,
  requireAdmin: mocks.adminContext,
}));
vi.mock("@/modules/agent/route-helpers", () => ({
  withAgentRequest: async (_request: Request, _path: string, _schema: unknown, _handler: unknown, options: { beforeMutation?: () => Promise<Response | null> }) =>
    await options.beforeMutation?.() ?? new Response(null, { status: 200 }),
}));

import { POST as agentBegin } from "@/app/api/v1/agent/sync/begin/route";
import { POST as agentBatch } from "@/app/api/v1/agent/sync/batch/route";
import { POST as agentFinish } from "@/app/api/v1/agent/sync/finish/route";
import { POST as agentPoll } from "@/app/api/v1/agent/commands/poll/route";
import { POST as agentComplete } from "@/app/api/v1/agent/commands/complete/route";
import { POST as catalogImport } from "@/app/api/v1/drug-catalog/import/route";
import { POST as clearFacilityData } from "@/app/api/v1/admin/facility-data/route";
import { POST as mappingSave } from "@/app/api/v1/mappings/save/route";
import { POST as mappingV2Save } from "@/app/api/v1/mappings/v2/route";
import { POST as mappingReconcile } from "@/app/api/v1/mappings/reconcile/route";
import { GET as exportPreview } from "@/app/api/v1/exports/preview/route";
import { POST as exportDownload } from "@/app/api/v1/exports/download/route";
import { POST as standardSync } from "@/app/api/v1/standards/sync/route";
import { POST as legacyTtmtImport } from "@/app/api/v1/standards/ttmt-import/route";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TMT_V2_MAPPING_ENABLED", "1");
  mocks.facilityContext.mockResolvedValue({ ok: true, context: { facilityId: "facility", actorUserId: "user" } });
  mocks.adminContext.mockResolvedValue({ ok: true, context: { actorUserId: "admin" } });
  mocks.guard.mockResolvedValue(new Response(JSON.stringify({ ok: false, errorCode: "MAINTENANCE_MODE" }), { status: 503 }));
});
afterEach(() => vi.unstubAllEnvs());

test("maintenance rejects every cutover-sensitive mutation after authentication but before its write boundary", async () => {
  const request = () => new Request("https://example.test/api", { method: "POST", body: "{}" });
  const responses = await Promise.all([
    agentBegin(request()), agentBatch(request()), agentFinish(request()), agentPoll(request()), agentComplete(request()),
    catalogImport(request()), clearFacilityData(request()), mappingSave(request()),
    mappingV2Save(request()), mappingReconcile(), exportPreview(new Request("https://example.test/api")),
    exportDownload(request()), standardSync(request()), legacyTtmtImport(request()),
  ]);
  assert.deepEqual(responses.map((response) => response.status), Array(responses.length).fill(503));
  assert.equal(mocks.guard.mock.calls.length, responses.length);
});
