import assert from "node:assert/strict";
import { test } from "vitest";
import { runOperationalTmtSync, type TmtRunnerDependencies } from "@/modules/phase7/tmt-runner";

function dependencies(calls: string[]): TmtRunnerDependencies {
  return {
    full: async () => { calls.push("full"); return { status: "succeeded", runId: "full-run", coreReady: true }; },
    incremental: async () => { calls.push("incremental"); return { status: "succeeded", runId: "inc-run", coreReady: true }; },
    resume: async (runId) => { calls.push(`resume:${runId}`); return { status: "succeeded", runId, coreReady: true }; },
  };
}

test("TMT operational dry-run reports plan and performs zero sync writes", async () => {
  const calls: string[] = [];
  const result = await runOperationalTmtSync({ mode: "full", dryRun: true, credentialPresent: true }, dependencies(calls));
  assert.equal(result.dryRun, true);
  assert.equal(result.historyStart, "2013-01-01");
  assert.deepEqual(calls, []);
});

test("TMT operational runner refuses missing credentials and invalid resume input", async () => {
  await assert.rejects(() => runOperationalTmtSync({ mode: "full", dryRun: true, credentialPresent: false }, dependencies([])), /credential/i);
  await assert.rejects(() => runOperationalTmtSync({ mode: "resume", dryRun: false, credentialPresent: true }, dependencies([])), /run id/i);
});

test("TMT operational runner dispatches full incremental and resume to Phase 3 engine adapters", async () => {
  const calls: string[] = [];
  await runOperationalTmtSync({ mode: "full", dryRun: false, credentialPresent: true }, dependencies(calls));
  await runOperationalTmtSync({ mode: "incremental", dryRun: false, credentialPresent: true }, dependencies(calls));
  await runOperationalTmtSync({ mode: "resume", runId: "resume-run", dryRun: false, credentialPresent: true }, dependencies(calls));
  assert.deepEqual(calls, ["full", "incremental", "resume:resume-run"]);
});
