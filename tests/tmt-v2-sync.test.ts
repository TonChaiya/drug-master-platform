import assert from "node:assert/strict";
import { test } from "vitest";
import { partitionHistoricalWindows, incrementalWindow } from "@/modules/tmt/windows";
import { runWithRetry } from "@/modules/tmt/retry";
import { RemoteResponseError, TmtResponseError } from "@/modules/standards/tmt-client";
import {
  resumeTmtSyncRun,
  runIncrementalTmtSync,
  runInitialTmtSync,
  type TmtSyncSource,
  type TmtSyncStore,
} from "@/modules/tmt/sync";
import type { PersistWindowResult, TmtDataEndpoint } from "@/modules/tmt/persistence";

test("historical windows are deterministic, inclusive, non-overlapping, and at most 365 days", () => {
  assert.deepEqual(partitionHistoricalWindows("2019-12-31", "2021-01-02"), [
    { begindate: "2019-12-31", enddate: "2020-12-29" },
    { begindate: "2020-12-30", enddate: "2021-01-02" },
  ]);
  assert.deepEqual(partitionHistoricalWindows("2020-02-29", "2020-02-29"), [
    { begindate: "2020-02-29", enddate: "2020-02-29" },
  ]);
});

test("incremental window uses a 30-day inclusive endpoint-specific overlap", () => {
  assert.deepEqual(incrementalWindow("2026-10-31", "2026-11-04"), {
    begindate: "2026-10-02",
    enddate: "2026-11-04",
  });
  assert.deepEqual(incrementalWindow(null, "2013-01-15"), {
    begindate: "2013-01-01",
    enddate: "2013-01-15",
  });
});

test("transient failures retry at most three total attempts with bounded backoff", async () => {
  const sleeps: number[] = [];
  let attempts = 0;
  const result = await runWithRetry(async () => {
    attempts += 1;
    if (attempts < 3) throw new RemoteResponseError(500, "/gpu");
    return "ok";
  }, { sleep: async (ms) => { sleeps.push(ms); }, random: () => 0 });

  assert.equal(result.value, "ok");
  assert.equal(result.attempts, 3);
  assert.deepEqual(sleeps, [500, 1_000]);
});

test("a timeout is retried and can recover", async () => {
  let attempts = 0;
  const result = await runWithRetry(async () => {
    attempts += 1;
    if (attempts === 1) throw new DOMException("timed out", "TimeoutError");
    return "ok";
  }, { sleep: async () => undefined, random: () => 0 });
  assert.equal(result.value, "ok");
  assert.equal(result.attempts, 2);
});

test("429 respects Retry-After and malformed contracts are not retried", async () => {
  const sleeps: number[] = [];
  let attempts = 0;
  await runWithRetry(async () => {
    attempts += 1;
    if (attempts === 1) throw new RemoteResponseError(429, "/tpu", 7_000);
    return "ok";
  }, { sleep: async (ms) => { sleeps.push(ms); }, random: () => 0 });
  assert.deepEqual(sleeps, [7_000]);

  let malformedAttempts = 0;
  await assert.rejects(
    runWithRetry(async () => {
      malformedAttempts += 1;
      throw new TmtResponseError();
    }, { sleep: async () => undefined }),
    TmtResponseError,
  );
  assert.equal(malformedAttempts, 1);
});

test("401 clears authentication once and repeated 401 fails without an infinite loop", async () => {
  let attempts = 0;
  let refreshes = 0;
  const success = await runWithRetry(async () => {
    attempts += 1;
    if (attempts === 1) throw new RemoteResponseError(401, "/concept");
    return "ok";
  }, {
    sleep: async () => undefined,
    refreshAuth: async () => { refreshes += 1; },
  });
  assert.equal(success.value, "ok");
  assert.equal(refreshes, 1);

  attempts = 0;
  refreshes = 0;
  await assert.rejects(
    runWithRetry(async () => {
      attempts += 1;
      throw new RemoteResponseError(403, "/relationship");
    }, {
      sleep: async () => undefined,
      refreshAuth: async () => { refreshes += 1; },
    }),
    RemoteResponseError,
  );
  assert.equal(attempts, 2);
  assert.equal(refreshes, 1);
});

const emptyMetrics: PersistWindowResult = { receivedRows: 0, uniqueRows: 0, writtenRows: 0, duplicateRows: 0, warnings: [] };

class FakeStore implements TmtSyncStore {
  readonly checkpoints: Array<{ runId: string; endpoint: TmtDataEndpoint; window: { begindate: string; enddate: string }; status: string }> = [];
  readonly persisted: Array<{ endpoint: TmtDataEndpoint; window: { begindate: string; enddate: string } }> = [];
  readonly finished: Array<{ status: string; errorCode: string | null }> = [];
  cursors = new Map<TmtDataEndpoint, string>();
  run = { id: "resume-run", tmtVersion: "20261104", mode: "full" as const, status: "failed", startedAt: new Date("2026-11-04T00:00:00Z") };

