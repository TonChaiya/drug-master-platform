import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ context: vi.fn(), save: vi.fn(), maintenance: vi.fn() }));
vi.mock("@/lib/authorization/require-context", () => ({ withFacilityContext: mocks.context }));
vi.mock("@/modules/mappings/v2-service", () => ({ saveV2Mapping: mocks.save }));
vi.mock("@/modules/maintenance/route-guard", () => ({ maintenanceMutationResponse: mocks.maintenance }));

import { POST } from "@/app/api/v1/mappings/v2/route";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TMT_V2_MAPPING_ENABLED", "1");
  mocks.maintenance.mockResolvedValue(null);
  mocks.context.mockResolvedValue({ ok: true, context: { facilityId: "00000000-0000-4000-8000-000000000001", actorUserId: "00000000-0000-4000-8000-000000000002" } });
  mocks.save.mockResolvedValue({ mappingId: "mapping", updateFlag: "A", reviewConfirmed: false, reviewNoop: false });
});
afterEach(() => vi.unstubAllEnvs());

test("v2 save is default-off before context or service access", async () => {
  vi.stubEnv("TMT_V2_MAPPING_ENABLED", "0");
  const response = await POST(new Request("https://example.test/api/v1/mappings/v2", { method: "POST", body: "{}" }));
  assert.equal(response.status, 503);
  assert.equal(mocks.context.mock.calls.length, 0);
  assert.equal(mocks.save.mock.calls.length, 0);
});

test("v2 save validates source-specific identity and derives facility from context", async () => {
  const response = await POST(new Request("https://example.test/api/v1/mappings/v2", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceDrugId: "00000000-0000-4000-8000-000000000003", standardSource: "TMT", standardCode: "565818", standardLevel: "tpu" }),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(mocks.save.mock.calls[0]?.[0], {
    facilityId: "00000000-0000-4000-8000-000000000001", userId: "00000000-0000-4000-8000-000000000002",
    sourceDrugId: "00000000-0000-4000-8000-000000000003", standardSource: "TMT", standardCode: "565818", standardLevel: "tpu",
  });
});
