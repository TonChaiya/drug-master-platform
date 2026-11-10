import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
  dbPool: vi.fn(),
  search: vi.fn(),
  detail: vi.fn(),
  requireReady: vi.fn(),
}));

vi.mock("@/modules/auth/session", () => ({ currentUser: mocks.currentUser }));
vi.mock("@/db/client", () => ({ dbPool: mocks.dbPool }));
vi.mock("@/modules/tmt/search", () => ({ searchTmt: mocks.search }));
vi.mock("@/modules/tmt/detail", () => ({ getTmtConceptDetail: mocks.detail }));
vi.mock("@/modules/tmt/readiness", () => ({
  requireTmtV2Ready: mocks.requireReady,
  TmtV2NotReadyError: class TmtV2NotReadyError extends Error {},
}));

import { GET as search } from "@/app/api/v1/tmt-v2/search/route";
import { GET as detail } from "@/app/api/v1/tmt-v2/concepts/[id]/route";

const user = { id: "user-1", role: "user", fullName: "Tester" };
const pool = { marker: "pool" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TMT_V2_BROWSER_ENABLED", "1");
  mocks.currentUser.mockResolvedValue(user);
  mocks.dbPool.mockReturnValue(pool);
  mocks.search.mockResolvedValue([]);
  mocks.detail.mockResolvedValue(null);
  mocks.requireReady.mockResolvedValue(undefined);
});

test("enabled browser fails closed before search when TMT is not ready", async () => {
  mocks.requireReady.mockRejectedValueOnce(new Error("not ready"));
  const response = await search(new Request("https://example.test/api/v1/tmt-v2/search?q=764169"));
  assert.equal(response.status, 503);
  assert.equal(mocks.search.mock.calls.length, 0);
});

afterEach(() => vi.unstubAllEnvs());

test("browser routes require authentication before feature or query access", async () => {
  mocks.currentUser.mockResolvedValueOnce(null);
  const response = await search(new Request("https://example.test/api/v1/tmt-v2/search?q=764169"));
  assert.equal(response.status, 401);
  assert.equal(mocks.dbPool.mock.calls.length, 0);
  assert.equal(mocks.search.mock.calls.length, 0);
});

test("default-off feature gate returns unavailable without constructing a DB pool", async () => {
  vi.stubEnv("TMT_V2_BROWSER_ENABLED", "0");
  const response = await search(new Request("https://example.test/api/v1/tmt-v2/search?q=764169"));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, errorCode: "TMT_V2_BROWSER_DISABLED", message: "TMT Browser v2 ยังไม่เปิดใช้งาน" });
  assert.equal(mocks.dbPool.mock.calls.length, 0);
  assert.equal(mocks.search.mock.calls.length, 0);
});

test("search rejects malformed and unbounded queries before service access", async () => {
  for (const url of [
    "https://example.test/api/v1/tmt-v2/search",
    "https://example.test/api/v1/tmt-v2/search?q=x&level=bad-level",
    "https://example.test/api/v1/tmt-v2/search?q=lidocaine&limit=101",
  ]) {
    const response = await search(new Request(url));
    assert.equal(response.status, 400);
  }
  assert.equal(mocks.search.mock.calls.length, 0);
});

test("search passes only validated bounded filters to the service", async () => {
  mocks.search.mockResolvedValueOnce([{ tmtId: "764169" }]);
  const response = await search(new Request("https://example.test/api/v1/tmt-v2/search?q=764169&level=gpu&status=unknown&mappingEligible=false&limit=20"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, rows: [{ tmtId: "764169" }], count: 1 });
  assert.deepEqual(mocks.search.mock.calls[0], [pool, {
    query: "764169",
    level: "gpu",
    status: "unknown",
    mappingEligible: false,
    limit: 20,
  }]);
});

test("concept route validates ID, depth, and node cap", async () => {
  for (const [id, query] of [["not-a-code", ""], ["764169", "?depth=5"], ["764169", "?maxNodes=201"]]) {
    const response = await detail(new Request(`https://example.test/api/v1/tmt-v2/concepts/${id}${query}`), { params: Promise.resolve({ id }) });
    assert.equal(response.status, 400);
  }
  assert.equal(mocks.detail.mock.calls.length, 0);
});

test("concept route returns bounded detail and a generic not-found response", async () => {
  mocks.detail.mockResolvedValueOnce({ concept: { tmtId: "764169" } });
  const response = await detail(new Request("https://example.test/api/v1/tmt-v2/concepts/764169?depth=2&maxNodes=50"), { params: Promise.resolve({ id: "764169" }) });
  assert.equal(response.status, 200);
  assert.deepEqual(mocks.detail.mock.calls[0], [pool, "764169", { graphDepth: 2, maxNodes: 50 }]);

  const missing = await detail(new Request("https://example.test/api/v1/tmt-v2/concepts/99999999"), { params: Promise.resolve({ id: "99999999" }) });
  assert.equal(missing.status, 404);
});