  async createRun(): Promise<void> {}
  async observeVersion(): Promise<void> {}
  async ensureCheckpoint(input: { runId: string; endpoint: TmtDataEndpoint; window: { begindate: string; enddate: string } }): Promise<void> {
    if (!this.checkpoints.some((row) => row.runId === input.runId && row.endpoint === input.endpoint && row.window.begindate === input.window.begindate)) {
      this.checkpoints.push({ ...input, status: "pending" });
    }
  }
  async persistWindow(input: { endpoint: TmtDataEndpoint; window: { begindate: string; enddate: string } }): Promise<PersistWindowResult> {
    this.persisted.push({ endpoint: input.endpoint, window: input.window });
    const checkpoint = this.checkpoints.find((row) => row.endpoint === input.endpoint && row.window.begindate === input.window.begindate);
    if (checkpoint) checkpoint.status = "succeeded";
    return emptyMetrics;
  }
  async failCheckpoint(input: { endpoint: TmtDataEndpoint; window: { begindate: string; enddate: string } }): Promise<void> {
    const checkpoint = this.checkpoints.find((row) => row.endpoint === input.endpoint && row.window.begindate === input.window.begindate);
    if (checkpoint) checkpoint.status = "failed";
  }
  async finishRun(input: { status: string; errorCode: string | null }): Promise<void> { this.finished.push(input); }
  async latestSuccessfulEnd(endpoint: TmtDataEndpoint): Promise<string | null> { return this.cursors.get(endpoint) ?? null; }
  async loadRun(): Promise<typeof this.run> { return this.run; }
  async incompleteCheckpoints(): Promise<typeof this.checkpoints> { return this.checkpoints.filter((row) => row.status !== "succeeded"); }
}

function fakeSource(input: { versions?: string[]; fail?: TmtDataEndpoint[] } = {}): TmtSyncSource {
  const versions = [...(input.versions ?? ["20261104", "20261104"])];
  return {
    async version() { return versions.shift() ?? "20261104"; },
    async fetch(endpoint) {
      if (input.fail?.includes(endpoint)) throw new RemoteResponseError(500, `/${endpoint}`);
      return [];
    },
    async resetAuthentication() {},
  };
}

const orchestrationOptions = {
  now: () => new Date("2026-11-04T12:00:00.000Z"),
  sleep: async () => undefined,
  random: () => 0,
};

test("optional endpoint failure is isolated from core readiness", async () => {
  const store = new FakeStore();
  const result = await runInitialTmtSync({
    source: fakeSource({ fail: ["imagelist"] }),
    store,
    coreEndpoints: ["gpu"],
    optionalEndpoints: ["imagelist"],
    historyStart: "2026-11-04",
    ...orchestrationOptions,
  });
  assert.equal(result.coreReady, true);
  assert.equal(result.status, "succeeded");
  assert.equal(result.optionalWarnings.length, 1);
  assert.equal(store.finished.at(-1)?.status, "succeeded");
});

test("version drift marks a completed core run stale", async () => {
  const store = new FakeStore();
  const result = await runInitialTmtSync({
    source: fakeSource({ versions: ["20261104", "20261105"] }),
    store,
    coreEndpoints: ["gpu"],
    optionalEndpoints: [],
    historyStart: "2026-11-04",
    ...orchestrationOptions,
  });
  assert.equal(result.coreReady, false);
  assert.equal(result.status, "stale");
  assert.equal(store.finished.at(-1)?.errorCode, "TMT_VERSION_DRIFT");
});

test("a blocking invariant failure prevents core readiness", async () => {
  const store = new FakeStore();
  const result = await runInitialTmtSync({
    source: fakeSource(), store, coreEndpoints: ["gpu"], optionalEndpoints: [], historyStart: "2026-11-04",
    invariantCheck: async () => { throw new Error("blocking invariant"); },
    ...orchestrationOptions,
  });
  assert.equal(result.coreReady, false);
  assert.equal(result.status, "failed");
  assert.equal(result.errorCode, "Error");
});

test("a final version check failure closes the run as failed", async () => {
  const store = new FakeStore();
  let versionCalls = 0;
  const source: TmtSyncSource = {
    async version() {
      versionCalls += 1;
      if (versionCalls === 1) return "20261104";
      throw new RemoteResponseError(500, "/version");
    },
    async fetch() { return []; },
    async resetAuthentication() {},
  };

  const result = await runInitialTmtSync({
    source,
    store,
    coreEndpoints: ["gpu"],
    optionalEndpoints: [],
    historyStart: "2026-11-04",
    ...orchestrationOptions,
  });

  assert.equal(result.coreReady, false);
  assert.equal(result.status, "failed");
  assert.equal(result.errorCode, "TMT_HTTP_500");
  assert.equal(store.finished.at(-1)?.errorCode, "TMT_HTTP_500");
});

test("incremental sync uses an independent 30-day overlap for each endpoint", async () => {
  const store = new FakeStore();
  store.cursors.set("gpu", "2026-10-31");
  store.cursors.set("tpu", "2026-09-30");
  const result = await runIncrementalTmtSync({
    source: fakeSource(), store, coreEndpoints: ["gpu", "tpu"], optionalEndpoints: [], ...orchestrationOptions,
  });
  assert.equal(result.coreReady, true);
  assert.deepEqual(store.persisted.map((row) => row.window.begindate), ["2026-10-02", "2026-09-01"]);
});

test("resume replays only incomplete checkpoints in the existing version-bound run", async () => {
  const store = new FakeStore();
  store.checkpoints.push(
    { runId: "resume-run", endpoint: "gpu", window: { begindate: "2026-01-01", enddate: "2026-12-31" }, status: "succeeded" },
    { runId: "resume-run", endpoint: "tpu", window: { begindate: "2026-01-01", enddate: "2026-12-31" }, status: "failed" },
  );
  const result = await resumeTmtSyncRun({
    runId: "resume-run", source: fakeSource(), store, coreEndpoints: ["gpu", "tpu"], optionalEndpoints: [], ...orchestrationOptions,
  });
  assert.equal(result.coreReady, true);
  assert.deepEqual(store.persisted.map((row) => row.endpoint), ["tpu"]);
});
