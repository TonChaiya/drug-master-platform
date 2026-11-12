import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  admin: vi.fn(),
  maintenance: vi.fn(),
  readTmtOperations: vi.fn(),
  importTtmt: vi.fn(),
}));

vi.mock("@/lib/authorization/require-context", () => ({ requireAdmin: mocks.admin }));
vi.mock("@/modules/maintenance/route-guard", () => ({ maintenanceMutationResponse: mocks.maintenance }));
vi.mock("@/modules/tmt/operations", () => ({ readTmtOperations: mocks.readTmtOperations }));
vi.mock("@/modules/standards/ttmt-v2-import", async () => {
  const actual = await vi.importActual<typeof import("@/modules/standards/ttmt-v2-import")>("@/modules/standards/ttmt-v2-import");
  return { ...actual, importMasterTtmtV2: mocks.importTtmt };
});

import { GET as getTmtOperations } from "@/app/api/v1/admin/tmt-operations/route";
import { POST as importTtmt } from "@/app/api/v1/admin/ttmt-import/route";

const snapshot = {
  readiness: { ready: true as const, assurance: "verified" as const, reason: null, run: null },
  latestRun: null,
  runs: [],
  checkpoints: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.admin.mockResolvedValue({ ok: true, user: { id: "admin-1" } });
  mocks.maintenance.mockResolvedValue(null);
  mocks.readTmtOperations.mockResolvedValue(snapshot);
  mocks.importTtmt.mockResolvedValue({ importId: "import-1", version: "20261001", contentHash: "a".repeat(64), rowCount: 2, warnings: [], dryRun: false });
});
afterEach(() => vi.unstubAllGlobals());

test("non-admin is denied before current TMT status or TTMT import work", async () => {
  mocks.admin.mockResolvedValue({ ok: false, response: new Response(JSON.stringify({ ok: false }), { status: 403 }) });
  const getResponse = await getTmtOperations();
  const form = new FormData();
  form.set("version", "20261001");
  form.set("file", new Blob(["fixture"]), "masterttmt.xls");
  const postResponse = await importTtmt(new Request("https://example.test/api", { method: "POST", body: form }));
  assert.equal(getResponse.status, 403);
  assert.equal(postResponse.status, 403);
  assert.equal(mocks.readTmtOperations.mock.calls.length, 0);
  assert.equal(mocks.importTtmt.mock.calls.length, 0);
});

test("admin can read bounded current TMT operation status and history", async () => {
  mocks.readTmtOperations.mockResolvedValue({
    ...snapshot,
    latestRun: { id: "run-1", tmtVersion: "20261102", mode: "full", status: "succeeded", receivedRows: 10, writtenRows: 9, warningsCount: 1, errorCode: null, startedAt: "2026-11-01T00:00:00.000Z", finishedAt: "2026-11-01T01:00:00.000Z" },
    runs: [{ id: "run-1", tmtVersion: "20261102", mode: "full", status: "succeeded", receivedRows: 10, writtenRows: 9, warningsCount: 1, errorCode: null, startedAt: "2026-11-01T00:00:00.000Z", finishedAt: "2026-11-01T01:00:00.000Z" }],
    checkpoints: [{ endpoint: "tpu", windowBegin: "2013-01-01", windowEnd: "2013-12-31", status: "succeeded", receivedRows: 10, writtenRows: 9, attemptCount: 1, errorCode: null, startedAt: null, finishedAt: null }],
  });
  const response = await getTmtOperations();
  const body = await response.json() as { ok: boolean; operations: { runs: Array<{ id: string }>; checkpoints: Array<{ endpoint: string }> } };
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.operations.runs[0]?.id, "run-1");
  assert.equal(body.operations.checkpoints[0]?.endpoint, "tpu");
});

test("admin TTMT upload uses the current v2 importer, not a legacy standards route", async () => {
  const form = new FormData();
  form.set("version", "20261001");
  form.set("file", new Blob(["fixture"]), "MasterTTMT_20261001.xls");
  const response = await importTtmt(new Request("https://example.test/api", { method: "POST", body: form }));
  assert.equal(response.status, 200);
  assert.deepEqual(mocks.importTtmt.mock.calls[0]?.[0], {
    filename: "MasterTTMT_20261001.xls", version: "20261001", data: Buffer.from("fixture"), importedBy: "admin-1", dryRun: false,
  });
});

test("maintenance blocks an admin TTMT import before the importer writes", async () => {
  mocks.maintenance.mockResolvedValue(new Response(JSON.stringify({ ok: false, errorCode: "MAINTENANCE_MODE" }), { status: 503 }));
  const form = new FormData();
  form.set("version", "20261001");
  form.set("file", new Blob(["fixture"]), "MasterTTMT_20261001.xls");
  const response = await importTtmt(new Request("https://example.test/api", { method: "POST", body: form }));
  assert.equal(response.status, 503);
  assert.equal(mocks.importTtmt.mock.calls.length, 0);
});

test("admin operation controls remain current-v2 only and expose no destructive action", async () => {
  const sources = await Promise.all([
    import("node:fs/promises").then(({ readFile }) => readFile("src/app/(dashboard)/admin/tmt-operations-panel.tsx", "utf8")),
    import("node:fs/promises").then(({ readFile }) => readFile("src/app/(dashboard)/admin/ttmt-import-panel.tsx", "utf8")),
  ]);
  const source = sources.join("\n");
  assert.doesNotMatch(source, /\/api\/v1\/standards\/(sync|ttmt-import)/);
  assert.doesNotMatch(source, /standard_products/);
  assert.doesNotMatch(source, /\/api\/v1\/admin\/[^"']*(?:reset|truncate|delete)/i);
  assert.doesNotMatch(source, />\s*(?:ลบ|รีเซ็ต|ตัดข้อมูล)\s*</);
});
