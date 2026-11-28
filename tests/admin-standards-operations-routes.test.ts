import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  admin: vi.fn(),
  maintenance: vi.fn(),
  readTmtOperations: vi.fn(),
  importTtmt: vi.fn(),
  runtime: vi.fn(),
  accept: vi.fn(),
  resume: vi.fn(),
  revalidate: vi.fn(),
  controlsEnabled: vi.fn(),
}));

vi.mock("@/lib/authorization/require-context", () => ({ requireAdmin: mocks.admin }));
vi.mock("@/modules/maintenance/route-guard", () => ({ maintenanceMutationResponse: mocks.maintenance }));
vi.mock("@/modules/tmt/operations", () => ({ readTmtOperations: mocks.readTmtOperations }));
vi.mock("@/modules/tmt/candidate-runtime", () => ({ candidateRuntime: mocks.runtime, dispatchTmtCandidate: vi.fn() }));
vi.mock("@/modules/tmt/candidate-jobs", () => ({ acceptTmtCandidate: mocks.accept, resumeTmtCandidate: mocks.resume, revalidateTmtCandidate: mocks.revalidate }));
vi.mock("@/modules/tmt/feature", async (original) => ({
  ...await original<typeof import("@/modules/tmt/feature")>(), tmtCandidateControlsEnabled: mocks.controlsEnabled,
}));
vi.mock("@/modules/standards/ttmt-v2-import", async () => {
  const actual = await vi.importActual<typeof import("@/modules/standards/ttmt-v2-import")>("@/modules/standards/ttmt-v2-import");
  return { ...actual, importMasterTtmtV2: mocks.importTtmt };
});

import { GET as getTmtOperations, POST as postTmtOperations } from "@/app/api/v1/admin/tmt-operations/route";
import { POST as importTtmt } from "@/app/api/v1/admin/ttmt-import/route";

const snapshot = {
  readiness: { ready: true as const, assurance: "verified" as const, reason: null, run: null },
  latestRun: null,
  runs: [],
  checkpoints: [],
  progress: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.admin.mockResolvedValue({ ok: true, user: { id: "admin-1" } });
  mocks.maintenance.mockResolvedValue(null);
  mocks.readTmtOperations.mockResolvedValue(snapshot);
  mocks.controlsEnabled.mockReturnValue(false);
  mocks.runtime.mockResolvedValue({ pool: {}, source: {} });
  mocks.importTtmt.mockResolvedValue({ importId: "import-1", version: "20261001", contentHash: "a".repeat(64), rowCount: 2, warnings: [], dryRun: false });
});
afterEach(() => vi.unstubAllGlobals());

const candidateId = "5a3d06ba-bc74-46ea-8e48-c929d100d71d";
const command = (data: object) => new Request("https://example.test/api/v1/admin/tmt-operations", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
});

test("candidate Start and Resume require admin, enabled runtime and maintenance clearance before contacting the worker", async () => {
  const start = { id: candidateId, action: "start", mode: "incremental" };
  mocks.admin.mockResolvedValueOnce({ ok: false, response: new Response(null, { status: 403 }) });
  assert.equal((await postTmtOperations(command(start))).status, 403);
  assert.equal((await postTmtOperations(command(start))).status, 503);
  mocks.controlsEnabled.mockReturnValue(true);
  mocks.maintenance.mockResolvedValueOnce(new Response(null, { status: 503 }));
  assert.equal((await postTmtOperations(command(start))).status, 503);
  assert.equal((await postTmtOperations(command({ ...start, mode: "full_unverified" }))).status, 400);
  assert.equal((await postTmtOperations(command({ ...start, begin: "wrong" }))).status, 400);
  assert.equal(mocks.runtime.mock.calls.length, 0);
  assert.equal((await postTmtOperations(command(start))).status, 202);
  assert.equal(mocks.accept.mock.calls[0]?.[1].actor, "admin-1");
  assert.equal((await postTmtOperations(command({ id: candidateId, action: "resume" }))).status, 202);
  assert.equal(mocks.resume.mock.calls[0]?.[2], "admin-1");
});

test("promotion and rollback refuse a confirmation for the wrong dataset or action", async () => {
  mocks.controlsEnabled.mockReturnValue(true);
  for (const action of ["promote", "rollback"]) {
    const response = await postTmtOperations(command({ id: candidateId, action, generation: 1, confirm: "WRONG" }));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).errorCode, "TMT_CONFIRMATION_REQUIRED");
  }
  assert.equal(mocks.runtime.mock.calls.length, 0);
});

test("validation-only recovery requires exact confirmation and does not invoke Start or Resume", async () => {
  mocks.controlsEnabled.mockReturnValue(true);
  const input = { action: "revalidate", id: candidateId };
  const response = await postTmtOperations(command({ ...input, confirm: `RESUME ${candidateId}` }));
  assert.equal(response.status, 400);
  assert.equal(mocks.runtime.mock.calls.length, 0);
  assert.equal((await postTmtOperations(command({ ...input, confirm: `REVALIDATE ${candidateId}` }))).status, 202);
  assert.equal(mocks.revalidate.mock.calls[0]?.[1], candidateId);
  assert.equal(mocks.accept.mock.calls.length, 0);
  assert.equal(mocks.resume.mock.calls.length, 0);
});

test("candidate mutation rejects a cross-origin submission before resolving credentials", async () => {
  mocks.controlsEnabled.mockReturnValue(true);
  const request = command({ id: candidateId, action: "start", mode: "full" });
  request.headers.set("Origin", "https://other.example.test");
  assert.equal((await postTmtOperations(request)).status, 403);
  assert.equal(mocks.runtime.mock.calls.length, 0);
});

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
