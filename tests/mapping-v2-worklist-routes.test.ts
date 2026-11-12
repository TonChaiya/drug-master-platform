import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ context: vi.fn(), list: vi.fn(), requireReady: vi.fn() }));
vi.mock("@/lib/authorization/require-context", () => ({ withFacilityContext: mocks.context }));
vi.mock("@/modules/mappings/v2-worklist", () => ({ mappingWorklistV2: mocks.list }));
vi.mock("@/modules/tmt/readiness", () => ({ requireTmtV2Ready: mocks.requireReady }));

import { GET } from "@/app/api/v1/mappings/v2/worklist/route";

const facilityId = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TMT_V2_MAPPING_ENABLED", "1");
  mocks.context.mockResolvedValue({ ok: true, context: { facilityId } });
  mocks.requireReady.mockResolvedValue(undefined);
  mocks.list.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 30, pageCount: 1 });
});
afterEach(() => vi.unstubAllEnvs());

test("worklist defaults to pending and a server-backed page of 30", async () => {
  const response = await GET(new Request("https://example.test/api/v1/mappings/v2/worklist"));
  assert.equal(response.status, 200);
  assert.deepEqual(mocks.list.mock.calls[0]?.[0], { facilityId });
});

test("worklist passes verified facility scope, lifecycle, type, search, and pagination to the current service", async () => {
  const response = await GET(new Request("https://example.test/api/v1/mappings/v2/worklist?facilityId=other&query=amoxicillin&status=needs_review&drugType=10&page=3&pageSize=30"));
  assert.equal(response.status, 200);
  assert.deepEqual(mocks.list.mock.calls[0]?.[0], {
    facilityId,
    query: "amoxicillin",
    status: "needs_review",
    drugType: "10",
    page: 3,
    pageSize: 30,
  });
});

test("worklist rejects invalid lifecycle/type pagination filters before querying", async () => {
  const response = await GET(new Request("https://example.test/api/v1/mappings/v2/worklist?status=legacy&drugType=99&page=0"));
  assert.equal(response.status, 400);
  assert.equal(mocks.list.mock.calls.length, 0);
});

test("worklist remains default-off and fails closed before context or query access", async () => {
  vi.stubEnv("TMT_V2_MAPPING_ENABLED", "0");
  const response = await GET(new Request("https://example.test/api/v1/mappings/v2/worklist?status=all"));
  assert.equal(response.status, 503);
  assert.equal(mocks.context.mock.calls.length, 0);
  assert.equal(mocks.list.mock.calls.length, 0);
});

test("worklist does not query when TMT readiness is unavailable", async () => {
  mocks.requireReady.mockRejectedValueOnce(new Error("not ready"));
  const response = await GET(new Request("https://example.test/api/v1/mappings/v2/worklist?status=mapped"));
  assert.equal(response.status, 503);
  assert.equal(mocks.list.mock.calls.length, 0);
});
