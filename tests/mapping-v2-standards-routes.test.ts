import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  context: vi.fn(), dbPool: vi.fn(), ready: vi.fn(), release: vi.fn(), search: vi.fn(),
}));
vi.mock("@/lib/authorization/require-context", () => ({ withFacilityContext: mocks.context }));
vi.mock("@/db/client", () => ({ dbPool: mocks.dbPool }));
vi.mock("@/modules/tmt/readiness", () => ({ requireTmtV2Ready: mocks.ready }));
vi.mock("@/modules/standards/active-release", () => ({ readActiveStandardRelease: mocks.release }));
vi.mock("@/modules/standards/ttmt-search", () => ({ searchTtmtStandards: mocks.search }));

import { GET } from "@/app/api/v1/mappings/v2/standards/route";

const pool = { marker: "pool" };
const release = { releaseId: "release", tmtDatasetId: "tmt", ttmtDatasetId: "ttmt" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TMT_V2_MAPPING_ENABLED", "1");
  vi.stubEnv("ACTIVE_STANDARD_RELEASE_ENABLED", "0");
  mocks.context.mockResolvedValue({ ok: true, context: { facilityId: "facility" } });
  mocks.dbPool.mockReturnValue(pool);
  mocks.ready.mockResolvedValue(undefined);
  mocks.release.mockResolvedValue(release);
  mocks.search.mockResolvedValue([]);
});
afterEach(() => vi.unstubAllEnvs());

test("TTMT mapping route forwards five combined validated filters", async () => {
  const response = await GET(new Request("https://example.test/api/v1/mappings/v2/standards?source=TTMT&code=TT&tradeName=Trade&genericName=Generic&manufacturer=Maker&registrationNumber=1A"));
  assert.equal(response.status, 200);
  assert.deepEqual(mocks.search.mock.calls[0], [pool, {
    query: undefined, code: "TT", tradeName: "Trade", genericName: "Generic", manufacturer: "Maker", registrationNumber: "1A",
  }, undefined]);
});

test("TTMT mapping route passes the approved active release to dataset-scoped search", async () => {
  vi.stubEnv("ACTIVE_STANDARD_RELEASE_ENABLED", "1");
  const response = await GET(new Request("https://example.test/api/v1/mappings/v2/standards?source=TTMT&code=TT"));
  assert.equal(response.status, 200);
  assert.deepEqual(mocks.search.mock.calls[0], [pool, {
    query: undefined, code: "TT", tradeName: undefined, genericName: undefined, manufacturer: undefined, registrationNumber: undefined,
  }, release]);
});

test("TTMT mapping route preserves the existing q query contract", async () => {
  const response = await GET(new Request("https://example.test/api/v1/mappings/v2/standards?source=TTMT&q=drug"));
  assert.equal(response.status, 200);
  assert.equal(mocks.search.mock.calls[0]?.[1]?.query, "drug");
});

test("TTMT mapping route rejects empty and short filters before search", async () => {
  for (const url of [
    "https://example.test/api/v1/mappings/v2/standards?source=TTMT",
    "https://example.test/api/v1/mappings/v2/standards?source=TTMT&genericName=x",
  ]) assert.equal((await GET(new Request(url))).status, 400);
  assert.equal(mocks.search.mock.calls.length, 0);
});

test("TTMT mapping route fails closed when standards are not ready", async () => {
  mocks.ready.mockRejectedValueOnce(new Error("not ready"));
  const response = await GET(new Request("https://example.test/api/v1/mappings/v2/standards?source=TTMT&code=TT"));
  assert.equal(response.status, 503);
  assert.equal(mocks.search.mock.calls.length, 0);
});
